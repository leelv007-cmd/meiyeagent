import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCTION_DBOS_APP_NAME,
  PRODUCTION_JOB_QUEUE_PREFIX,
  assertSameRuntimeFingerprint,
  productionRuntimeFingerprint,
} from './runtime-fingerprint.js';

test('API and worker share the same DBOS/queue fingerprint contract', () => {
  const env = {
    JOB_QUEUE_PREFIX: 'meiye-p1',
    HARNESS_DBOS_APPLICATION_VERSION: 'sha-release',
  };
  const api = productionRuntimeFingerprint(env);
  const worker = productionRuntimeFingerprint(env);
  assert.deepEqual(api, worker);
  assert.equal(api.dbosName, PRODUCTION_DBOS_APP_NAME);
  assert.equal(api.queuePrefix, PRODUCTION_JOB_QUEUE_PREFIX);
  assert.equal(api.applicationVersion, 'sha-release');
  assertSameRuntimeFingerprint(api, worker);
});

test('fingerprint falls back to the production queue prefix and DBOS app name', () => {
  const fingerprint = productionRuntimeFingerprint({});
  assert.deepEqual(fingerprint, {
    applicationVersion: null,
    dbosName: PRODUCTION_DBOS_APP_NAME,
    queuePrefix: PRODUCTION_JOB_QUEUE_PREFIX,
  });
});

test('diverged API/worker fingerprints fail closed', () => {
  const api = productionRuntimeFingerprint({ JOB_QUEUE_PREFIX: 'meiye-p1' });
  const worker = productionRuntimeFingerprint({ JOB_QUEUE_PREFIX: 'other' });
  assert.throws(
    () => assertSameRuntimeFingerprint(api, worker),
    /fingerprint contract diverged/u,
  );
});
