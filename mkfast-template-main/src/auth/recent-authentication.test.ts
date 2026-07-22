import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RECENT_AUTHENTICATION_WINDOW_MS,
  RecentAuthenticationRequiredError,
  recentAuthenticationRequiredResponse,
  requireRecentAuthentication,
  requiresRecentAuthentication,
} from './recent-authentication';
import { createRecentAuthenticationHook } from './recent-authentication-hook';

describe('route-level recent authentication', () => {
  it('accepts a login inside the 15 minute window and rejects its boundary', () => {
    const now = new Date('2026-07-22T10:15:00.000Z');

    assert.doesNotThrow(() =>
      requireRecentAuthentication(
        { createdAt: new Date('2026-07-22T10:00:00.001Z') },
        now
      )
    );
    assert.throws(
      () =>
        requireRecentAuthentication(
          {
            createdAt: new Date(
              now.getTime() - RECENT_AUTHENTICATION_WINDOW_MS
            ),
          },
          now
        ),
      RecentAuthenticationRequiredError
    );
  });

  it('does not treat a refreshed session timestamp as a new authentication', () => {
    assert.throws(
      () =>
        requireRecentAuthentication(
          {
            createdAt: new Date('2026-07-22T09:00:00.000Z'),
            updatedAt: new Date('2026-07-22T10:14:59.000Z'),
          },
          new Date('2026-07-22T10:15:00.000Z')
        ),
      RecentAuthenticationRequiredError
    );
  });

  it('guards API key writes, account deletion and critical admin writes only', () => {
    for (const path of [
      '/api-key/create',
      '/api-key/update',
      '/api-key/delete',
      '/delete-user',
      '/admin/set-role',
      '/admin/create-user',
      '/admin/update-user',
      '/admin/ban-user',
      '/admin/unban-user',
      '/admin/impersonate-user',
      '/admin/revoke-user-session',
      '/admin/revoke-user-sessions',
      '/admin/remove-user',
      '/admin/set-user-password',
    ]) {
      assert.equal(requiresRecentAuthentication(path), true, path);
    }

    for (const path of [
      '/get-session',
      '/api-key/list',
      '/admin/list-users',
      '/admin/stop-impersonating',
    ]) {
      assert.equal(requiresRecentAuthentication(path), false, path);
    }
  });

  it('returns a stable 403 contract that clients can route to reauthentication', async () => {
    const response = recentAuthenticationRequiredResponse();

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: 'Recent authentication is required.',
      code: 'RECENT_AUTHENTICATION_REQUIRED',
    });
  });

  it('runs stale high-risk requests through the Better Auth before hook', async () => {
    const observed: Array<{
      path: string;
      options: { disableCookieCache?: boolean } | undefined;
    }> = [];
    const hook = createRecentAuthenticationHook(async (context, options) => {
      observed.push({ path: context.path, options });
      return {
        session: {
          createdAt: new Date(Date.now() - RECENT_AUTHENTICATION_WINDOW_MS),
        },
        user: {},
      } as never;
    });

    for (const path of ['/api-key/create', '/delete-user']) {
      await assert.rejects(hook({ path } as never), (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 403);
        assert.equal(
          (error as { body?: { code?: string } }).body?.code,
          'RECENT_AUTHENTICATION_REQUIRED'
        );
        return true;
      });
    }

    assert.deepEqual(observed, [
      {
        path: '/api-key/create',
        options: { disableCookieCache: true },
      },
      {
        path: '/delete-user',
        options: { disableCookieCache: true },
      },
    ]);
  });
});
