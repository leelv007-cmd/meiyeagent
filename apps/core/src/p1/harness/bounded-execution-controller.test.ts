import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  BoundedExecutionConsumption,
  BoundedExecutionLimitName,
  BoundedExecutionSnapshot,
} from '@meiye/contracts';

import {
  BoundedExecutionResumeError,
  evaluateBoundedExecution,
  resumeWithRaisedServerLimit,
} from './bounded-execution-controller.js';

const CASES = [
  ['maxIterations', 'iterations'],
  ['maxCostCents', 'costCents'],
  ['maxWallClockMs', 'wallClockMs'],
  ['maxDelegations', 'delegations'],
] as const satisfies ReadonlyArray<
  readonly [BoundedExecutionLimitName, keyof BoundedExecutionConsumption]
>;

for (const [limit, consumptionKey] of CASES) {
  test(`${limit} hit suspends with the best result and resumes only after a server-side raise`, () => {
    const initial = snapshot({ [limit]: 1 });
    const consumed = {
      ...initial.consumption,
      [consumptionKey]: 1,
    };

    const decision = evaluateBoundedExecution(initial, {
      consumption: { [consumptionKey]: 1 },
      currentBest: { candidateId: `${limit}-best` },
      unmetExplanation: `${limit} stopped before the final quality target.`,
    });

    assert.equal(decision.state, 'suspended');
    if (decision.state !== 'suspended') return;
    assert.equal(decision.resumable, true);
    assert.deepEqual(decision.currentBest, {
      candidateId: `${limit}-best`,
    });
    assert.equal(
      decision.unmetExplanation,
      `${limit} stopped before the final quality target.`,
    );
    assert.equal(decision.snapshot.stopReason, 'limit_reached');
    assert.equal(decision.snapshot.triggeredLimit, limit);
    assert.deepEqual(decision.snapshot.consumption, consumed);

    assert.throws(
      () =>
        resumeWithRaisedServerLimit(decision.snapshot, {
          limit,
          value: 1,
        }),
      BoundedExecutionResumeError,
    );

    const resumed = resumeWithRaisedServerLimit(decision.snapshot, {
      limit,
      value: 2,
    });
    assert.equal(resumed.stopReason, null);
    assert.equal(resumed.triggeredLimit, null);
    assert.equal(resumed[limit], 2);
    assert.deepEqual(resumed.consumption, consumed);
    assert.equal(
      evaluateBoundedExecution(resumed, {
        consumption: consumed,
        currentBest: { candidateId: `${limit}-best` },
        unmetExplanation: 'not used while under the raised limit',
      }).state,
      'continue',
    );
  });
}

test('only observed consumption can trigger a limit and simultaneous hits use canonical order', () => {
  const current = snapshot({
    maxIterations: 1,
    maxCostCents: 0,
  });
  const iterationOnly = evaluateBoundedExecution(current, {
    consumption: { iterations: 1 },
    currentBest: { candidateId: 'best' },
    unmetExplanation: 'one more iteration is required',
  });
  assert.equal(iterationOnly.state, 'suspended');
  if (iterationOnly.state !== 'suspended') return;
  assert.equal(iterationOnly.snapshot.triggeredLimit, 'maxIterations');

  const costOnly = evaluateBoundedExecution(current, {
    consumption: { costCents: 0 },
    currentBest: { candidateId: 'best' },
    unmetExplanation: 'cost budget is unavailable',
  });
  assert.equal(costOnly.state, 'suspended');
  if (costOnly.state !== 'suspended') return;
  assert.equal(costOnly.snapshot.triggeredLimit, 'maxCostCents');
});

test('consumption cannot move backwards across durable replay', () => {
  const current = snapshot({
    consumption: {
      iterations: 2,
      costCents: 3,
      wallClockMs: 4,
      delegations: 1,
    },
  });

  assert.throws(
    () =>
      evaluateBoundedExecution(current, {
        consumption: { iterations: 1 },
        currentBest: { candidateId: 'stale' },
        unmetExplanation: 'stale replay',
      }),
    /cannot move backwards/u,
  );
});

test('resume rejects a predecessor that did not reach its triggered limit', () => {
  const notReached = snapshot({
    maxIterations: 2,
    consumption: {
      iterations: 1,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: 'limit_reached',
    triggeredLimit: 'maxIterations',
  });

  assert.throws(
    () =>
      resumeWithRaisedServerLimit(notReached, {
        limit: 'maxIterations',
        value: 3,
      }),
    BoundedExecutionResumeError,
  );
});

function snapshot(
  overrides: Partial<BoundedExecutionSnapshot> = {},
): BoundedExecutionSnapshot {
  return {
    schemaVersion: 'bounded-execution-snapshot/v1',
    maxIterations: 'unset',
    maxCostCents: 'unset',
    maxWallClockMs: 'unset',
    maxDelegations: 'unset',
    requiredLimits: [],
    consumption: {
      iterations: 0,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: null,
    triggeredLimit: null,
    ...overrides,
  };
}
