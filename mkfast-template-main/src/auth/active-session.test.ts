import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expiredSessionCookieHeaders,
  requireActiveSession,
  type RequireActiveSessionResult,
} from './active-session';

/**
 * Real cookie-cache session shape: Better Auth returns full session+user from
 * session_data without consulting the database. Ban/revoke only show up after
 * the authoritative token check — not from the cached user.banned field.
 */
function cookieCacheSession(overrides?: {
  bannedInCache?: boolean;
  token?: string;
  userId?: string;
}) {
  const userId = overrides?.userId ?? 'merchant-1';
  return {
    session: {
      id: 'sess-cache-1',
      token: overrides?.token ?? 'cached-session-token',
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      expiresAt: new Date('2026-08-08T10:00:00.000Z'),
      userId,
    },
    user: {
      id: userId,
      emailVerified: true,
      role: 'user' as string | null,
      // Stale cache still claims the user is active after an admin ban.
      banned: overrides?.bannedInCache ?? false,
    },
  };
}

function setCookieValues(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

function assertCookiesExpired(result: RequireActiveSessionResult) {
  assert.equal(result.ok, false);
  if (result.ok) return;
  const cookies = setCookieValues(result.response);
  assert.ok(cookies.length > 0, 'rejection must clear session cookies');
  assert.ok(
    cookies.some(
      (value) => value.includes('session_token') && /Max-Age=0/iu.test(value)
    ),
    'session_token must expire'
  );
  assert.ok(
    cookies.some(
      (value) => value.includes('session_data') && /Max-Age=0/iu.test(value)
    ),
    'session_data must expire'
  );
}

test('rejects when cookie cache hits but the session token was revoked', async () => {
  const cached = cookieCacheSession();
  let authorityCalls = 0;

  const result = await requireActiveSession({
    headers: new Headers({ cookie: 'better-auth.session_data=stale-cache' }),
    readCachedSession: async () => cached,
    verifyAuthority: async (input) => {
      authorityCalls += 1;
      assert.equal(input.token, 'cached-session-token');
      assert.equal(input.userId, 'merchant-1');
      return 'revoked';
    },
  });

  assert.equal(authorityCalls, 1);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'revoked');
  assert.equal(result.response.status, 401);
  assert.deepEqual(await result.response.json(), {
    error: 'Unauthorized',
    code: 'SESSION_REVOKED',
  });
  assertCookiesExpired(result);
});

test('rejects when cookie cache hits but the user is banned', async () => {
  // Cache still carries banned:false — authority is the only truth for ban.
  const cached = cookieCacheSession({ bannedInCache: false });

  const result = await requireActiveSession({
    headers: new Headers({ cookie: 'better-auth.session_data=stale-cache' }),
    readCachedSession: async () => cached,
    verifyAuthority: async () => 'banned',
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'banned');
  assert.equal(result.response.status, 401);
  assert.deepEqual(await result.response.json(), {
    error: 'Unauthorized',
    code: 'USER_BANNED',
  });
  assertCookiesExpired(result);
});

test('accepts a cookie-cache session when authority still finds it active', async () => {
  const cached = cookieCacheSession();
  const result = await requireActiveSession({
    headers: new Headers(),
    readCachedSession: async () => cached,
    verifyAuthority: async () => 'active',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.session.user.id, 'merchant-1');
  assert.equal(result.session.session.token, 'cached-session-token');
});

test('expired cookie header list covers session_token and session_data', () => {
  const headers = expiredSessionCookieHeaders();
  assert.ok(headers.some((h) => h.startsWith('better-auth.session_token=')));
  assert.ok(headers.some((h) => h.startsWith('better-auth.session_data=')));
  assert.ok(headers.every((h) => /Max-Age=0/iu.test(h)));
});
