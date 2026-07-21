import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runConformance } from './run-conformance.mjs';

const runNonce = 'provider-live-runner-test';

function environment(outputPath, endpoint = 'https://conformance.example/run') {
  return {
    PROVIDER_LIVE_CONFORMANCE_ENDPOINT: endpoint,
    PROVIDER_LIVE_CONFORMANCE_TOKEN: 'test-token',
    PROVIDER_LIVE_RUN_NONCE: runNonce,
    PROVIDER_LIVE_EXTERNAL_EVIDENCE_PATH: outputPath,
    PROVIDER_LIVE_FAULT_INJECTOR_MAX_COST_USD: '0.1',
  };
}

function evidence(nonce = runNonce) {
  return {
    costEvidence: { runNonce: nonce },
    lifecycleEvidence: [{ runNonce: nonce }],
    transportFaultEvidence: [{ runNonce: nonce }],
    secondaryProbes: [{ operationEvidence: { runNonce: nonce } }],
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}

test('runner requires HTTPS before fetch', async () => {
  let fetched = false;
  await assert.rejects(
    runConformance({
      environment: environment('/tmp/unused', 'http://example.com/run'),
      fetchImpl: async () => {
        fetched = true;
        return jsonResponse(evidence());
      },
    }),
    /must use HTTPS/,
  );
  assert.equal(fetched, false);
});

test('runner rejects nonce mismatch and oversized streamed evidence', async () => {
  await assert.rejects(
    runConformance({
      environment: environment('/tmp/unused'),
      fetchImpl: async () => jsonResponse(evidence('another-run')),
    }),
    /run nonce mismatch/,
  );
  await assert.rejects(
    runConformance({
      environment: environment('/tmp/unused'),
      fetchImpl: async () =>
        new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
          headers: { 'content-type': 'application/json' },
        }),
    }),
    /exceeds 2 MiB/,
  );
});

test('runner disables redirects and atomically writes mode 0600 output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'provider-live-runner-'));
  const outputPath = join(directory, 'external-conformance.json');
  let redirect;
  try {
    await runConformance({
      environment: environment(outputPath),
      fetchImpl: async (_url, init) => {
        redirect = init.redirect;
        return jsonResponse(evidence());
      },
    });
    assert.equal(redirect, 'error');
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), evidence());
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    await assert.rejects(access(`${outputPath}.tmp`), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
