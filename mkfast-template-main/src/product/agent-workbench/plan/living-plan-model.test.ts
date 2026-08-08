/**
 * Living Plan projection contract (V31-10 / V3.1 §5.3).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { marketingPlanRevisionSchema } from '@meiye/contracts';

import {
  LIVING_PLAN_SECTION_KEYS,
  LIVING_PLAN_SECTION_TITLES,
  formatDeliverableLine,
  livingPlanFactsFromRevision,
  parseLivingPlanEventPayload,
  projectLivingPlanView,
  type LivingPlanRevisionFacts,
} from './living-plan-model';

const BASE_FACTS: LivingPlanRevisionFacts = {
  planId: 'plan-1',
  revision: 1,
  goal: {
    summary: '填补明天下午空档，推奶油风美甲',
    whyNow: '明天下午还有两个空档',
    desiredAction: '发笔记引流预约',
  },
  deliverables: [
    {
      kind: 'note',
      platform: '小红书',
      quantity: 6,
      purpose: '案例图文',
    },
    {
      kind: 'copy',
      platform: '朋友圈',
      quantity: 1,
      purpose: '短文案',
    },
  ],
  expression: {
    voice: '专业温和',
    openingMechanism: '先讲真实需求',
    cta: '预约 CTA',
  },
  factsAssets: {
    factsSummary: '未写价格（无可靠来源）',
    assetsSummary: '5 张授权图片',
    rightsLabel: '素材授权通过',
  },
  costDuration: {
    creditCost: 38,
    balanceCredits: 126,
    durationLabel: '约 8–12 分钟',
    failureRefundsCredits: true,
  },
  readiness: 'ready',
};

test('projects five Living Plan sections in fixed order', () => {
  const view = projectLivingPlanView(BASE_FACTS);
  assert.equal(view.planId, 'plan-1');
  assert.equal(view.revision, 1);
  assert.deepEqual(
    view.sections.map((section) => section.key),
    [...LIVING_PLAN_SECTION_KEYS]
  );
  assert.equal(view.sections[0]?.title, LIVING_PLAN_SECTION_TITLES.goal);
  assert.equal(
    view.sections[1]?.title,
    LIVING_PLAN_SECTION_TITLES.deliverables
  );
  assert.equal(view.sections[2]?.title, LIVING_PLAN_SECTION_TITLES.expression);
  assert.equal(
    view.sections[3]?.title,
    LIVING_PLAN_SECTION_TITLES.facts_assets
  );
  assert.equal(
    view.sections[4]?.title,
    LIVING_PLAN_SECTION_TITLES.cost_duration
  );
  assert.match(view.sections[0]!.body, /奶油风美甲/);
  assert.match(view.sections[1]!.body, /小红书/);
  assert.match(view.sections[1]!.body, /6 页/);
  assert.match(view.sections[4]!.body, /38 分/);
  assert.match(view.compactSummary, /38 分/);
});

test('formatDeliverableLine keeps merchant language for note pages', () => {
  assert.equal(
    formatDeliverableLine({
      kind: 'note',
      platform: '小红书',
      quantity: 4,
      purpose: '案例',
    }),
    '小红书图文笔记 · 4 页 · 案例'
  );
});

test('does not invent quote when billing facts are absent', () => {
  const view = projectLivingPlanView({
    ...BASE_FACTS,
    costDuration: {},
  });
  const cost = view.sections.find((section) => section.key === 'cost_duration');
  assert.ok(cost);
  assert.match(cost.body, /报价由系统补齐/);
  assert.doesNotMatch(cost.body, /38/);
});

test('parseLivingPlanEventPayload fail-closes on missing goal', () => {
  assert.equal(parseLivingPlanEventPayload({ planId: 'p', revision: 1 }), null);
  const ok = parseLivingPlanEventPayload({
    planId: 'plan-2',
    revision: 2,
    goal: { summary: '只做小红书' },
    deliverables: [{ kind: 'note', platform: '小红书', quantity: 4 }],
    adjustmentSummary: '减到 4 页',
  });
  assert.ok(ok);
  assert.equal(ok.revision, 2);
  assert.equal(ok.adjustmentSummary, '减到 4 页');
  assert.equal(ok.deliverables[0]?.quantity, 4);
});

test('livingPlanFactsFromRevision maps contract fields without inventing quote', () => {
  const revision = marketingPlanRevisionSchema.parse({
    schemaVersion: 'marketing-plan-revision/v1',
    planId: 'plan-9',
    revision: 1,
    threadId: 'thread-1',
    goalIds: [],
    scope: 'single_work',
    intent: { summary: '护理案例' },
    goal: {
      summary: '新客引流',
      whyNow: null,
      desiredAction: '发笔记',
    },
    deliverables: [
      {
        deliverableId: 'd1',
        kind: 'note',
        platform: '小红书',
        quantity: 6,
      },
    ],
    expression: { voice: '自然' },
    factUsages: [],
    assetUsages: [],
    rightsSummary: {},
    complianceSummary: {},
    capabilitySummary: {},
    quoteRef: { id: 'quote-1', revision: 1 },
    boundRevisions: {
      intentRevision: 1,
      contextBundleId: 'b1',
      contextRevision: '1',
      recipeRevisionIds: [],
      catalogRevisionId: 'c1',
      modelRevisionIds: [],
      sourceRevisionIds: [],
      rightsRevisionIds: [],
      harnessReleaseId: 'r1',
    },
    contentHash: 'hash',
    expiresAt: '2026-08-09T00:00:00.000Z',
    createdAt: '2026-08-08T12:00:00.000Z',
  });
  const facts = livingPlanFactsFromRevision(revision, {
    billing: { creditCost: 20, failureRefundsCredits: true },
    rightsLabel: '素材授权通过',
  });
  assert.equal(facts.planId, 'plan-9');
  assert.equal(facts.costDuration.creditCost, 20);
  assert.equal(facts.factsAssets.rightsLabel, '素材授权通过');
  // quoteRef amounts are never lifted into cost without billing overlay
  assert.equal(facts.costDuration.balanceCredits, undefined);
});
