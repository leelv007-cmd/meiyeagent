import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProductionDueDeliveryScanner,
  shouldStartDueDeliveryPoller,
  startDueDeliveryPoller,
} from './poller.js';

const productionEnv = { APP_ENV: 'production', NODE_ENV: 'production' };

test('worker always starts the in-process due-delivery poller', () => {
  assert.deepEqual(
    shouldStartDueDeliveryPoller({ processRole: 'worker', env: productionEnv }),
    {
      pollMs: 1_000,
      reason: 'worker-owns-due-delivery-poller',
      start: true,
    },
  );
});

test('production API does not start the due-delivery poller', () => {
  assert.deepEqual(
    shouldStartDueDeliveryPoller({ processRole: 'api', env: productionEnv }),
    {
      pollMs: 1_000,
      reason: 'api-must-not-run-due-delivery-poller',
      start: false,
    },
  );
});

test('e2e API starts the same due-delivery poller the worker runs', () => {
  assert.deepEqual(
    shouldStartDueDeliveryPoller({
      processRole: 'api',
      env: { APP_ENV: 'e2e' },
    }),
    {
      pollMs: 1_000,
      reason: 'e2e-api-runs-worker-due-delivery-poller',
      start: true,
    },
  );
});

test('preview durable-poller fallback also starts the due-delivery poller', () => {
  assert.deepEqual(
    shouldStartDueDeliveryPoller({
      processRole: 'api',
      env: { APP_ENV: 'development', CORE_DURABLE_POLLER_FALLBACK: '1' },
    }),
    {
      pollMs: 10_000,
      reason: 'preview-dev-throttled-fallback',
      start: true,
    },
  );
});

test('startDueDeliveryPoller is a no-op on production API and ticks once on e2e API', async () => {
  let productionRuns = 0;
  const production = startDueDeliveryPoller({
    env: productionEnv,
    processRole: 'api',
    scanner: {
      async run() {
        productionRuns += 1;
        return scannerSummary();
      },
    },
    workerId: 'api-production',
  });
  assert.equal(production.start, false);
  await Promise.resolve();
  assert.equal(productionRuns, 0);
  production.stop();

  let e2eRuns = 0;
  const e2e = startDueDeliveryPoller({
    clock: () => new Date('2026-07-29T01:00:00.000Z'),
    env: { APP_ENV: 'e2e', DUE_DELIVERY_POLL_MS: '60000' },
    processRole: 'api',
    scanner: {
      async run(workerId, claimedAt) {
        assert.equal(workerId, 'api-e2e');
        assert.equal(claimedAt, '2026-07-29T01:00:00.000Z');
        e2eRuns += 1;
        return scannerSummary();
      },
    },
    workerId: 'api-e2e',
  });
  assert.equal(e2e.start, true);
  await Promise.resolve();
  assert.equal(e2eRuns, 1);
  e2e.stop();
});

test('production scanner factory binds eligibility and the candidate port', () => {
  const scanner = createProductionDueDeliveryScanner({
    candidates: {
      async readDailyRecommendationCandidate() {
        throw new Error('must not read during construction');
      },
    },
    pool: {
      async query() {
        throw new Error('must not query during construction');
      },
    },
    repository: {
      async beginDelivery() {
        throw new Error('must not claim during construction');
      },
      async claimBatch() {
        return [];
      },
      async purgeExpired() {
        return { deletedItems: 0, deletedRuns: 0 };
      },
      async settleDelivered() {
        return true;
      },
      async settleFailed() {
        return true;
      },
      async settleSuppressed() {
        return true;
      },
    },
  });
  assert.equal(typeof scanner.run, 'function');
});

function scannerSummary() {
  return {
    claimed: 0,
    deadLettered: 0,
    deletedItems: 0,
    deletedRuns: 0,
    delivered: 0,
    lost: 0,
    retried: 0,
    suppressed: 0,
  };
}
