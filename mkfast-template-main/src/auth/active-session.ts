import type { AuthSession } from '@/auth/recent-admin-session';

/**
 * Authoritative active-session guard (Spec A / #364).
 *
 * Cookie cache may still supply non-authorization session payload, but every
 * protected request re-checks the current session token against session+user:
 * missing session (revoked after ban) or banned user → reject and expire cookies.
 * Cookie cache itself stays enabled in auth config.
 */

export type ActiveSessionRejectReason = 'missing' | 'revoked' | 'banned';

export type CachedSessionReader = (options: {
  headers: Headers;
  query?: {
    disableCookieCache?: boolean;
    disableRefresh?: boolean;
  };
}) => Promise<AuthSession | null>;

export type ActiveSessionAuthority = (input: {
  token: string;
  userId: string;
}) => Promise<'active' | 'revoked' | 'banned'>;

export type RequireActiveSessionOptions = {
  headers: Headers;
  query?: {
    disableCookieCache?: boolean;
    disableRefresh?: boolean;
  };
  /** Defaults to Better Auth getSession (cookie cache allowed). */
  readCachedSession?: CachedSessionReader;
  /** Defaults to a minimal session+user join by token. */
  verifyAuthority?: ActiveSessionAuthority;
};

export type RequireActiveSessionResult =
  | { ok: true; session: AuthSession }
  | {
      ok: false;
      reason: ActiveSessionRejectReason;
      response: Response;
    };

const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  'better-auth.session_data',
  '__Secure-better-auth.session_token',
  '__Secure-better-auth.session_data',
] as const;

/** Set-Cookie values that expire Better Auth session cookies. */
export function expiredSessionCookieHeaders(): string[] {
  return SESSION_COOKIE_NAMES.map(
    (name) =>
      `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${
        name.startsWith('__Secure-') ? '; Secure' : ''
      }`
  );
}

export function applyExpiredSessionCookies(headers: Headers): void {
  for (const cookie of expiredSessionCookieHeaders()) {
    headers.append('Set-Cookie', cookie);
  }
}

/**
 * Clears session cookies via the TanStack request cookie store so route
 * redirects (which do not return our JSON Response) still drop a dead session.
 * No-ops outside a request context (unit tests).
 */
export async function expireSessionCookiesInRequestContext(): Promise<void> {
  try {
    const { deleteCookie } = await import('@tanstack/react-start/server');
    for (const name of SESSION_COOKIE_NAMES) {
      deleteCookie(name, { path: '/' });
    }
  } catch {
    // Unit tests and non-TanStack callers rely on Set-Cookie response headers.
  }
}

export function inactiveSessionResponse(
  reason: ActiveSessionRejectReason,
  init?: { body?: Record<string, unknown>; status?: number }
): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  applyExpiredSessionCookies(headers);
  return new Response(
    JSON.stringify(
      init?.body ?? {
        error: 'Unauthorized',
        code:
          reason === 'banned'
            ? 'USER_BANNED'
            : reason === 'revoked'
              ? 'SESSION_REVOKED'
              : 'UNAUTHORIZED',
      }
    ),
    { status: init?.status ?? 401, headers }
  );
}

async function defaultReadCachedSession(
  options: Parameters<CachedSessionReader>[0]
): Promise<AuthSession | null> {
  const { createAuth } = await import('./auth');
  return createAuth().api.getSession(options) as Promise<AuthSession | null>;
}

async function defaultVerifyAuthority(input: {
  token: string;
  userId: string;
}): Promise<'active' | 'revoked' | 'banned'> {
  const { getDb } = await import('@/db');
  const { session, user } = await import('@/db/auth.schema');
  const { and, eq } = await import('drizzle-orm');
  const db = getDb();
  const [row] = await db
    .select({
      banned: user.banned,
      userId: user.id,
    })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(
      and(eq(session.token, input.token), eq(session.userId, input.userId))
    )
    .limit(1);

  if (!row) return 'revoked';
  if (row.banned === true) return 'banned';
  return 'active';
}

/**
 * Shared guard for every protected page, server function, BFF Core proxy,
 * file/API, and admin request. Reuses cookie-cache payload for non-auth fields
 * after the authoritative token check passes.
 */
export async function requireActiveSession(
  options: RequireActiveSessionOptions
): Promise<RequireActiveSessionResult> {
  const readCachedSession =
    options.readCachedSession ?? defaultReadCachedSession;
  const verifyAuthority = options.verifyAuthority ?? defaultVerifyAuthority;

  const cached = await readCachedSession({
    headers: options.headers,
    query: options.query,
  });

  if (!cached?.user?.id) {
    return {
      ok: false,
      reason: 'missing',
      response: inactiveSessionResponse('missing'),
    };
  }

  const token = cached.session.token;
  if (!token) {
    await expireSessionCookiesInRequestContext();
    return {
      ok: false,
      reason: 'revoked',
      response: inactiveSessionResponse('revoked'),
    };
  }

  const status = await verifyAuthority({
    token,
    userId: cached.user.id,
  });

  if (status === 'active') {
    return { ok: true, session: cached };
  }

  await expireSessionCookiesInRequestContext();
  return {
    ok: false,
    reason: status,
    response: inactiveSessionResponse(status),
  };
}
