import assert from 'node:assert/strict';
import test from 'node:test';

import { boundedExecutionSnapshotSchema } from './bounded-execution.js';

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
