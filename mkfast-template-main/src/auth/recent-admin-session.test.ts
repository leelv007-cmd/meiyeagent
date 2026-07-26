import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = { HYPERDRIVE: { connectionString: "postgres://127.0.0.1/test" } }',
      };
    }
    if (specifier === '@/config/website') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const websiteConfig = { auth: {}, metadata: { name: "test" } }',
      };
    }
    if (specifier === '@/mail') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const sendEmail = async () => ({ success: true })',
      };
    }
    if (specifier === '@/lib/urls') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const getBaseUrl = () => "http://localhost:3000"',
      };
    }
    return nextResolve(specifier, context);
  },
});

const { requireRecentAdminSession } = await import('./recent-admin-session');

test('recent admin failures preserve the existing middleware response shape', async () => {
  const request = new Request('http://localhost/api/admin');
  const unauthorized = await requireRecentAdminSession(
    request,
    async () => null
  );
  assert.equal(unauthorized.ok, false);
  if (unauthorized.ok) return;
  assert.equal(unauthorized.response.status, 401);
  assert.deepEqual(await unauthorized.response.json(), {
    error: 'Unauthorized',
    success: false,
  });

  const forbidden = await requireRecentAdminSession(request, async () => ({
    session: { createdAt: new Date() },
    user: { emailVerified: true, id: 'user-a', role: 'user' },
  }));
  assert.equal(forbidden.ok, false);
  if (forbidden.ok) return;
  assert.equal(forbidden.response.status, 403);
  assert.deepEqual(await forbidden.response.json(), {
    error: 'Forbidden',
    success: false,
  });
});

test('default session getter dynamically imports auth under Node 24', async () => {
  const result = await requireRecentAdminSession(
    new Request('http://localhost/api/admin')
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 401);
  assert.deepEqual(await result.response.json(), {
    error: 'Unauthorized',
    success: false,
  });
});
