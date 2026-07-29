import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundedExecutionEventSchema,
  boundedExecutionSnapshotSchema,
} from './bounded-execution.js';

test('bounded execution snapshots reject implicit limits and inconsistent stop facts', () => {
  const valid = {
    schemaVersion: 'bounded-execution-snapshot/v1',
    maxIterations: 50,
    maxCostCents: 0,
    maxWallClockMs: 'unset',
    maxDelegations: 0,
    requiredLimits: ['maxIterations', 'maxCostCents'],
    consumption: {
      iterations: 0,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: null,
    triggeredLimit: null,
  } as const;

  assert.deepEqual(boundedExecutionSnapshotSchema.parse(valid), valid);
  for (const invalid of [
    { ...valid, maxCostCents: undefined },
    { ...valid, maxCostCents: null },
    { ...valid, maxCostCents: 0.5 },
    { ...valid, requiredLimits: ['maxCostCents', 'maxIterations'] },
    { ...valid, requiredLimits: ['maxIterations', 'maxIterations'] },
    {
      ...valid,
      stopReason: 'limit_reached',
      triggeredLimit: null,
    },
    {
      ...valid,
      maxWallClockMs: 'unset',
      stopReason: 'limit_reached',
      triggeredLimit: 'maxWallClockMs',
    },
    { ...valid, unexpected: true },
  ]) {
    assert.equal(boundedExecutionSnapshotSchema.safeParse(invalid).success, false);
  }
});

test('bounded execution events consume the flat observability axes contract', () => {
  const suspended = boundedExecutionEventSchema.parse({
    event: 'bounded_execution.suspended',
    skillRevision: 'copy-selection@7',
    promptVersion: 'copy-candidate@12',
    catalogRevision: 'catalog-2026-07-29',
    scene: 'daily-service-exposure',
    snapshot: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 2,
      maxCostCents: 'unset',
      maxWallClockMs: 'unset',
      maxDelegations: 'unset',
      requiredLimits: ['maxIterations'],
      consumption: {
        iterations: 2,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: 'limit_reached',
      triggeredLimit: 'maxIterations',
    },
    currentBest: null,
    unmetExplanation: '尚未产出可校验草稿',
    resumable: true,
  });

  assert.equal(suspended.event, 'bounded_execution.suspended');
  assert.equal(suspended.skillRevision, 'copy-selection@7');
  assert.equal(Object.hasOwn(suspended, 'axes'), false);

  assert.equal(
    boundedExecutionEventSchema.safeParse({
      ...suspended,
      skillRevision: undefined,
      axes: {
        skillRevision: 'copy-selection@7',
      },
    }).success,
    false,
  );
});

test('bounded suspension events require consumption to reach the triggered limit', () => {
  const suspended = {
    event: 'bounded_execution.suspended',
    skillRevision: 'copy-selection@7',
    promptVersion: 'copy-candidate@12',
    catalogRevision: 'catalog-2026-07-29',
    scene: 'daily-service-exposure',
    snapshot: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 2,
      maxCostCents: 'unset',
      maxWallClockMs: 'unset',
      maxDelegations: 'unset',
      requiredLimits: ['maxIterations'],
      consumption: {
        iterations: 1,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: 'limit_reached',
      triggeredLimit: 'maxIterations',
    },
    currentBest: null,
    unmetExplanation: '尚未产出可校验草稿',
    resumable: true,
  } as const;

  for (const snapshot of [
    suspended.snapshot,
    {
      ...suspended.snapshot,
      maxIterations: 'unset',
      maxCostCents: 2,
      requiredLimits: ['maxCostCents'],
      triggeredLimit: 'maxCostCents',
      consumption: {
        ...suspended.snapshot.consumption,
        costCents: 1,
      },
    },
    {
      ...suspended.snapshot,
      maxIterations: 'unset',
      maxWallClockMs: 2,
      requiredLimits: ['maxWallClockMs'],
      triggeredLimit: 'maxWallClockMs',
      consumption: {
        ...suspended.snapshot.consumption,
        wallClockMs: 1,
      },
    },
    {
      ...suspended.snapshot,
      maxIterations: 'unset',
      maxDelegations: 2,
      requiredLimits: ['maxDelegations'],
      triggeredLimit: 'maxDelegations',
      consumption: {
        ...suspended.snapshot.consumption,
        delegations: 1,
      },
    },
  ]) {
    assert.equal(
      boundedExecutionEventSchema.safeParse({
        ...suspended,
        snapshot,
      }).success,
      false,
    );
  }
});

test('bounded resume events retain both the triggered and raised snapshots', () => {
  const previousSnapshot = boundedExecutionSnapshotSchema.parse({
    schemaVersion: 'bounded-execution-snapshot/v1',
    maxIterations: 1,
    maxCostCents: 'unset',
    maxWallClockMs: 'unset',
    maxDelegations: 'unset',
    requiredLimits: ['maxIterations'],
    consumption: {
      iterations: 1,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: 'limit_reached',
    triggeredLimit: 'maxIterations',
  });

  const resumed = boundedExecutionEventSchema.parse({
    event: 'bounded_execution.resumed',
    skillRevision: 'copy-selection@7',
    promptVersion: 'copy-candidate@12',
    catalogRevision: 'catalog-2026-07-29',
    scene: 'daily-service-exposure',
    previousSnapshot,
    snapshot: {
      ...previousSnapshot,
      maxIterations: 2,
      stopReason: null,
      triggeredLimit: null,
    },
    decisionId: 'decision-1',
  });

  assert.equal(resumed.event, 'bounded_execution.resumed');
  assert.equal(resumed.previousSnapshot.triggeredLimit, 'maxIterations');
  assert.equal(resumed.snapshot.maxIterations, 2);
});

test('bounded resume events only raise the triggered limit and preserve frozen facts', () => {
  const previousSnapshot = boundedExecutionSnapshotSchema.parse({
    schemaVersion: 'bounded-execution-snapshot/v1',
    maxIterations: 1,
    maxCostCents: 3,
    maxWallClockMs: 'unset',
    maxDelegations: 'unset',
    requiredLimits: ['maxIterations', 'maxCostCents'],
    consumption: {
      iterations: 1,
      costCents: 2,
      wallClockMs: 10,
      delegations: 0,
    },
    stopReason: 'limit_reached',
    triggeredLimit: 'maxIterations',
  });
  const valid = {
    event: 'bounded_execution.resumed',
    skillRevision: 'copy-selection@7',
    promptVersion: 'copy-candidate@12',
    catalogRevision: 'catalog-2026-07-29',
    scene: 'daily-service-exposure',
    previousSnapshot,
    snapshot: {
      ...previousSnapshot,
      maxIterations: 2,
      stopReason: null,
      triggeredLimit: null,
    },
    decisionId: 'decision-1',
  } as const;

  assert.equal(boundedExecutionEventSchema.safeParse(valid).success, true);
  for (const invalidSnapshot of [
    { ...valid.snapshot, maxIterations: 1 },
    { ...valid.snapshot, maxIterations: 0 },
    { ...valid.snapshot, schemaVersion: 'bounded-execution-snapshot/v2' },
    { ...valid.snapshot, requiredLimits: ['maxIterations'] },
    { ...valid.snapshot, maxCostCents: 4 },
    { ...valid.snapshot, maxWallClockMs: 20 },
    { ...valid.snapshot, maxDelegations: 1 },
    {
      ...valid.snapshot,
      consumption: {
        ...valid.snapshot.consumption,
        iterations: 2,
      },
    },
    {
      ...valid.snapshot,
      consumption: {
        ...valid.snapshot.consumption,
        costCents: 3,
      },
    },
    {
      ...valid.snapshot,
      consumption: {
        ...valid.snapshot.consumption,
        wallClockMs: 11,
      },
    },
    {
      ...valid.snapshot,
      consumption: {
        ...valid.snapshot.consumption,
        delegations: 1,
      },
    },
    {
      ...valid.snapshot,
      stopReason: 'limit_reached',
      triggeredLimit: 'maxIterations',
    },
  ]) {
    assert.equal(
      boundedExecutionEventSchema.safeParse({
        ...valid,
        snapshot: invalidSnapshot,
      }).success,
      false,
    );
  }
});
