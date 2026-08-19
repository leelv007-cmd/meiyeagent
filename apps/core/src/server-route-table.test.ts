import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { coreRouteTableOf, createCoreServer } from './server.js';

test('Core HTTP route table is built once and sealed across two requests', async (t) => {
  const server = createCoreServer({ serviceToken: 'test-service-token' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const table = coreRouteTableOf(server);
  assert.equal(table.isSealed, true);
  assert.equal(table.identity, table);

  const { port } = server.address() as AddressInfo;
  const first = await fetch(`http://127.0.0.1:${port}/health`);
  const second = await fetch(`http://127.0.0.1:${port}/health/live`);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(coreRouteTableOf(server), table);
  assert.equal(coreRouteTableOf(server).identity, table.identity);

  assert.throws(
    () =>
      table.add('capabilities', [
        'GET',
        ({ url }) => url.pathname === '/capabilities',
        'public',
        () => undefined,
      ]),
    { message: 'Route table is sealed.' },
  );
});
