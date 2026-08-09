/**
 * V31-14 Context Fence §23.4 mid-execution classification.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
} from '@meiye/contracts';

import {
  buildExecutionPlanSnapshot,
  freezeExecutionPlanContent,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';
import {
  evaluateMidExecutionContextFence,
  evaluatePostConfirmPreExecuteFence,
} from './context-fence.js';

const BOUNDED = {
  schemaVersion: 'bounded-execution-snapshot/v1' as const,
  maxIterations: 10,
  maxCostCents: 100,
  maxWallClockMs: 60_000,
  maxDelegations: 2,
  requiredLimits: ['maxIterations', 'maxCostCents'] as const,
  consumption: {
    iterations: 0,
    costCents: 0,
    wallClockMs: 0,
    delegations: 0,
  },
  stopReason: null,
  triggeredLimit: null,
};

function snapshot() {
  const content = {
    planId: 'plan-1',
    planRevision: 1,
    intentDeclaration: { summary: '推广' },
    contextBundleRef: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'ctx-hash-1',
    },
    executionPlan: {
      schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
      units: [
        {
          unitId: 'unit-1',
          unitType: 'copy.generate',
          primitive: 'generate' as const,
        },
      ],
      dependencyGroups: [{ groupId: 'g1', unitIds: ['unit-1'] }],
      boundedRetry: {
        'unit-1': {
          maxAttempts: 1,
          maxCostCents: 0,
          retry: { enabled: false as const },
        },
      },
    },
    deliverables: [{ deliverableId: 'd1', kind: 'copy', quantity: 1 }],
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-1', revision: 1 },
    rightsRevisionRefs: ['rights-1'],
    factRevisionRefs: ['fact-1', 'fact-2'],
    boundedExecution: BOUNDED,
    harnessReleaseId: 'release-1',
    approvalBasis: 'merchant_confirmed',
  } as unknown as ExecutionPlanFrozenContent;
  const { snapshotHash } = freezeExecutionPlanContent(content);
  return buildExecutionPlanSnapshot({
    content,
    snapshotHash,
    confirmationDecisionRef: 'decision-1',
  });
}

test('in-flight rights revocation → safe_stop with noAdditionalCharge', () => {
  const action = evaluateMidExecutionContextFence({
    snapshot: snapshot(),
    live: { rightsRevoked: true },
  });
  assert.equal(action.action, 'safe_stop');
  if (action.action === 'safe_stop') {
    assert.equal(action.reason, 'rights_revoked');
    assert.equal(action.noAdditionalCharge, true);
    assert.equal(action.refundIfReserved, true);
  }
});

test('missing live quote fails closed instead of continuing execution', () => {
  for (const action of [
    evaluateMidExecutionContextFence({
      snapshot: snapshot(),
      live: { quoteMissing: true },
    }),
    evaluatePostConfirmPreExecuteFence({
      snapshot: snapshot(),
      live: { quoteMissing: true },
    }),
  ]) {
    assert.equal(action.action, 'safe_stop');
    if (action.action === 'safe_stop') {
      assert.equal(action.reason, 'quote_missing');
      assert.equal(action.noAdditionalCharge, true);
      assert.equal(action.refundIfReserved, true);
    }
  }
});

test('in-flight referenced price/date change → pause_prompt', () => {
  const action = evaluateMidExecutionContextFence({
    snapshot: snapshot(),
    live: { factRevisionRefs: ['fact-1'] },
    referencedPriceOrDateChanged: true,
  });
  assert.equal(action.action, 'pause_prompt');
  if (action.action === 'pause_prompt') {
    assert.equal(action.reason, 'referenced_price_or_date_change');
    assert.match(action.message, /价格|日期/);
  }
});

test('in-flight unused fact change → continue', () => {
  const action = evaluateMidExecutionContextFence({
    snapshot: snapshot(),
    live: { factRevisionRefs: ['fact-1'] },
    // fact-2 dropped but never referenced
    referencedFactRevisionIds: ['fact-1'],
  });
  assert.equal(action.action, 'continue');
});

test('in-flight referenced fact change → pause_prompt', () => {
  const action = evaluateMidExecutionContextFence({
    snapshot: snapshot(),
    live: { factRevisionRefs: ['fact-1'] },
    referencedFactRevisionIds: ['fact-2'],
  });
  assert.equal(action.action, 'pause_prompt');
});

test('post-confirm material quote drift → stale_reconfirm', () => {
  const action = evaluatePostConfirmPreExecuteFence({
    snapshot: snapshot(),
    live: { quoteRevision: 99 },
  });
  assert.equal(action.action, 'stale_reconfirm');
});

test('post-confirm rights revoked → safe_stop', () => {
  const action = evaluatePostConfirmPreExecuteFence({
    snapshot: snapshot(),
    live: { rightsRevoked: true },
  });
  assert.equal(action.action, 'safe_stop');
});

test('no live drift → continue', () => {
  const snap = snapshot();
  const action = evaluateMidExecutionContextFence({
    snapshot: snap,
    live: {
      quoteRevision: snap.quoteRef.revision,
      rightsRevisionRefs: [...snap.rightsRevisionRefs],
      factRevisionRefs: [...snap.factRevisionRefs],
    },
  });
  assert.equal(action.action, 'continue');
});
