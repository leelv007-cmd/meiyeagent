import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectExecutionCostFeedback,
  type ExecutionCostFeedback,
} from './execution-cost-feedback';
import {
  EXECUTION_CONFIRM_TRIGGER_MODE,
  shouldOpenExecutionConfirm,
} from './execution-confirm-card';

function text(feedback: ExecutionCostFeedback | null) {
  return feedback?.text ?? null;
}

/**
 * D-164⑥C requires that declining a run never read as free when it was not,
 * citing Miora, where declining still moved the merchant's balance. Under
 * D-109 the planner's cost goes to the ProviderCost ledger and never to the
 * merchant's bucket, so here declining really does cost her nothing — and
 * printing a charge would be inventing one. Ratified 2026-07-29 (D5).
 */
test('declining says nothing was spent, because nothing was', () => {
  const feedback = projectExecutionCostFeedback({ outcome: 'rejected' });

  assert.equal(text(feedback), '已取消，本次没有消耗额度');
  assert.equal(feedback?.tone, 'neutral');
});

test('a failed run says the quota came back', () => {
  // D-109 already commits to a full refund on an unaccepted or failed run and
  // the ledger already does it. This only says so where she can read it.
  assert.equal(
    text(projectExecutionCostFeedback({ outcome: 'failed' })),
    '本次没有成功，额度已退回'
  );
});

test('a settled run reports what was committed, in bucket counts', () => {
  const feedback = projectExecutionCostFeedback({
    available: { copy: 5, image: 6 },
    outcome: 'settled',
    settledUnits: [
      { cost: 1, resource: 'copy' },
      { cost: 3, resource: 'image' },
    ],
  });

  assert.match(text(feedback) ?? '', /^本次用了 /u);
  assert.match(text(feedback) ?? '', /1 条文案额度和 3 张图片额度/u);
  assert.match(text(feedback) ?? '', /文案还剩 5 条/u);
  // D1 / D-109「供应细节不可见」: counts only, never money.
  assert.doesNotMatch(text(feedback) ?? '', /CNY|￥|¥|元/u);
});

test('settlement that has not come back says nothing at all', () => {
  // Silence is the only honest option: 「本次用了 0 条」would be a claim about
  // her balance made out of missing data, which is what this line exists to
  // prevent.
  assert.equal(
    projectExecutionCostFeedback({ outcome: 'settled', settledUnits: [] }),
    null
  );
  assert.equal(
    projectExecutionCostFeedback({
      available: { copy: null },
      outcome: 'settled',
      settledUnits: [{ cost: 1, resource: 'copy' }],
    }),
    null
  );
});

test('a deterministic edit is never gated, in any trigger mode', () => {
  // D-164⑥ 决定 A: no model call, no confirmation, no cost notice.
  for (const mode of [
    'existing_gates',
    'all_generative',
    'cost_threshold',
  ] as const) {
    assert.equal(
      shouldOpenExecutionConfirm({
        existingGate: true,
        generative: false,
        mode,
      }),
      false,
      mode
    );
  }
});

test('v1 does not stack a second confirmation after an existing gate (D2)', () => {
  assert.equal(EXECUTION_CONFIRM_TRIGGER_MODE, 'existing_gates');
  assert.equal(
    shouldOpenExecutionConfirm({ existingGate: true, generative: true }),
    true
  );
  // The existing Brief confirmation carries the decision once completed.
  // Adding another card after it would turn one gate into two activations.
  assert.equal(
    shouldOpenExecutionConfirm({
      existingGate: true,
      existingGateSatisfied: true,
      generative: true,
    }),
    false
  );
  assert.equal(
    shouldOpenExecutionConfirm({ existingGate: false, generative: true }),
    false
  );
});

test('the other two modes are a recorded switch, and they work', () => {
  assert.equal(
    shouldOpenExecutionConfirm({
      existingGate: false,
      generative: true,
      mode: 'all_generative',
    }),
    true
  );
  assert.equal(
    shouldOpenExecutionConfirm({
      existingGate: false,
      generative: true,
      mode: 'cost_threshold',
      overThreshold: true,
    }),
    true
  );
  // No verdict from the server falls back to the existing gates, not to「不拦」:
  // silence is not permission, and the browser must never invent a threshold.
  assert.equal(
    shouldOpenExecutionConfirm({
      existingGate: true,
      generative: true,
      mode: 'cost_threshold',
    }),
    true
  );
});
