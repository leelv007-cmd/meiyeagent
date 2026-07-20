import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { DiagnosticRun } from '@meiye/contracts';
import { createCoreServer } from '../server.js';
import type { DiagnosticIdentity, DiagnosticRepository } from './repository.js';

class MemoryDiagnosticRepository implements DiagnosticRepository {
  private readonly runs = new Map<
    string,
    { identity: DiagnosticIdentity; run: DiagnosticRun }
  >();
  createCalls = 0;
  saveCalls = 0;

  seed(run: DiagnosticRun, identity: DiagnosticIdentity) {
    this.runs.set(run.id, { identity, run });
  }

  async create(run: DiagnosticRun, _key: string, identity: DiagnosticIdentity) {
    this.createCalls += 1;
    this.runs.set(run.id, { identity, run });
    return run;
  }

  async get(id: string, identity: DiagnosticIdentity) {
    const stored = this.runs.get(id);
    if (
      stored?.identity.userId !== identity.userId ||
      stored.identity.workspaceId !== identity.workspaceId
    ) {
      return null;
    }
    return stored.run;
  }

  async save(run: DiagnosticRun, identity: DiagnosticIdentity) {
    this.saveCalls += 1;
    this.runs.set(run.id, { identity, run });
    return run;
  }
}

async function listen(repository: DiagnosticRepository) {
  const server = createCoreServer({
    diagnosticRepository: repository,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, server };
}

const authorizedHeaders = {
  'content-type': 'application/json',
  'x-service-token': 'test-service-token',
  'x-user-id': 'owner',
  'x-workspace-id': 'workspace-1',
};

test('health check remains available without invoking content generation', async (t) => {
  const repository = new MemoryDiagnosticRepository();
  const { baseUrl, server } = await listen(repository);
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: { service: string; status: string };
    meta: { correlationId: string };
  };
  assert.deepEqual(payload.data, { service: 'meiye-core', status: 'ok' });
  assert.ok(payload.meta.correlationId.length > 0);
  assert.equal(repository.createCalls, 0);
  assert.equal(repository.saveCalls, 0);
});

test('content-generation diagnostics are explicitly retired', async (t) => {
  const repository = new MemoryDiagnosticRepository();
  const { baseUrl, server } = await listen(repository);
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/v1/diagnostics`, {
    method: 'POST',
    headers: authorizedHeaders,
    body: JSON.stringify({ request: '为门店生成一条内容' }),
  });
  assert.equal(response.status, 410);
  const payload = (await response.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(payload.error.code, 'DIAGNOSTIC_CONTENT_GENERATION_RETIRED');
  assert.match(payload.error.message, /ModelSupply/);
  assert.equal(repository.createCalls, 0);
  assert.equal(repository.saveCalls, 0);
});

test('historical diagnostic progress remains readable by its owner', async (t) => {
  const repository = new MemoryDiagnosticRepository();
  repository.seed(
    {
      id: 'historical-run',
      correlationId: 'corr-historical',
      status: 'waiting_for_user',
      events: ['历史诊断事件'],
    },
    { userId: 'owner', workspaceId: 'workspace-1' },
  );
  const { baseUrl, server } = await listen(repository);
  t.after(() => server.close());

  const response = await fetch(
    `${baseUrl}/v1/diagnostics/historical-run/events`,
    { headers: authorizedHeaders },
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /历史诊断事件/);
});

test('historical runs cannot resume the retired generation path', async (t) => {
  const repository = new MemoryDiagnosticRepository();
  repository.seed(
    {
      id: 'historical-run',
      correlationId: 'corr-historical',
      status: 'waiting_for_user',
      events: ['历史诊断事件'],
    },
    { userId: 'owner', workspaceId: 'workspace-1' },
  );
  const { baseUrl, server } = await listen(repository);
  t.after(() => server.close());

  const response = await fetch(
    `${baseUrl}/v1/diagnostics/historical-run/resume`,
    {
      method: 'POST',
      headers: authorizedHeaders,
      body: JSON.stringify({ constraint: '继续生成' }),
    },
  );
  assert.equal(response.status, 410);
  const payload = (await response.json()) as { error: { code: string } };
  assert.equal(payload.error.code, 'DIAGNOSTIC_CONTENT_GENERATION_RETIRED');
  assert.equal(repository.saveCalls, 0);
});
