import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessObservabilityReconciler,
  type HarnessObservabilityReconciliationStore,
} from './observability-reconciliation.js';

test('periodic reconciliation processes the latest closed window with a stable boundary', async () => {
  const calls: Array<{ windowStart: Date; windowEnd: Date }> = [];
  const store: HarnessObservabilityReconciliationStore = {
    async reconcileBusinessEventsToTraces(input) {
      calls.push(input);
      return {
        actionUsageEventCount: 2,
        businessEventCount: 4,
        traceCount: 5,
        matchedCount: 3,
        missingTraceCount: 1,
        orphanTraceCount: 2,
        ratingEventCount: 3,
        undeliveredEventCount: 1,
        cutoverAt: new Date('2026-07-29T09:00:00.000Z'),
      };
    },
  };
  const reconciler = new HarnessObservabilityReconciler(store, {
    intervalMs: 5 * 60_000,
    now: () => new Date('2026-07-29T10:07:23.000Z'),
    windowMs: 10 * 60_000,
  });

  assert.deepEqual(await reconciler.runOnce(), {
    actionUsageEventCount: 2,
    businessEventCount: 4,
    traceCount: 5,
    matchedCount: 3,
    missingTraceCount: 1,
    orphanTraceCount: 2,
    ratingEventCount: 3,
    undeliveredEventCount: 1,
    cutoverAt: new Date('2026-07-29T09:00:00.000Z'),
    detection: {
      allowed: true,
      status: 'detected',
      strategy: 'detect',
      violations: [
        { code: 'missing_trace', count: 1 },
        { code: 'orphan_trace', count: 2 },
        { code: 'undelivered_event', count: 1 },
      ],
    },
  });
  assert.deepEqual(calls, [
    {
      windowStart: new Date('2026-07-29T09:55:00.000Z'),
      windowEnd: new Date('2026-07-29T10:05:00.000Z'),
    },
  ]);
});

test('reconciliation rejects invalid scheduling windows before touching storage', async () => {
  let calls = 0;
  const store: HarnessObservabilityReconciliationStore = {
    async reconcileBusinessEventsToTraces() {
      calls += 1;
      throw new Error('must not run');
    },
  };

  await assert.rejects(
    new HarnessObservabilityReconciler(store, {
      intervalMs: 60_000,
      windowMs: 0,
    }).runOnce(),
    /windowMs must be a positive integer/u,
  );
  assert.equal(calls, 0);
});
