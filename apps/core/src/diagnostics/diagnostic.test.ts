import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createCoreServer } from '../server.js';

const retiredRoutes = [
  { method: 'POST', pathname: '/v1/diagnostics' },
  { method: 'GET', pathname: '/v1/diagnostics/historical-run/events' },
  { method: 'POST', pathname: '/v1/diagnostics/historical-run/resume' },
] as const;

test('diagnostic endpoints keep a minimal authenticated 410 tombstone', async (t) => {
  const server = createCoreServer({ serviceToken: 'test-service-token' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  for (const route of retiredRoutes) {
    const response = await fetch(`http://127.0.0.1:${port}${route.pathname}`, {
      method: route.method,
      headers: { 'x-service-token': 'test-service-token' },
    });
    assert.equal(response.status, 410);
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };
    assert.equal(payload.error.code, 'DIAGNOSTIC_CONTENT_GENERATION_RETIRED');
    assert.match(payload.error.message, /ModelSupply/u);
  }
});
