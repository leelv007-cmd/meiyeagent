import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  INVALID_ROLE_CODE,
  LAST_ADMIN_REQUIRED_CODE,
  PLATFORM_ROLE_ADMIN,
  PLATFORM_ROLE_USER,
  PlatformRoleChangeError,
  REASON_REQUIRED_CODE,
  ROLE_UNCHANGED_CODE,
  USER_NOT_FOUND_CODE,
  handleAdminSetRole,
  parseSetRoleRequestBody,
  type ApplyPlatformRoleChangeInput,
  type ApplyPlatformRoleChangeResult,
  type RoleChangeDatabase,
} from './admin-set-role';
import {
  AUTH_API_BASE_PATH,
  createAuthCatchAllHandlers,
} from './auth-endpoint-dispatch';
import type { AuthSession } from './recent-admin-session';
import { recentAuthenticationRequiredResponse } from './recent-authentication';

/**
 * Spec A / #366 — pure unit coverage for set-role validation, step-up gate,
 * promote/demote/last-admin/empty-reason branches. Postgres atomicity lives in
 * admin-set-role.postgres.test.ts (driver runs with TEST_DATABASE_URL).
 */

function adminSession(overrides?: Partial<AuthSession>): AuthSession {
  return {
    session: {
      createdAt: new Date(),
      token: 'admin-token',
      userId: 'actor-admin',
      ...overrides?.session,
    },
    user: {
      id: 'actor-admin',
      emailVerified: true,
      role: 'admin',
      banned: false,
      ...overrides?.user,
    },
  };
}

function setRoleRequest(body: unknown, method = 'POST') {
  return new Request(`http://localhost${AUTH_API_BASE_PATH}/admin/set-role`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test('parseSetRoleRequestBody requires userId, whitelist role, and non-empty reason', () => {
  assert.equal(parseSetRoleRequestBody(null).ok, false);
  assert.equal(
    parseSetRoleRequestBody({ userId: 'u1', role: 'admin', reason: '  ' }).ok,
    false
  );
  const emptyReason = parseSetRoleRequestBody({
    userId: 'u1',
    role: 'admin',
    reason: '',
  });
  assert.equal(emptyReason.ok, false);
  if (!emptyReason.ok) {
    assert.equal(emptyReason.code, REASON_REQUIRED_CODE);
  }

  const badRole = parseSetRoleRequestBody({
    userId: 'u1',
    role: 'superadmin',
    reason: 'nope',
  });
  assert.equal(badRole.ok, false);
  if (!badRole.ok) {
    assert.equal(badRole.code, INVALID_ROLE_CODE);
  }

  const ok = parseSetRoleRequestBody({
    userId: 'u1',
    role: 'user',
    reason: ' demote peer ',
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.value, {
      userId: 'u1',
      role: 'user',
      reason: 'demote peer',
    });
  }
});

test('rejects missing recent authentication before body validation side effects', async () => {
  let applied = 0;
  const response = await handleAdminSetRole(
    setRoleRequest({
      userId: 'subject-1',
      role: 'admin',
      reason: 'promote',
    }),
    {
      resolveAdminSession: async () => ({
        ok: false,
        response: recentAuthenticationRequiredResponse(),
      }),
      applyChange: async () => {
        applied += 1;
        throw new Error('should not apply');
      },
    }
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await readJson(response), {
    error: 'Recent authentication is required.',
    code: 'RECENT_AUTHENTICATION_REQUIRED',
  });
  assert.equal(applied, 0);
});

test('rejects empty reason for an admin with recent authentication', async () => {
  let applied = 0;
  const response = await handleAdminSetRole(
    setRoleRequest({
      userId: 'subject-1',
      role: 'admin',
      reason: '   ',
    }),
    {
      resolveAdminSession: async () => ({
        ok: true,
        session: adminSession(),
      }),
      applyChange: async () => {
        applied += 1;
        throw new Error('should not apply');
      },
    }
  );

  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.equal((body.error as { code: string }).code, REASON_REQUIRED_CODE);
  assert.equal(applied, 0);
});

test('promotes merchant to admin and returns audit fields', async () => {
  const captured: ApplyPlatformRoleChangeInput[] = [];
  const response = await handleAdminSetRole(
    setRoleRequest({
      userId: 'subject-1',
      role: PLATFORM_ROLE_ADMIN,
      reason: 'trusted peer',
    }),
    {
      resolveAdminSession: async () => ({
        ok: true,
        session: adminSession(),
      }),
      getDatabase: () =>
        ({ transaction: async (fn) => fn({}) }) as RoleChangeDatabase,
      applyChange: async (_db, input) => {
        captured.push(input);
        const result: ApplyPlatformRoleChangeResult = {
          subjectUserId: input.subjectUserId,
          fromRole: PLATFORM_ROLE_USER,
          toRole: input.toRole,
          auditId: 'audit-1',
          sessionsDeleted: 2,
        };
        return result;
      },
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), {
    user: { id: 'subject-1', role: 'admin' },
    audit: {
      id: 'audit-1',
      actorUserId: 'actor-admin',
      subjectUserId: 'subject-1',
      fromRole: 'user',
      toRole: 'admin',
      reason: 'trusted peer',
    },
  });
  assert.deepEqual(captured, [
    {
      actorUserId: 'actor-admin',
      subjectUserId: 'subject-1',
      toRole: 'admin',
      reason: 'trusted peer',
    },
  ]);
});

test('demotes admin to merchant (user role)', async () => {
  const response = await handleAdminSetRole(
    setRoleRequest({
      userId: 'subject-admin',
      role: PLATFORM_ROLE_USER,
      reason: 'step down',
    }),
    {
      resolveAdminSession: async () => ({
        ok: true,
        session: adminSession(),
      }),
      applyChange: async (_db, input) => ({
        subjectUserId: input.subjectUserId,
        fromRole: PLATFORM_ROLE_ADMIN,
        toRole: PLATFORM_ROLE_USER,
        auditId: 'audit-2',
        sessionsDeleted: 1,
      }),
    }
  );

  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal((body.user as { role: string }).role, 'user');
  assert.equal((body.audit as { fromRole: string }).fromRole, 'admin');
  assert.equal((body.audit as { toRole: string }).toRole, 'user');
});

test('rejects demoting the last platform admin', async () => {
  const response = await handleAdminSetRole(
    setRoleRequest({
      userId: 'only-admin',
      role: PLATFORM_ROLE_USER,
      reason: 'should fail',
    }),
    {
      resolveAdminSession: async () => ({
        ok: true,
        session: adminSession({
          user: { id: 'only-admin', emailVerified: true, role: 'admin' },
        }),
      }),
      applyChange: async () => {
        throw new PlatformRoleChangeError(
          LAST_ADMIN_REQUIRED_CODE,
          'Cannot demote the last platform admin.'
        );
      },
    }
  );

  assert.equal(response.status, 409);
  const body = await readJson(response);
  assert.equal((body.error as { code: string }).code, LAST_ADMIN_REQUIRED_CODE);
});

test('maps user-not-found and role-unchanged errors', async () => {
  const missing = await handleAdminSetRole(
    setRoleRequest({
      userId: 'missing',
      role: 'admin',
      reason: 'x',
    }),
    {
      resolveAdminSession: async () => ({
        ok: true,
        session: adminSession(),
      }),
      applyChange: async () => {
        throw new PlatformRoleChangeError(
          USER_NOT_FOUND_CODE,
          'User not found.'
        );
      },
    }
  );
  assert.equal(missing.status, 404);

  const unchanged = await handleAdminSetRole(
    setRoleRequest({
      userId: 'already',
      role: 'admin',
      reason: 'x',
    }),
    {
      resolveAdminSession: async () => ({
        ok: true,
        session: adminSession(),
      }),
      applyChange: async () => {
        throw new PlatformRoleChangeError(
          ROLE_UNCHANGED_CODE,
          'User already has the requested role.'
        );
      },
    }
  );
  assert.equal(unchanged.status, 400);
  assert.equal(
    ((await readJson(unchanged)).error as { code: string }).code,
    ROLE_UNCHANGED_CODE
  );
});

test('dispatch layer routes set-role through custom handler for promote and demote bodies', async () => {
  const outcomes: string[] = [];
  const handlers = createAuthCatchAllHandlers({
    handleAuth: async () => {
      outcomes.push('auth');
      return Response.json({ bad: true }, { status: 500 });
    },
    handleSetRole: async (request) => {
      const body = (await request.json()) as { role: string };
      outcomes.push(`set-role:${body.role}`);
      return Response.json({ ok: true, role: body.role }, { status: 200 });
    },
  });

  for (const role of ['admin', 'user'] as const) {
    const response = await handlers.POST({
      request: setRoleRequest({
        userId: 'subject',
        role,
        reason: 'test',
      }),
    });
    assert.equal(response.status, 200);
  }

  assert.deepEqual(outcomes, ['set-role:admin', 'set-role:user']);
});

test('migration defines immutable admin_role_change_audit table and trigger', async () => {
  const migration = await readFile(
    new URL('../../drizzle/0024_admin_role_change_audit.sql', import.meta.url),
    'utf8'
  );

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS "admin_role_change_audit"/u
  );
  assert.match(migration, /"actor_user_id"/u);
  assert.match(migration, /"subject_user_id"/u);
  assert.match(migration, /"from_role"/u);
  assert.match(migration, /"to_role"/u);
  assert.match(migration, /"reason"/u);
  assert.match(migration, /"created_at"/u);
  assert.match(
    migration,
    /BEFORE UPDATE OR DELETE ON "admin_role_change_audit"/u
  );
  assert.match(migration, /ADMIN_ROLE_CHANGE_AUDIT_IMMUTABLE/u);
});

test('single admin role only — no super-admin tier in set-role module', async () => {
  const source = await readFile(
    new URL('./admin-set-role.ts', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /super.?admin|superadmin|超管/iu);
  assert.match(source, /PLATFORM_ROLE_ADMIN = ADMIN_ROLE/u);
  assert.match(source, /PLATFORM_ROLE_USER = 'user'/u);
});
