import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_HEALTH_REQUEST_TIMEOUT_MS,
  fetchHealthy,
} from './health-fetch.mjs';

test('health requests use a bounded signal by default', async () => {
  let observedSignal;
  const response = await fetchHealthy(
    'Web',
    'http://localhost:3000/auth/login',
    {},
    {
      fetchImpl: async (_url, init) => {
        observedSignal = init.signal;
        return { ok: true, status: 200 };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, false);
  assert.equal(DEFAULT_HEALTH_REQUEST_TIMEOUT_MS, 5_000);
});

test('health requests preserve an explicit caller signal', async () => {
  const controller = new AbortController();
  let observedSignal;

  await fetchHealthy(
    'Canvas',
    'http://localhost:4200/api/internal/health',
    { signal: controller.signal },
    {
      fetchImpl: async (_url, init) => {
        observedSignal = init.signal;
        return { ok: true, status: 200 };
      },
    },
  );

  assert.equal(observedSignal, controller.signal);
});

test('health requests reject invalid timeout values', async () => {
  await assert.rejects(
    fetchHealthy('Web', 'http://localhost:3000', {}, { timeoutMs: 0 }),
    /positive number/,
  );
});

test('health requests fail on non-success responses', async () => {
  await assert.rejects(
    fetchHealthy('Core', 'http://localhost:4100/health', {}, {
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /Core returned HTTP 503/,
  );
});
