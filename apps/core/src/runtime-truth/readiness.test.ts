import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertReleaseManifestCoherent,
  buildReleaseManifest,
  releaseIdentityFromEnv,
} from './release-identity.js';
import {
  composeRuntimeTruth,
  evaluateReadiness,
  objectStorageModeReadinessFromEnv,
  providerModeReadinessFromEnv,
} from './readiness.js';
import {
  objectStorageReadWriteRoundTrip,
  outboxBacklogProbe,
  workerFreshnessProbe,
} from './probes.js';

test('protected env fails closed for recorded and filesystem modes', () => {
  assert.equal(
    providerModeReadinessFromEnv({
      APP_ENV: 'production',
      MODEL_EXECUTION_MODE: 'recorded',
    }).status,
    'fail',
  );
  assert.equal(
    providerModeReadinessFromEnv({
      APP_ENV: 'staging',
      MODEL_EXECUTION_MODE: 'disabled',
    }).status,
    'fail',
  );
  assert.equal(
    objectStorageModeReadinessFromEnv({
      APP_ENV: 'production',
      P1_ASSET_STORAGE_MODE: 'filesystem',
    }).status,
    'fail',
  );
  assert.equal(
    providerModeReadinessFromEnv({
      APP_ENV: 'production',
      MODEL_EXECUTION_MODE: 'direct',
    }).status,
    'pass',
  );
  assert.equal(
    objectStorageModeReadinessFromEnv({
      APP_ENV: 'production',
      P1_ASSET_STORAGE_MODE: 's3',
    }).status,
    'pass',
  );
});

test('evaluateReadiness requires all probes to pass in protected environments', async () => {
  const ready = await evaluateReadiness({
    protectedEnvironment: true,
    probes: {
      postgresql: () => ({ name: 'postgresql', status: 'pass' }),
      dbos: () => ({ name: 'dbos', status: 'pass' }),
      schema: () => ({ name: 'schema', status: 'pass' }),
      objectStorage: () => ({ name: 'objectStorage', status: 'pass' }),
      workerFreshness: () => ({ name: 'workerFreshness', status: 'pass' }),
      providerMode: () => ({ name: 'providerMode', status: 'pass' }),
      providerLive: () => ({ name: 'providerLive', status: 'pass' }),
      outbox: () => ({ name: 'outbox', status: 'pass' }),
    },
    release: { commitSha: 'abc123' },
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.role, 'api');
  assert.equal(ready.release?.commitSha, 'abc123');
  assert.equal(
    ready.checks.some((check) => check.name === 'workerFreshness'),
    false,
  );

  const notReady = await evaluateReadiness({
    protectedEnvironment: true,
    probes: {
      postgresql: () => ({ name: 'postgresql', status: 'pass' }),
      // missing others fail
    },
  });
  assert.equal(notReady.ready, false);
  assert.equal(notReady.status, 'not_ready');
  assert.ok(
    notReady.checks.some(
      (check) => check.name === 'dbos' && check.status === 'fail',
    ),
  );
  assert.ok(
    notReady.checks.some(
      (check) => check.name === 'providerLive' && check.status === 'fail',
    ),
  );
});

test('worker freshness fails when heartbeat is missing or stale', async () => {
  const missing = await workerFreshnessProbe({
    latestHeartbeatAt: async () => null,
  })();
  assert.equal(missing.status, 'fail');

  const stale = await workerFreshnessProbe({
    latestHeartbeatAt: async () => '2026-07-01T00:00:00.000Z',
    now: () => new Date('2026-07-01T00:01:00.000Z'),
    staleAfterMs: 30_000,
  })();
  assert.equal(stale.status, 'fail');

  const fresh = await workerFreshnessProbe({
    latestHeartbeatAt: async () => '2026-07-01T00:00:50.000Z',
    now: () => new Date('2026-07-01T00:01:00.000Z'),
    staleAfterMs: 30_000,
  })();
  assert.equal(fresh.status, 'pass');
});

test('concurrent object storage round trips use isolated object keys', async () => {
  const bytes = Uint8Array.from([1, 2, 3]);
  const objects = new Map<string, Uint8Array>();
  const writtenKeys: string[] = [];
  const deletedKeys: string[] = [];
  let sequence = 0;
  const roundTrip = objectStorageReadWriteRoundTrip({
    bytes,
    createObjectKey: () => `readiness-probe-${++sequence}`,
    async deleteObject(objectKey) {
      deletedKeys.push(objectKey);
      objects.delete(objectKey);
    },
    async putObject(objectKey, value) {
      writtenKeys.push(objectKey);
      objects.set(objectKey, value);
    },
    async readObject(objectKey) {
      const value = objects.get(objectKey);
      if (!value) throw new Error(`Missing ${objectKey}`);
      return value;
    },
  });

  await Promise.all([roundTrip(), roundTrip()]);

  assert.deepEqual(writtenKeys, ['readiness-probe-1', 'readiness-probe-2']);
  assert.deepEqual(deletedKeys.sort(), writtenKeys);
  assert.equal(objects.size, 0);
});

test('outbox backlog probe reports honestly', async () => {
  const okOutbox = await outboxBacklogProbe({
    criticalBacklog: async () => 3,
    maxBacklog: 10,
  })();
  assert.equal(okOutbox.status, 'pass');

  const fullOutbox = await outboxBacklogProbe({
    criticalBacklog: async () => 50,
    maxBacklog: 10,
  })();
  assert.equal(fullOutbox.status, 'fail');
});

test('release identity and coherent three-unit manifest', () => {
  const identity = releaseIdentityFromEnv({
    RELEASE_COMMIT_SHA: 'deadbeef',
    RELEASE_ARTIFACT_DIGEST: 'sha256:1',
    RELEASE_CONFIG_REVISION: 'cfg-9',
  });
  assert.deepEqual(identity, {
    commitSha: 'deadbeef',
    artifactDigest: 'sha256:1',
    configRevision: 'cfg-9',
  });

  const manifest = buildReleaseManifest({
    capturedAt: '2026-07-23T00:00:00.000Z',
    units: [
      { unit: 'web', commitSha: 'deadbeef', artifactDigest: 'sha256:1' },
      { unit: 'core', commitSha: 'deadbeef', artifactDigest: 'sha256:1' },
      {
        unit: 'worker',
        commitSha: 'deadbeef',
        artifactDigest: 'sha256:1',
        configRevision: 'cfg-9',
      },
    ],
  });
  assert.doesNotThrow(() => assertReleaseManifestCoherent(manifest));
  assert.throws(
    () =>
      assertReleaseManifestCoherent(
        buildReleaseManifest({
          units: [
            { unit: 'web', commitSha: 'a' },
            { unit: 'core', commitSha: 'b' },
            { unit: 'worker', commitSha: 'a' },
          ],
        }),
      ),
    /single commit/,
  );
});

test('composeRuntimeTruth fail-closes production recorded mode without inventing live channels', async () => {
  const truth = composeRuntimeTruth({
    env: {
      APP_ENV: 'production',
      MODEL_EXECUTION_MODE: 'recorded',
      P1_ASSET_STORAGE_MODE: 'filesystem',
      RELEASE_COMMIT_SHA: 'c0ffee',
    },
    capabilityRecords: [
      {
        id: 'generation_copy',
        evidence: ['implemented', 'recorded_verified'],
      },
    ],
    probes: {
      postgresql: () => ({ name: 'postgresql', status: 'pass' }),
      dbos: () => ({ name: 'dbos', status: 'pass' }),
      schema: () => ({ name: 'schema', status: 'pass' }),
      workerFreshness: () => ({ name: 'workerFreshness', status: 'pass' }),
      outbox: () => ({ name: 'outbox', status: 'pass' }),
    },
  });

  const readiness = await truth.evaluateReadiness();
  assert.equal(readiness.ready, false);
  assert.ok(
    readiness.checks.some(
      (check) => check.name === 'providerMode' && check.status === 'fail',
    ),
  );
  assert.ok(
    readiness.checks.some(
      (check) => check.name === 'objectStorage' && check.status === 'fail',
    ),
  );
  assert.ok(
    readiness.checks.some(
      (check) => check.name === 'providerLive' && check.status === 'fail',
    ),
  );

  const capabilities = await truth.listMerchantCapabilities();
  assert.equal(capabilities.capabilities[0]?.state, 'assisted');
  assert.equal(capabilities.release?.commitSha, 'c0ffee');
});
