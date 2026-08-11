import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createCoreServer } from '../../server.js';
import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import {
  AdminConfigFoundationModule,
  MemoryAdminConfigRepository,
} from './foundation-module.js';

test('admin config uses the shared HTTP command and query seam', async (t) => {
  const foundation = new MemoryFoundationRepository();
  foundation.grantOwner('workspace-a', 'owner-a');
  const config = new MemoryAdminConfigRepository();
  const server = createCoreServer({
    p1ApplicationService: new P1ApplicationService(foundation, {
      operations: [new AdminConfigFoundationModule(config)],
    }),
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1`;
  const adminHeaders = {
    'content-type': 'application/json',
    'x-core-actor': 'admin',
    'x-correlation-id': 'admin-config-http',
    'x-service-token': 'test-service-token',
    'x-user-id': 'platform-admin',
    'x-workspace-id': 'workspace-a',
  };
  const commandBody = {
    action: 'config_apply',
    module: 'admin-config',
    payload: {
      key: 'model.execution.mode',
      value: 'direct',
      expectedRevision: null,
      reason: 'Prepare direct execution',
    },
  };

  const applied = await fetch(`${base}/commands`, {
    method: 'POST',
    headers: { ...adminHeaders, 'idempotency-key': 'admin-config-http-1' },
    body: JSON.stringify(commandBody),
  });
  assert.equal(applied.status, 200);
  assert.equal(
    ((await applied.json()) as { data: { revision: number } }).data.revision,
    1,
  );

  const replayed = await fetch(`${base}/commands`, {
    method: 'POST',
    headers: { ...adminHeaders, 'idempotency-key': 'admin-config-http-1' },
    body: JSON.stringify(commandBody),
  });
  assert.equal(replayed.status, 200);

  const conflicting = await fetch(`${base}/commands`, {
    method: 'POST',
    headers: { ...adminHeaders, 'idempotency-key': 'admin-config-http-1' },
    body: JSON.stringify({
      ...commandBody,
      payload: { ...commandBody.payload, value: 'gateway' },
    }),
  });
  assert.equal(conflicting.status, 409);
  assert.equal(
    ((await conflicting.json()) as { error: { code: string } }).error.code,
    'IDEMPOTENCY_CONFLICT',
  );

  const history = await fetch(`${base}/query`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      action: 'config_history',
      module: 'admin-config',
      payload: { key: 'model.execution.mode' },
    }),
  });
  assert.equal(history.status, 200);
  assert.deepEqual(
    (
      (await history.json()) as {
        data: Array<{ revision: number }>;
      }
    ).data.map((revision) => revision.revision),
    [1],
  );

  const merchantDenied = await fetch(`${base}/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': 'owner-config-http',
      'x-service-token': 'test-service-token',
      'x-user-id': 'owner-a',
      'x-workspace-id': 'workspace-a',
      'x-workspace-role': 'owner',
    },
    body: JSON.stringify({
      action: 'config_list',
      module: 'admin-config',
      payload: {},
    }),
  });
  assert.equal(merchantDenied.status, 403);
});
