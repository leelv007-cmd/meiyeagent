import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { DiagnosticRun } from '@meiye/contracts';

import type { DiagnosticRepository } from '../diagnostics/repository.js';
import { createCoreServer } from '../server.js';

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

test('pending-actions HTTP route keeps service auth and hides cross-workspace reads as 404', async (t) => {
  const reads: Array<{ userId: string; workspaceId: string }> = [];
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    pendingActions: {
      async list(input) {
        reads.push(input);
        return [];
      },
    },
    serviceToken: 'pending-actions-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/pending-actions`;
  const headers = {
    'x-service-token': 'pending-actions-token',
    'x-user-id': 'owner-a',
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': 'owner',
  };

  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
  assert.deepEqual(reads, [{ userId: 'owner-a', workspaceId: 'workspace-a' }]);

  const hidden = await fetch(url, {
    headers: { ...headers, 'x-workspace-id': 'workspace-b' },
  });
  assert.equal(hidden.status, 404);
  assert.equal((await hidden.json()).error.code, 'NOT_FOUND');
  assert.equal(reads.length, 1);

  const unauthenticated = await fetch(url, {
    headers: { ...headers, 'x-service-token': 'wrong' },
  });
  assert.equal(unauthenticated.status, 401);
});
