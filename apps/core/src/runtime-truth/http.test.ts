import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { DiagnosticRun } from '@meiye/contracts';
import type { DiagnosticRepository } from '../diagnostics/repository.js';
import { createCoreServer } from '../server.js';
import { composeRuntimeTruth } from './readiness.js';

class MemoryDiagnosticRepository implements DiagnosticRepository {
  async create(run: DiagnosticRun) {
    return run;
  }
  async get() {
    return null;
  }
  async save(run: DiagnosticRun) {
    return run;
  }
}

async function listen(
  runtimeTruth = composeRuntimeTruth({
    env: { APP_ENV: 'test', MODEL_EXECUTION_MODE: 'recorded' },
    includeEnvModeGates: false,
    probes: {
      postgresql: () => ({ name: 'postgresql', status: 'pass' }),
      dbos: () => ({ name: 'dbos', status: 'pass' }),
      schema: () => ({ name: 'schema', status: 'pass' }),
      objectStorage: () => ({ name: 'objectStorage', status: 'pass' }),
      workerFreshness: () => ({ name: 'workerFreshness', status: 'pass' }),
      providerMode: () => ({ name: 'providerMode', status: 'pass' }),
      outbox: () => ({ name: 'outbox', status: 'pass' }),
      canvas: () => ({ name: 'canvas', status: 'pass' }),
    },
    capabilityRecords: [
      {
        id: 'generation_copy',
        evidence: ['implemented', 'live_verified'],
      },
      {
        id: 'generation_image',
        evidence: ['implemented', 'recorded_verified'],
      },
    ],
    release: { commitSha: 'http-test-sha', configRevision: 'cfg-1' },
  }),
) {
  const server = createCoreServer({
    diagnosticRepository: new MemoryDiagnosticRepository(),
    serviceToken: 'test-service-token',
    runtimeTruth,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, server };
}

test('GET /health and /health/live are process-only and do not require runtimeTruth', async (t) => {
  const server = createCoreServer({
    diagnosticRepository: new MemoryDiagnosticRepository(),
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${port}`;

  for (const path of ['/health', '/health/live']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      data: { service: string; status: string };
    };
    assert.equal(payload.data.service, 'meiye-core');
    assert.ok(
      payload.data.status === 'ok' || payload.data.status === 'live',
    );
  }
});

test('GET /health/assembly reports whether the required Harness path is active', async (t) => {
  const inactive = createCoreServer({
    diagnosticRepository: new MemoryDiagnosticRepository(),
    serviceToken: 'test-service-token',
  });
  inactive.listen(0, '127.0.0.1');
  await once(inactive, 'listening');
  t.after(() => inactive.close());
  const inactivePort = (inactive.address() as AddressInfo).port;

  const inactiveResponse = await fetch(
    `http://127.0.0.1:${inactivePort}/health/assembly`,
  );
  assert.equal(inactiveResponse.status, 503);
  assert.deepEqual((await inactiveResponse.json()).data, {
    composerSubmission: 'inactive',
    harness: 'inactive',
    service: 'meiye-core',
    status: 'inactive',
  });

  const active = createCoreServer({
    composerSubmission: { coordinator: { submit: async () => undefined as never } },
    diagnosticRepository: new MemoryDiagnosticRepository(),
    harnessService: {} as never,
    serviceToken: 'test-service-token',
  });
  active.listen(0, '127.0.0.1');
  await once(active, 'listening');
  t.after(() => active.close());
  const activePort = (active.address() as AddressInfo).port;

  const activeResponse = await fetch(
    `http://127.0.0.1:${activePort}/health/assembly`,
  );
  assert.equal(activeResponse.status, 200);
  assert.deepEqual((await activeResponse.json()).data, {
    composerSubmission: 'active',
    harness: 'active',
    service: 'meiye-core',
    status: 'active',
  });
});

test('GET /health/ready reports ready when probes pass', async (t) => {
  const { baseUrl, server } = await listen();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/health/ready`);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: {
      ready: boolean;
      status: string;
      checks: Array<{ name: string; status: string }>;
      release?: { commitSha: string };
    };
  };
  assert.equal(payload.data.ready, true);
  assert.equal(payload.data.status, 'ready');
  assert.equal(payload.data.release?.commitSha, 'http-test-sha');
  // 9 named checks including providerLive (skipped when not required/configured).
  assert.equal(payload.data.checks.length, 9);
});

test('GET /health/ready returns 503 when a required probe fails', async (t) => {
  const { baseUrl, server } = await listen(
    composeRuntimeTruth({
      env: { APP_ENV: 'production', MODEL_EXECUTION_MODE: 'recorded' },
      probes: {
        postgresql: () => ({ name: 'postgresql', status: 'pass' }),
      },
      release: { commitSha: 'not-ready' },
    }),
  );
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/health/ready`);
  assert.equal(response.status, 503);
  const payload = (await response.json()) as {
    data: { ready: boolean; status: string };
  };
  assert.equal(payload.data.ready, false);
  assert.equal(payload.data.status, 'not_ready');
});

test('GET /capabilities only emits merchant three-state', async (t) => {
  const { baseUrl, server } = await listen();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/capabilities`);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: {
      evidencePolicy: string;
      capabilities: Array<{ id: string; state: string }>;
    };
  };
  assert.equal(payload.data.evidencePolicy, 'merchant_three_state_only');
  assert.deepEqual(
    payload.data.capabilities.map((entry) => entry.state),
    ['verified', 'assisted'],
  );
  const body = JSON.stringify(payload.data);
  for (const banned of [
    'implemented',
    'recorded_verified',
    'live_verified',
    'merchant_validated',
  ]) {
    assert.equal(body.includes(banned), false, banned);
  }
});

test('GET /health/ready without runtimeTruth is not ready', async (t) => {
  const server = createCoreServer({
    diagnosticRepository: new MemoryDiagnosticRepository(),
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
  assert.equal(response.status, 503);
  const payload = (await response.json()) as {
    data: { ready: boolean; status: string };
  };
  assert.equal(payload.data.ready, false);
});
