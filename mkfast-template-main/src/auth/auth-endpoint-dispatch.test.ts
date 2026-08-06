import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  AUTH_API_BASE_PATH,
  AUTH_ENDPOINT_NOT_FOUND_CODE,
  DISABLED_AUTH_ADMIN_ENDPOINTS,
  createAuthCatchAllHandlers,
  resolveAuthEndpointDispatch,
  toAuthRelativePath,
} from './auth-endpoint-dispatch';
import { createAuthPlugins } from './plugins';

/**
 * Spec A / #365: bare admin endpoints 404 at the auth catch-all dispatch layer.
 * Admin vs non-admin both get 404 (no role gate — the surface is removed).
 */

const PRESERVED_PASS_THROUGH_PATHS = [
  '/delete-user',
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/create-user',
  '/admin/update-user',
  '/admin/set-role',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/request-password-reset',
  '/reset-password',
  '/get-session',
] as const;

function fullAuthUrl(relativePath: string) {
  return `http://localhost${AUTH_API_BASE_PATH}${relativePath}`;
}

function authRequest(
  relativePath: string,
  options?: { method?: string; cookie?: string }
) {
  return new Request(fullAuthUrl(relativePath), {
    method: options?.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options?.cookie ? { cookie: options.cookie } : {}),
    },
    body: JSON.stringify({ userId: 'anyone' }),
  });
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test('toAuthRelativePath strips the Better Auth base path exactly', () => {
  assert.equal(toAuthRelativePath('/api/auth/admin/remove-user'), '/admin/remove-user');
  assert.equal(toAuthRelativePath('/api/auth/delete-user'), '/delete-user');
  assert.equal(toAuthRelativePath('/api/auth'), '/');
  assert.equal(toAuthRelativePath('/api/auth/'), '/');
  assert.equal(
    toAuthRelativePath('/admin/remove-user'),
    '/admin/remove-user'
  );
  // Trailing slash on a resource path is normalized for exact match.
  assert.equal(
    toAuthRelativePath('/api/auth/admin/remove-user/'),
    '/admin/remove-user'
  );
});

test('resolveAuthEndpointDispatch only disables the three bare admin paths', () => {
  for (const relative of DISABLED_AUTH_ADMIN_ENDPOINTS) {
    assert.deepEqual(
      resolveAuthEndpointDispatch(`${AUTH_API_BASE_PATH}${relative}`),
      { kind: 'not_found' },
      relative
    );
  }

  for (const relative of PRESERVED_PASS_THROUGH_PATHS) {
    assert.deepEqual(
      resolveAuthEndpointDispatch(`${AUTH_API_BASE_PATH}${relative}`),
      { kind: 'forward' },
      relative
    );
  }

  // Prefix lookalikes must not match (exact-match only).
  assert.deepEqual(
    resolveAuthEndpointDispatch('/api/auth/admin/remove-user-extra'),
    { kind: 'forward' }
  );
  assert.deepEqual(
    resolveAuthEndpointDispatch('/api/auth/admin/remove-user/nested'),
    { kind: 'forward' }
  );
});

test('disabled bare admin endpoints 404 for admin and non-admin without calling Better Auth', async () => {
  const roles = [
    {
      label: 'admin',
      cookie: 'better-auth.session_token=admin-session-token',
    },
    {
      label: 'non-admin',
      cookie: 'better-auth.session_token=merchant-session-token',
    },
    { label: 'anonymous', cookie: undefined },
  ] as const;

  for (const relative of DISABLED_AUTH_ADMIN_ENDPOINTS) {
    for (const role of roles) {
      const calls: Request[] = [];
      const handlers = createAuthCatchAllHandlers({
        handleAuth: async (request) => {
          calls.push(request);
          return Response.json({ ok: true }, { status: 200 });
        },
      });

      const response = await handlers.POST({
        request: authRequest(relative, { cookie: role.cookie }),
      });

      assert.equal(
        response.status,
        404,
        `${relative} as ${role.label} must be 404`
      );
      const body = await readJson(response);
      assert.deepEqual(body, {
        error: {
          code: AUTH_ENDPOINT_NOT_FOUND_CODE,
          message: 'Not found.',
        },
      });
      assert.equal(
        calls.length,
        0,
        `${relative} as ${role.label} must not reach Better Auth`
      );
    }
  }
});

test('GET on disabled bare admin endpoints also 404s without calling Better Auth', async () => {
  for (const relative of DISABLED_AUTH_ADMIN_ENDPOINTS) {
    const calls: Request[] = [];
    const handlers = createAuthCatchAllHandlers({
      handleAuth: async (request) => {
        calls.push(request);
        return Response.json({ ok: true }, { status: 200 });
      },
    });

    const response = await handlers.GET({
      request: new Request(fullAuthUrl(relative), { method: 'GET' }),
    });

    assert.equal(response.status, 404, relative);
    const body = await readJson(response);
    assert.equal(
      (body.error as { code: string }).code,
      AUTH_ENDPOINT_NOT_FOUND_CODE
    );
    assert.equal(calls.length, 0, relative);
  }
});

test('self-serve delete-user and live admin/password-reset paths still forward', async () => {
  for (const relative of PRESERVED_PASS_THROUGH_PATHS) {
    const calls: Request[] = [];
    const handlers = createAuthCatchAllHandlers({
      handleAuth: async (request) => {
        calls.push(request);
        return Response.json(
          { forwarded: new URL(request.url).pathname },
          { status: 200 }
        );
      },
    });

    const response = await handlers.POST({
      request: authRequest(relative),
    });

    assert.equal(response.status, 200, relative);
    assert.equal(calls.length, 1, relative);
    assert.equal(
      new URL(calls[0]!.url).pathname,
      `${AUTH_API_BASE_PATH}${relative}`
    );
    const body = await readJson(response);
    assert.equal(body.forwarded, `${AUTH_API_BASE_PATH}${relative}`);
  }
});

test('route module binds the injectable catch-all handlers', async () => {
  const route = await import('@/routes/api/auth/$');
  assert.equal(typeof route.authCatchAllHandlers.GET, 'function');
  assert.equal(typeof route.authCatchAllHandlers.POST, 'function');
});

test('Better Auth admin plugin remains registered', async () => {
  const plugins = createAuthPlugins();
  assert.ok(
    plugins.some((plugin) => plugin.id === 'admin'),
    'admin plugin must stay registered'
  );

  const pluginsSource = await readFile(
    new URL('./plugins.ts', import.meta.url),
    'utf8'
  );
  assert.match(pluginsSource, /admin\(/u);
  assert.match(pluginsSource, /createAdminPlugin\(\)/u);
});
