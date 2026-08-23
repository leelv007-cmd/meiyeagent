/**
 * Commit strip unifies Brief/quote/confirm status line (V31-10 / §5.4).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commitStripInputFromPlanFacts,
  projectCommitStrip,
} from './commit-strip-model';
import type { LivingPlanRevisionFacts } from './living-plan-model';

test('§5.4 status line joins credits · balance · rights · facts · refund', () => {
  const strip = projectCommitStrip({
    creditCost: 38,
    balanceCredits: 126,
    rightsOk: true,
    factsOk: true,
    failureRefundsCredits: true,
    readiness: 'ready',
  });
  assert.equal(strip.visible, true);
  assert.equal(
    strip.statusLine,
    '38 积分 · 余额 126 · 素材授权通过 · 事实可用 · 失败自动退回'
  );
  assert.equal(strip.startDisabled, false);
  assert.deepEqual(
    strip.actions.map((action) => action.label),
    ['返回修改', '开始制作']
  );
});

test('balance shortfall disables start (dual-exit stays on host)', () => {
  const strip = projectCommitStrip({
    creditCost: 38,
    balanceCredits: 10,
    rightsOk: true,
    factsOk: true,
    failureRefundsCredits: true,
  });
  assert.equal(strip.startDisabled, true);
  assert.equal(strip.startDisabledReason, 'balance_shortfall');
});

test('missing quote never invents cost chips', () => {
  const strip = projectCommitStrip({
    balanceCredits: 100,
    rightsOk: true,
  });
  assert.equal(strip.visible, true);
  assert.equal(strip.startDisabled, true);
  assert.equal(strip.startDisabledReason, 'quote_missing');
  assert.doesNotMatch(strip.statusLine, /\d+ 积分/);
});

test('delivered plan freezes start actions (EXEC-06)', () => {
  const strip = projectCommitStrip({
    creditCost: 20,
    balanceCredits: 80,
    rightsOk: true,
    factsOk: true,
    failureRefundsCredits: true,
    planLifecycle: 'delivered',
  });
  assert.equal(strip.actions.length, 0);
  assert.equal(strip.startDisabled, true);
  assert.match(strip.statusLine, /已经做好/);
});

test('commitStripInputFromPlanFacts maps living plan facts', () => {
  const facts: LivingPlanRevisionFacts = {
    planId: 'p1',
    revision: 1,
    goal: { summary: 'x' },
    deliverables: [],
    expression: {},
    factsAssets: {
      factsSummary: '事实可用',
      rightsLabel: '素材授权通过',
    },
    costDuration: {
      creditCost: 12,
      balanceCredits: 50,
      failureRefundsCredits: false,
    },
    readiness: 'ready',
  };
  const strip = projectCommitStrip(commitStripInputFromPlanFacts(facts));
  assert.match(strip.statusLine, /12 积分/);
  assert.match(strip.statusLine, /该模型失败不退回/);
  assert.equal(strip.startDisabled, false);
});

test('paid start stays disabled until confirmation request id exists', () => {
  const priced = {
    creditCost: 38,
    balanceCredits: 126,
    rightsOk: true,
    factsOk: true,
    failureRefundsCredits: true,
    readiness: 'ready' as const,
  };
  const waiting = projectCommitStrip({
    ...priced,
    requiresMerchantConfirmation: true,
  });
  assert.equal(waiting.startDisabled, true);
  assert.equal(waiting.startDisabledReason, 'confirmation_pending');

  const ready = projectCommitStrip({
    ...priced,
    requiresMerchantConfirmation: true,
    confirmationRequestId: 'confirmation:authority:task-paid',
  });
  assert.equal(ready.startDisabled, false);
});

test('image_text Living Plan start enables after the confirmation request id is bound', () => {
  const imageText = {
    creditCost: 38,
    balanceCredits: 126,
    rightsOk: true,
    factsOk: true,
    failureRefundsCredits: true,
    readiness: 'ready' as const,
    requiresMerchantConfirmation: true,
  };
  assert.equal(projectCommitStrip(imageText).startDisabled, true);
  assert.equal(
    projectCommitStrip({
      ...imageText,
      confirmationRequestId: 'confirmation:authority:image-text',
    }).startDisabled,
    false
  );
});

test('a ready priced plan keeps start enabled when workbench inferred confirmed/executing', () => {
  const ready = {
    creditCost: 38,
    balanceCredits: 126,
    rightsOk: true,
    factsOk: true,
    failureRefundsCredits: true,
    readiness: 'ready' as const,
    requiresMerchantConfirmation: true,
    confirmationRequestId: 'confirmation:authority:image-text',
  };
  assert.equal(
    projectCommitStrip({ ...ready, planLifecycle: 'confirmed' }).startDisabled,
    false
  );
  assert.equal(
    projectCommitStrip({ ...ready, planLifecycle: 'executing' }).startDisabled,
    false
  );
  assert.equal(
    projectCommitStrip({ ...ready, planLifecycle: 'draft' }).startDisabled,
    false
  );
  assert.equal(
    projectCommitStrip({ ...ready, planLifecycle: 'delivered' }).startDisabled,
    true
  );
});

test('commitStripInputFromPlanFacts carries planLifecycle into freeze', () => {
  const facts: LivingPlanRevisionFacts = {
    planId: 'p1',
    revision: 1,
    goal: { summary: 'x' },
    deliverables: [],
    expression: {},
    factsAssets: {
      factsSummary: '事实可用',
      rightsLabel: '素材授权通过',
    },
    costDuration: {
      creditCost: 12,
      balanceCredits: 50,
      failureRefundsCredits: true,
    },
    readiness: 'ready',
    planLifecycle: 'delivered',
  };
  const strip = projectCommitStrip(commitStripInputFromPlanFacts(facts));
  assert.equal(strip.actions.length, 0);
  assert.equal(strip.startDisabledReason, 'lifecycle_delivered');
  assert.match(strip.statusLine, /已经做好/u);
});

/**
 * V31-105 §10. Between the 202 that accepts 开始制作 and delivered/failed, the
 * strip kept reading `50 积分 · 返回修改 · 开始制作` with start pressable, while
 * the Workstream next to it was already narrating 「已确认执行方案，开始生成」.
 * Pressing it again is refused by Core
 * (`COMPOSER_PLAN_START_RUN_STATE_UNSTARTABLE`), so the button was offering a
 * refusal. `runInFlight` is the browser's own record of the start it got
 * accepted — not the inferred `executing` lifecycle the test above pins open.
 */
test('a run already in flight disables start without freezing the strip', () => {
  const ready = {
    creditCost: 50,
    balanceCredits: 126,
    rightsOk: true,
    factsOk: true,
    failureRefundsCredits: true,
    readiness: 'ready' as const,
    requiresMerchantConfirmation: true,
    confirmationRequestId: 'confirmation:authority:video',
  };
  assert.equal(projectCommitStrip(ready).startDisabled, false);

  const inFlight = projectCommitStrip({ ...ready, runInFlight: true });
  assert.equal(inFlight.startDisabled, true);
  assert.equal(inFlight.startDisabledReason, 'run_in_flight');
  // 返回修改 is still the merchant's way out; only the start is spent.
  assert.deepEqual(
    inFlight.actions.map((action) => action.id),
    ['revise', 'start']
  );

  // Terminal lifecycle still wins: delivered reads 已经做好, not 在跑.
  const delivered = projectCommitStrip({
    ...ready,
    runInFlight: true,
    planLifecycle: 'delivered',
  });
  assert.equal(delivered.startDisabledReason, 'lifecycle_delivered');
});
