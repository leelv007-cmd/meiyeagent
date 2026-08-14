import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectExecutionCostFeedback,
  type ExecutionCostFeedback,
} from './execution-cost-feedback';
import {
  EXECUTION_CONFIRM_TRIGGER_MODE,
  projectExecutionCost,
  projectHeldCreditsNotice,
  projectRefundDualStateNotice,
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

  assert.equal(text(feedback), '已取消，本次没有消耗积分');
  assert.equal(feedback?.tone, 'neutral');
});

test('a failed run says the credits came back', () => {
  // D-109 already commits to a full refund on an unaccepted or failed run and
  // the ledger already does it. This only says so where she can read it.
  assert.equal(
    text(projectExecutionCostFeedback({ outcome: 'failed' })),
    '本次没有成功，积分已退回'
  );
});

test('a settled run reports what was committed, in credits', () => {
  const feedback = projectExecutionCostFeedback({
    outcome: 'settled',
    settledCredits: 12,
  });

  assert.equal(text(feedback), '本次用了 12 分');
  assert.equal(feedback?.tone, 'positive');
  // D1 / D-109「供应细节不可见」: credits only, never money.
  assert.doesNotMatch(text(feedback) ?? '', /CNY|￥|¥|元/u);
});

test('settlement that has not come back says nothing at all', () => {
  // Silence is the only honest option: 「本次用了 0 分」would be a claim about
  // her balance made out of missing data, which is what this line exists to
  // prevent.
  for (const settledCredits of [undefined, null, 0, -3, 1.5]) {
    assert.equal(
      projectExecutionCostFeedback({ outcome: 'settled', settledCredits }),
      null,
      String(settledCredits)
    );
  }
});

test('V31-11 confirmation strip projects held credits and A5 refund dual-state', () => {
  assert.equal(projectHeldCreditsNotice(12), '已预留 12 分');
  assert.equal(projectHeldCreditsNotice(0), null);
  assert.equal(projectRefundDualStateNotice(true), '失败自动退回');
  assert.equal(projectRefundDualStateNotice(false), '该模型失败不退回');

  const cost = projectExecutionCost({
    requirements: [],
    creditCost: 12,
    reservedCredits: 12,
    failureRefundsCredits: true,
    availableCredits: 40,
    rightsSummary: '素材授权有效',
    factSummary: '门店地址已确认',
  });
  assert.equal(cost.heldNotice, '已预留 12 分');
  assert.equal(cost.refundNotice, '失败自动退回');
  assert.equal(cost.balanceNotice, '当前可用 40 分');
  assert.equal(cost.rightsNotice, '素材授权有效');
  assert.equal(cost.factNotice, '门店地址已确认');
  assert.match(cost.notice, /12/);
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

test('policy_exempt_copy never opens an execution confirm card (D1)', () => {
  assert.equal(
    shouldOpenExecutionConfirm({
      approvalBasis: 'policy_exempt_copy',
      existingGate: true,
      generative: true,
    }),
    false
  );
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
