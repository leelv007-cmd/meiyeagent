import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DURABLE_BACKGROUND_CATALOG,
  DurableBackgroundSupervisor,
  MemoryExclusiveLease,
  MemoryExclusiveOutboxInbox,
  drainExclusiveOutbox,
  shouldStartDurablePollers,
} from './background-ownership.js';
import { composeRuntimeTruth } from './readiness.js';

const productionEnv = { APP_ENV: 'production', NODE_ENV: 'production' };

function catalogIds() {
  return DURABLE_BACKGROUND_CATALOG.map((entry) => entry.id);
}

test('durable background catalog names every outbox/recovery/expiry/reconcile owner', () => {
  assert.deepEqual(catalogIds().sort(), [
    'campaign-paid-work-recovery',
    'confirmation-expiry',
    'credit-subscription-cycle',
    'credit-subscription-reconciliation',
    'due-delivery-scanner',
    'fact-expiration-invalidation',
    'feishu-lifecycle-jobs',
    'harness-compensation',
    'langfuse-outbox',
    'media-generation-jobs',
    'observability-reconcile',
    'operations-trigger-jobs',
    'parse-batch-jobs',
    'payment-refund-review-alert-outbox',
    'payment-webhook-settlement-outbox',
    'pending-start-recovery',
    'plan-event-outbox',
    'redemption-expiry',
    's3-asset-registration-cleanup',
    'storage-object-outbox',
  ]);
  for (const entry of DURABLE_BACKGROUND_CATALOG) {
    assert.ok(entry.sources.length > 0, entry.id);
    if (entry.currentOwner !== entry.requiredOwner) {
      assert.ok(entry.gap, `${entry.id} must name the remaining gap`);
      assert.equal(entry.transport, 'api-poller-gap');
    }
  }
});

test('production API boot-role refuses durable pollers; worker owns them', () => {
  assert.deepEqual(shouldStartDurablePollers({ processRole: 'api', env: productionEnv }), {
    pollMsMultiplier: 1,
    reason: 'api-must-not-run-durable-pollers',
    start: false,
  });
  assert.deepEqual(
    shouldStartDurablePollers({
      processRole: 'api',
      env: { APP_ENV: 'development' },
    }),
    {
      pollMsMultiplier: 1,
      reason: 'api-boot-role-skips-durable-pollers',
      start: false,
    },
  );
  assert.deepEqual(
    shouldStartDurablePollers({
      processRole: 'api',
      env: { APP_ENV: 'development', CORE_DURABLE_POLLER_FALLBACK: '1' },
    }),
    {
      pollMsMultiplier: 10,
      reason: 'preview-dev-throttled-fallback',
      start: true,
    },
  );
  assert.equal(
    shouldStartDurablePollers({ processRole: 'worker', env: productionEnv }).start,
    true,
  );
});

test('two API replicas do not both run the durable poller', async () => {
  const runs: string[] = [];
  const lease = new MemoryExclusiveLease();
  const loops = [
    {
      id: 'recovery',
      async runOnce() {
        runs.push('recovery');
      },
    },
  ];
  const apiA = new DurableBackgroundSupervisor({
    env: productionEnv,
    lease,
    loops,
    ownerId: 'api-a',
    processRole: 'api',
  });
  const apiB = new DurableBackgroundSupervisor({
    env: productionEnv,
    lease,
    loops,
    ownerId: 'api-b',
    processRole: 'api',
  });

  assert.equal(apiA.start(), false);
  assert.equal(apiB.start(), false);
  assert.deepEqual(await apiA.tickAll(), { ran: [], skipped: ['recovery'] });
  assert.deepEqual(await apiB.tickAll(), { ran: [], skipped: ['recovery'] });
  assert.deepEqual(runs, []);
});

test('API process closed / worker alive continues recovery', async () => {
  const recoveredAt: string[] = [];
  let nowMs = Date.parse('2026-08-20T00:00:00.000Z');
  const clock = () => new Date(nowMs);
  const lease = new MemoryExclusiveLease({ clock, ttlMs: 5_000 });
  const loops = [
    {
      id: 'pending-start-recovery',
      async runOnce() {
        recoveredAt.push(clock().toISOString());
      },
    },
  ];
  const api = new DurableBackgroundSupervisor({
    env: productionEnv,
    lease,
    loops,
    ownerId: 'api-1',
    processRole: 'api',
  });
  const worker = new DurableBackgroundSupervisor({
    env: productionEnv,
    lease,
    loops,
    ownerId: 'worker-1',
    processRole: 'worker',
  });

  api.stop();
  assert.equal(api.startDecision.start, false);
  assert.equal(worker.startDecision.start, true);
  nowMs += 1_000;
  assert.deepEqual(await worker.tickAll(), {
    ran: ['pending-start-recovery'],
    skipped: [],
  });
  nowMs += 1_000;
  assert.deepEqual(await worker.tickAll(), {
    ran: ['pending-start-recovery'],
    skipped: [],
  });
  assert.deepEqual(recoveredAt, [
    '2026-08-20T00:00:01.000Z',
    '2026-08-20T00:00:02.000Z',
  ]);
});

test('two worker ticks share one poller lease', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let completed = 0;
  const lease = new MemoryExclusiveLease({ ttlMs: 30_000 });
  const loops = [
    {
      id: 'langfuse-outbox',
      async runOnce() {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        completed += 1;
      },
    },
  ];
  const workerA = new DurableBackgroundSupervisor({
    env: productionEnv,
    lease,
    loops,
    ownerId: 'worker-a',
    processRole: 'worker',
  });
  const workerB = new DurableBackgroundSupervisor({
    env: productionEnv,
    lease,
    loops,
    ownerId: 'worker-b',
    processRole: 'worker',
  });

  await Promise.all([workerA.tickAll(), workerB.tickAll()]);
  assert.equal(maxInFlight, 1);
  assert.equal(completed, 1);
});

test('payment outbox is processed by exactly one lease owner', async () => {
  const owners: string[] = [];
  const inbox = new MemoryExclusiveOutboxInbox([
    { providerEventId: 'evt_paid_1' },
  ]);

  const [first, second] = await Promise.all([
    drainExclusiveOutbox(
      'web-replica-a',
      inbox,
      async (_item, ownerId) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        owners.push(ownerId);
      },
    ),
    drainExclusiveOutbox(
      'web-replica-b',
      inbox,
      async (_item, ownerId) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        owners.push(ownerId);
      },
    ),
  ]);

  assert.equal(first.completed + second.completed, 1);
  assert.equal(owners.length, 1);
  assert.ok(
    owners[0] === 'web-replica-a' || owners[0] === 'web-replica-b',
    owners[0],
  );
});

test('API readiness stays up when worker freshness fails', async () => {
  const truth = composeRuntimeTruth({
    env: {
      APP_ENV: 'production',
      MODEL_EXECUTION_MODE: 'direct',
      P1_ASSET_STORAGE_MODE: 's3',
    },
    includeEnvModeGates: false,
    probes: {
      postgresql: () => ({ name: 'postgresql', status: 'pass' }),
      dbos: () => ({ name: 'dbos', status: 'pass' }),
      schema: () => ({ name: 'schema', status: 'pass' }),
      objectStorage: () => ({ name: 'objectStorage', status: 'pass' }),
      providerMode: () => ({ name: 'providerMode', status: 'pass' }),
      providerLive: () => ({ name: 'providerLive', status: 'pass' }),
      workerFreshness: () => ({
        name: 'workerFreshness',
        status: 'fail',
        detail: 'worker down',
      }),
      outbox: () => ({ name: 'outbox', status: 'fail', detail: 'backlog' }),
    },
    role: 'api',
  });

  const api = await truth.evaluateReadiness();
  assert.equal(api.role, 'api');
  assert.equal(api.ready, true);
  assert.equal(
    api.checks.some((check) => check.name === 'workerFreshness'),
    false,
  );

  const worker = await truth.evaluateWorkerReadiness();
  assert.equal(worker.role, 'worker');
  assert.equal(worker.ready, false);
  assert.ok(
    worker.checks.some(
      (check) => check.name === 'workerFreshness' && check.status === 'fail',
    ),
  );
});

test('production assembly gates API pollers and starts worker-owned loops', async () => {
  const api = await readFile(
    new URL('../assembly/api-runtime.ts', import.meta.url),
    'utf8',
  );
  const worker = await readFile(
    new URL('../assembly/worker-runtime.ts', import.meta.url),
    'utf8',
  );
  const durable = await readFile(
    new URL('../assembly/durable-background.ts', import.meta.url),
    'utf8',
  );

  assert.match(api, /shouldStartDurablePollers\(/);
  assert.match(api, /processRole:\s*'api'/);
  assert.match(api, /role:\s*'api'/);
  assert.match(worker, /startWorkerDurableBackground/);
  assert.match(durable, /langfuse-outbox/);
  assert.match(durable, /observability-reconcile/);
  assert.match(durable, /processRole:\s*'worker'/);
  assert.doesNotMatch(
    api,
    /promptOutboxLoop\.start\(\);\s*\n\s*const observabilityReconciler/,
  );
});
