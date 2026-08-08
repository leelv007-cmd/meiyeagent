/**
 * Plan revision diff readability (V31-10).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { LivingPlanRevisionFacts } from './living-plan-model';
import { diffLivingPlanFacts } from './plan-diff-model';

const REV1: LivingPlanRevisionFacts = {
  planId: 'plan-1',
  revision: 1,
  goal: { summary: '推奶油风美甲' },
  deliverables: [
    { kind: 'note', platform: '小红书', quantity: 6, purpose: '案例' },
    { kind: 'copy', platform: '朋友圈', quantity: 1 },
  ],
  expression: { voice: '专业温和' },
  factsAssets: { factsSummary: '不写价格', assetsSummary: '5 张图' },
  costDuration: { creditCost: 38, failureRefundsCredits: true },
};

const REV2: LivingPlanRevisionFacts = {
  ...REV1,
  revision: 2,
  adjustmentSummary: '只做小红书，减到 4 页',
  deliverables: [
    { kind: 'note', platform: '小红书', quantity: 4, purpose: '案例' },
  ],
  costDuration: { creditCost: 24, failureRefundsCredits: true },
};

test('diff highlights deliverables and cost when page count drops', () => {
  const diff = diffLivingPlanFacts(REV1, REV2);
  assert.equal(diff.planId, 'plan-1');
  assert.equal(diff.fromRevision, 1);
  assert.equal(diff.toRevision, 2);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.adjustmentSummary, '只做小红书，减到 4 页');

  const deliverables = diff.changedEntries.find(
    (entry) => entry.sectionKey === 'deliverables'
  );
  assert.ok(deliverables);
  assert.equal(deliverables.kind, 'changed');
  assert.match(deliverables.before, /6 页/);
  assert.match(deliverables.after, /4 页/);
  assert.doesNotMatch(deliverables.after, /朋友圈/);

  const cost = diff.changedEntries.find(
    (entry) => entry.sectionKey === 'cost_duration'
  );
  assert.ok(cost);
  assert.match(cost.summary, /38/);
  assert.match(cost.summary, /24/);
});

test('identical revisions produce empty changedEntries', () => {
  const diff = diffLivingPlanFacts(REV1, { ...REV1 });
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.changedEntries.length, 0);
  assert.equal(diff.entries.length, 5);
  assert.ok(diff.entries.every((entry) => entry.kind === 'unchanged'));
});
