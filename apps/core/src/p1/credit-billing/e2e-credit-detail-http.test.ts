import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { DiagnosticRun } from '@meiye/contracts';

import type { DiagnosticRepository } from '../../diagnostics/repository.js';
import { createCoreServer } from '../../server.js';

const diagnostics: DiagnosticRepository = {
  async create(run: DiagnosticRun) {
    return run;
  },
  async get() {
    return null;
  },
  async save(run: DiagnosticRun) {
    return run;
  },
};

test('e2e credit detail fixture is service-only and uses the trusted workspace', async (t) => {
  const seeded: string[] = [];
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    e2eCreditDetailFixture: {
      async seed(input) {
        seeded.push(input.workspaceId);
        return { ready: true };
      },
    },
    e2eFixtureEnabled: true,
    serviceToken: 'e2e-credit-detail-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/e2e/credit-detail-fixture`;
  const headers = {
    'x-service-token': 'e2e-credit-detail-token',
    'x-user-id': 'merchant-user',
    'x-workspace-id': 'merchant-workspace',
    'x-workspace-role': 'owner',
  };

  const response = await fetch(url, { headers, method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { ready: true });
  assert.deepEqual(seeded, ['merchant-workspace']);

  const unauthorized = await fetch(url, {
    headers: { ...headers, 'x-service-token': 'wrong-token' },
    method: 'POST',
  });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(seeded, ['merchant-workspace']);
});

test('e2e credit detail fixture fails closed when a non-e2e assembly injects it', async (t) => {
  const seeded: string[] = [];
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    e2eCreditDetailFixture: {
      async seed(input) {
        seeded.push(input.workspaceId);
        return { ready: true };
      },
    },
    serviceToken: 'e2e-credit-detail-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/e2e/credit-detail-fixture`,
    {
      headers: {
        'x-service-token': 'e2e-credit-detail-token',
        'x-user-id': 'merchant-user',
        'x-workspace-id': 'merchant-workspace',
        'x-workspace-role': 'owner',
      },
      method: 'POST',
    },
  );
  assert.equal(response.status, 404);
  assert.deepEqual(seeded, []);
});
