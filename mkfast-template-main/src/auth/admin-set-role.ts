/**
 * Custom `/admin/set-role` handler (Spec A / #366).
 *
 * Better Auth's native set-role only accepts userId/role. Product needs a
 * non-empty reason, last-admin defense, immutable audit, and session revocation
 * in one database transaction. This module is wired through the #365 auth
 * catch-all dispatch and never falls through to the native handler.
 *
 * Terminology: recent authentication / step-up — never "二次认证", no MFA.
 */

import { and, eq, ne, sql } from 'drizzle-orm';

import {
  ADMIN_ROLE,
  type AuthSession,
  requireRecentAdminSession,
  type RecentAdminSessionResult,
} from '@/auth/recent-admin-session';
import { adminRoleChangeAudit } from '@/db/app.schema';
import { session as authSession, user as authUser } from '@/db/auth.schema';

/** Platform role values (single admin tier; merchant is `user`). */
export const PLATFORM_ROLE_ADMIN = ADMIN_ROLE;
export const PLATFORM_ROLE_USER = 'user';
export const PLATFORM_ROLES = [
  PLATFORM_ROLE_ADMIN,
  PLATFORM_ROLE_USER,
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const LAST_ADMIN_REQUIRED_CODE = 'LAST_ADMIN_REQUIRED';
export const REASON_REQUIRED_CODE = 'REASON_REQUIRED';
export const INVALID_ROLE_CODE = 'INVALID_ROLE';
export const USER_NOT_FOUND_CODE = 'USER_NOT_FOUND';
export const ROLE_UNCHANGED_CODE = 'ROLE_UNCHANGED';
export const METHOD_NOT_ALLOWED_CODE = 'METHOD_NOT_ALLOWED';

/** Same advisory key as drizzle/0002_last_admin_guard.sql. */
export const LAST_PLATFORM_ADMIN_LOCK_KEY = 'meiye:last-platform-admin';

export type SetRoleRequestBody = {
  userId: string;
  role: PlatformRole;
  reason: string;
};

export type ApplyPlatformRoleChangeInput = {
  actorUserId: string;
  subjectUserId: string;
  toRole: PlatformRole;
  reason: string;
};

export type ApplyPlatformRoleChangeResult = {
  subjectUserId: string;
  fromRole: string;
  toRole: PlatformRole;
  auditId: string;
  sessionsDeleted: number;
};

export type PlatformRoleChangeErrorCode =
  | typeof LAST_ADMIN_REQUIRED_CODE
  | typeof USER_NOT_FOUND_CODE
  | typeof ROLE_UNCHANGED_CODE
  | typeof INVALID_ROLE_CODE
  | typeof REASON_REQUIRED_CODE;

export class PlatformRoleChangeError extends Error {
  readonly code: PlatformRoleChangeErrorCode;

  constructor(code: PlatformRoleChangeErrorCode, message: string) {
    super(message);
    this.name = 'PlatformRoleChangeError';
    this.code = code;
  }
}

/**
 * Minimal transactional surface used by the set-role path.
 * Injected in tests; production uses getDb().
 * `tx` is a Drizzle transaction; typed loosely so tests avoid Workers getDb().
 */
export type RoleChangeDatabase = {
  transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

function isPlatformRole(value: unknown): value is PlatformRole {
  return (
    typeof value === 'string' &&
    (PLATFORM_ROLES as readonly string[]).includes(value)
  );
}

export function normalizeRoleChangeReason(reason: unknown): string | null {
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseSetRoleRequestBody(
  body: unknown
):
  | { ok: true; value: SetRoleRequestBody }
  | { ok: false; code: string; message: string; status: number } {
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      code: 'INVALID_BODY',
      message: 'Request body must be a JSON object.',
      status: 400,
    };
  }
  const record = body as Record<string, unknown>;
  const userId = typeof record.userId === 'string' ? record.userId.trim() : '';
  if (!userId) {
    return {
      ok: false,
      code: USER_NOT_FOUND_CODE,
      message: 'userId is required.',
      status: 400,
    };
  }

  if (!isPlatformRole(record.role)) {
    return {
      ok: false,
      code: INVALID_ROLE_CODE,
      message: 'role must be admin or user.',
      status: 400,
    };
  }

  const reason = normalizeRoleChangeReason(record.reason);
  if (!reason) {
    return {
      ok: false,
      code: REASON_REQUIRED_CODE,
      message: 'reason is required and must be non-empty.',
      status: 400,
    };
  }

  return {
    ok: true,
    value: { userId, role: record.role, reason },
  };
}

function roleChangeErrorResponse(
  code: string,
  message: string,
  status: number
): Response {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    { status }
  );
}

function mapPlatformRoleChangeError(error: PlatformRoleChangeError): Response {
  switch (error.code) {
    case LAST_ADMIN_REQUIRED_CODE:
      return roleChangeErrorResponse(
        LAST_ADMIN_REQUIRED_CODE,
        'Cannot demote the last platform admin.',
        409
      );
    case USER_NOT_FOUND_CODE:
      return roleChangeErrorResponse(
        USER_NOT_FOUND_CODE,
        'User not found.',
        404
      );
    case ROLE_UNCHANGED_CODE:
      return roleChangeErrorResponse(
        ROLE_UNCHANGED_CODE,
        'User already has the requested role.',
        400
      );
    case INVALID_ROLE_CODE:
      return roleChangeErrorResponse(
        INVALID_ROLE_CODE,
        'role must be admin or user.',
        400
      );
    case REASON_REQUIRED_CODE:
      return roleChangeErrorResponse(
        REASON_REQUIRED_CODE,
        'reason is required and must be non-empty.',
        400
      );
    default:
      return roleChangeErrorResponse('ROLE_CHANGE_FAILED', error.message, 500);
  }
}

/**
 * Core transactional role change: lock → last-admin check → update role →
 * immutable audit insert → delete all subject sessions. Any failure rolls back.
 */
export async function applyPlatformRoleChange(
  database: RoleChangeDatabase,
  input: ApplyPlatformRoleChangeInput
): Promise<ApplyPlatformRoleChangeResult> {
  const reason = normalizeRoleChangeReason(input.reason);
  if (!reason) {
    throw new PlatformRoleChangeError(
      REASON_REQUIRED_CODE,
      'reason is required and must be non-empty.'
    );
  }
  if (!isPlatformRole(input.toRole)) {
    throw new PlatformRoleChangeError(
      INVALID_ROLE_CODE,
      'role must be admin or user.'
    );
  }

  return database.transaction(async (tx) => {
    // Serialize last-admin checks with the existing DB trigger lock.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${LAST_PLATFORM_ADMIN_LOCK_KEY}))`
    );

    const subjectRows = await tx
      .select({
        id: authUser.id,
        role: authUser.role,
      })
      .from(authUser)
      .where(eq(authUser.id, input.subjectUserId))
      .limit(1)
      .for('update');

    const subject = subjectRows[0] as
      | { id: string; role: string | null }
      | undefined;
    if (!subject) {
      throw new PlatformRoleChangeError(USER_NOT_FOUND_CODE, 'User not found.');
    }

    const fromRole = subject.role ?? PLATFORM_ROLE_USER;
    if (fromRole === input.toRole) {
      throw new PlatformRoleChangeError(
        ROLE_UNCHANGED_CODE,
        'User already has the requested role.'
      );
    }

    if (
      fromRole === PLATFORM_ROLE_ADMIN &&
      input.toRole !== PLATFORM_ROLE_ADMIN
    ) {
      const otherAdmins = await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(
          and(
            eq(authUser.role, PLATFORM_ROLE_ADMIN),
            ne(authUser.id, input.subjectUserId)
          )
        )
        .limit(1);

      if (otherAdmins.length === 0) {
        throw new PlatformRoleChangeError(
          LAST_ADMIN_REQUIRED_CODE,
          'Cannot demote the last platform admin.'
        );
      }
    }

    await tx
      .update(authUser)
      .set({
        role: input.toRole,
        updatedAt: new Date(),
      })
      .where(eq(authUser.id, input.subjectUserId));

    const auditId = crypto.randomUUID();
    await tx.insert(adminRoleChangeAudit).values({
      id: auditId,
      actorUserId: input.actorUserId,
      subjectUserId: input.subjectUserId,
      fromRole,
      toRole: input.toRole,
      reason,
      createdAt: new Date(),
    });

    const deleted = await tx
      .delete(authSession)
      .where(eq(authSession.userId, input.subjectUserId))
      .returning({ id: authSession.id });

    return {
      subjectUserId: input.subjectUserId,
      fromRole,
      toRole: input.toRole,
      auditId,
      sessionsDeleted: deleted.length,
    };
  });
}

export type HandleAdminSetRoleOptions = {
  /**
   * Admin + step-up gate. Defaults to requireRecentAdminSession
   * (which uses the authoritative active-session guard).
   */
  resolveAdminSession?: (request: Request) => Promise<RecentAdminSessionResult>;
  /** Defaults to getDb(). Injectable for pure unit tests. */
  getDatabase?: () => RoleChangeDatabase | Promise<RoleChangeDatabase>;
  /** Defaults to applyPlatformRoleChange. */
  applyChange?: (
    database: RoleChangeDatabase,
    input: ApplyPlatformRoleChangeInput
  ) => Promise<ApplyPlatformRoleChangeResult>;
};

async function defaultGetDatabase(): Promise<RoleChangeDatabase> {
  const { getDb } = await import('@/db');
  return getDb() as unknown as RoleChangeDatabase;
}

/**
 * HTTP handler for POST /api/auth/admin/set-role.
 * Auth and recent-authentication are enforced here because this path never
 * reaches Better Auth's recentAuthenticationHook.
 */
export async function handleAdminSetRole(
  request: Request,
  options: HandleAdminSetRoleOptions = {}
): Promise<Response> {
  if (request.method !== 'POST') {
    return roleChangeErrorResponse(
      METHOD_NOT_ALLOWED_CODE,
      'Method not allowed.',
      405
    );
  }

  const resolveAdminSession =
    options.resolveAdminSession ??
    ((req: Request) => requireRecentAdminSession(req));
  // When tests inject applyChange without a Workers DB, skip getDb().
  const getDatabase =
    options.getDatabase ??
    (options.applyChange
      ? async () =>
          ({
            transaction: async (fn) => fn({}),
          }) as RoleChangeDatabase
      : defaultGetDatabase);
  const applyChange = options.applyChange ?? applyPlatformRoleChange;

  const adminGate = await resolveAdminSession(request);
  if (!adminGate.ok) {
    return adminGate.response;
  }
  const actor = adminGate.session;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return roleChangeErrorResponse(
      'INVALID_BODY',
      'Request body must be valid JSON.',
      400
    );
  }

  const parsed = parseSetRoleRequestBody(rawBody);
  if (!parsed.ok) {
    return roleChangeErrorResponse(parsed.code, parsed.message, parsed.status);
  }

  try {
    const database = await getDatabase();
    const result = await applyChange(database, {
      actorUserId: actor.user.id,
      subjectUserId: parsed.value.userId,
      toRole: parsed.value.role,
      reason: parsed.value.reason,
    });

    return Response.json(
      {
        user: {
          id: result.subjectUserId,
          role: result.toRole,
        },
        audit: {
          id: result.auditId,
          actorUserId: actor.user.id,
          subjectUserId: result.subjectUserId,
          fromRole: result.fromRole,
          toRole: result.toRole,
          reason: parsed.value.reason,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof PlatformRoleChangeError) {
      return mapPlatformRoleChangeError(error);
    }
    // Surface the DB last-admin trigger if the app-level check races.
    if (error instanceof Error && /LAST_ADMIN_REQUIRED/u.test(error.message)) {
      return mapPlatformRoleChangeError(
        new PlatformRoleChangeError(
          LAST_ADMIN_REQUIRED_CODE,
          'Cannot demote the last platform admin.'
        )
      );
    }
    console.error('admin set-role failed', {
      event: 'ADMIN_SET_ROLE_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
    return roleChangeErrorResponse(
      'ROLE_CHANGE_FAILED',
      'Failed to change user role.',
      500
    );
  }
}

/** Convenience re-export for callers that only need the actor type. */
export type { AuthSession };
