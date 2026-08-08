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
