import assert from 'node:assert/strict';
import test from 'node:test';

import type { ObservabilityDropEvent } from '@meiye/contracts';

import {
  HarnessObservabilityReconciler,
  type HarnessObservabilityReconciliationStore,
} from './observability-reconciliation.js';

test('periodic reconciliation processes the latest closed window with a stable boundary', async () => {
  const calls: Array<
    | { kind: 'complete'; windowStart: Date; windowEnd: Date }
    | { kind: 'read'; windowStart: Date; windowEnd: Date }
  > = [];
  const store: HarnessObservabilityReconciliationStore = {
    async completeObservabilityReconciliationWindow(input) {
      calls.push({ kind: 'complete', ...input });
    },
    async readObservabilityReconciliationBoundary() {
      return new Date('2026-07-29T10:05:00.000Z');
    },
    async readObservabilityReconciliationCursor() {
      return new Date('2026-07-29T09:40:00.000Z');
    },
    async readObservabilityDeliveryHealth() {
      return {
        lastSuccessAt: new Date('2026-07-29T10:04:30.000Z'),
        oldestQueuedAt: new Date('2026-07-29T10:04:00.000Z'),
        queueAgeMs: 203_000,
      };
    },
    async readObservabilityDropSummary(input) {
      calls.push({ kind: 'read', ...input });
      return [
        {
          signal: 'trace',
          reason: 'transient',
          source: 'langfuse_ingestion',
          count: 2,
        },
      ];
    },
    async reconcileBusinessEventsToTraces(input) {
      calls.push({ kind: 'read', ...input });
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
  let observedDelivery:
    | {
        deliveryHealth: {
          lastSuccessAt: Date | null;
          oldestQueuedAt: Date | null;
          queueAgeMs: number | null;
        };
        dropSummary: readonly ObservabilityDropEvent[];
      }
    | undefined;
  const reconciler = new HarnessObservabilityReconciler(store, {
    intervalMs: 5 * 60_000,
    onDeliverySnapshot(snapshot) {
      observedDelivery = snapshot;
    },
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
    deliveryHealth: {
      lastSuccessAt: new Date('2026-07-29T10:04:30.000Z'),
      oldestQueuedAt: new Date('2026-07-29T10:04:00.000Z'),
      queueAgeMs: 203_000,
    },
    dropSummary: [
      {
        signal: 'trace',
        reason: 'transient',
        source: 'langfuse_ingestion',
        count: 2,
      },
    ],
    detection: {
      allowed: true,
      status: 'detected',
      strategy: 'detect',
      violations: [
        { code: 'missing_trace', count: 1 },
        { code: 'orphan_trace', count: 2 },
        { code: 'undelivered_event', count: 1 },
        { code: 'delivery_drop', count: 2 },
      ],
    },
  });
  assert.deepEqual(calls, [
    {
      kind: 'read',
      windowStart: new Date('2026-07-29T09:40:00.000Z'),
      windowEnd: new Date('2026-07-29T10:05:00.000Z'),
    },
    {
      kind: 'read',
      windowStart: new Date('2026-07-29T09:40:00.000Z'),
      windowEnd: new Date('2026-07-29T10:05:00.000Z'),
    },
    {
      kind: 'complete',
      windowStart: new Date('2026-07-29T09:40:00.000Z'),
      windowEnd: new Date('2026-07-29T10:05:00.000Z'),
    },
  ]);
  assert.deepEqual(observedDelivery, {
    deliveryHealth: {
      lastSuccessAt: new Date('2026-07-29T10:04:30.000Z'),
      oldestQueuedAt: new Date('2026-07-29T10:04:00.000Z'),
      queueAgeMs: 203_000,
    },
    dropSummary: [
      {
        signal: 'trace',
        reason: 'transient',
        source: 'langfuse_ingestion',
        count: 2,
      },
    ],
  });
});

test('reconciliation rejects invalid scheduling windows before touching storage', async () => {
  let calls = 0;
  const store: HarnessObservabilityReconciliationStore = {
    async completeObservabilityReconciliationWindow() {
      throw new Error('must not run');
    },
    async readObservabilityReconciliationBoundary() {
      throw new Error('must not run');
    },
    async readObservabilityReconciliationCursor() {
      throw new Error('must not run');
    },
    async readObservabilityDeliveryHealth() {
      throw new Error('must not run');
    },
    async readObservabilityDropSummary() {
      throw new Error('must not run');
    },
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

test('reconciliation advances its cursor only after delivery consumers succeed', async () => {
  let completions = 0;
  const store: HarnessObservabilityReconciliationStore = {
    async completeObservabilityReconciliationWindow() {
      completions += 1;
    },
    async readObservabilityReconciliationBoundary() {
      return new Date('2026-07-29T10:05:00.000Z');
    },
    async readObservabilityReconciliationCursor() {
      return new Date('2026-07-29T09:40:00.000Z');
    },
    async readObservabilityDeliveryHealth() {
      return {
        lastSuccessAt: null,
        oldestQueuedAt: null,
        queueAgeMs: null,
      };
    },
    async readObservabilityDropSummary() {
      return [];
    },
    async reconcileBusinessEventsToTraces() {
      return {
        actionUsageEventCount: 0,
        businessEventCount: 0,
        traceCount: 0,
        matchedCount: 0,
        missingTraceCount: 0,
        orphanTraceCount: 0,
        ratingEventCount: 0,
        undeliveredEventCount: 0,
        cutoverAt: new Date('2026-07-29T09:00:00.000Z'),
      };
    },
  };

  await assert.rejects(
    new HarnessObservabilityReconciler(store, {
      onDeliverySnapshot() {
        throw new Error('snapshot sink unavailable');
      },
    }).runOnce(),
    /snapshot sink unavailable/u,
  );
  assert.equal(completions, 0);

  await new HarnessObservabilityReconciler(store).runOnce();
  assert.equal(completions, 1);
});

test('reconciliation is idle when another process completed the closed boundary', async () => {
  let reads = 0;
  const store: HarnessObservabilityReconciliationStore = {
    async completeObservabilityReconciliationWindow() {
      throw new Error('must not run');
    },
    async readObservabilityReconciliationBoundary() {
      reads += 1;
      return new Date('2026-07-29T10:05:00.000Z');
    },
    async readObservabilityReconciliationCursor() {
      reads += 1;
      return new Date('2026-07-29T10:05:00.000Z');
    },
    async readObservabilityDeliveryHealth() {
      throw new Error('must not run');
    },
    async readObservabilityDropSummary() {
      throw new Error('must not run');
    },
    async reconcileBusinessEventsToTraces() {
      throw new Error('must not run');
    },
  };

  assert.equal(
    await new HarnessObservabilityReconciler(store).runOnce(),
    null,
  );
  assert.equal(reads, 2);
});
