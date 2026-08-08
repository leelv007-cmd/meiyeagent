/**
 * Wire contract freeze: Core plan.created/plan.revised payload shape
 * (buildPlanLivingPlanEventPayload) must project five Living Plan sections.
 *
 * Golden payload mirrors apps/core plan-semantic-event builder output.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIVING_PLAN_SECTION_KEYS,
  parseLivingPlanEventPayload,
  projectLivingPlanView,
} from './living-plan-model';

/** Golden Core emit shape (V31-10 plan-semantic-event builder). */
const CORE_PLAN_CREATED_PAYLOAD = {
  planId: 'plan-ui-1',
  revision: 1,
  goal: {
    summary: '填补明天下午空档，推奶油风美甲',
    whyNow: '明天下午还有两个空档',
    desiredAction: '案例图文',
  },
  deliverables: [
    {
      kind: 'note',
      platform: 'xiaohongshu',
      quantity: 6,
      purpose: '案例图文',
    },
    {
      kind: 'copy',
      platform: 'wechat_moments',
      quantity: 1,
      purpose: '短文案',
    },
  ],
  expression: {
    voice: '专业温和',
    cta: '预约 CTA',
    promotionIntensity: 'soft',
  },
  factsAssets: {
    factsSummary: '已绑定 1 项事实用法',
    assetsSummary: '已绑定 1 项素材用法',
    rightsLabel: '素材授权通过',
  },
  costDuration: {
    creditCost: 38,
    balanceCredits: 126,
    failureRefundsCredits: true,
    durationLabel: '约 8–12 分钟',
  },
  readiness: 'ready',
  quoteRef: { id: 'plan-quote:plan-ui-1', revision: 'q1' },
};

const CORE_PLAN_REVISED_PAYLOAD = {
  ...CORE_PLAN_CREATED_PAYLOAD,
  revision: 2,
  adjustmentSummary: '只做小红书，减到 4 页',
  deliverables: [
    {
      kind: 'note',
      platform: 'xiaohongshu',
      quantity: 4,
      purpose: '案例图文',
    },
  ],
  costDuration: {
    creditCost: 24,
    balanceCredits: 126,
    failureRefundsCredits: true,
  },
};

test('Core plan.created payload → five Living Plan sections', () => {
  const facts = parseLivingPlanEventPayload(CORE_PLAN_CREATED_PAYLOAD);
  assert.ok(facts);
  const view = projectLivingPlanView(facts);
  assert.deepEqual(
    view.sections.map((section) => section.key),
    [...LIVING_PLAN_SECTION_KEYS]
  );
  assert.equal(view.sections.length, 5);
  assert.match(view.sections[0]!.body, /奶油风美甲/);
  assert.match(view.sections[1]!.body, /6 页/);
  assert.match(view.sections[4]!.body, /38 分/);
});

test('Core plan.revised payload keeps adjustment + still five sections', () => {
  const facts = parseLivingPlanEventPayload(CORE_PLAN_REVISED_PAYLOAD);
  assert.ok(facts);
  assert.equal(facts.adjustmentSummary, '只做小红书，减到 4 页');
  const view = projectLivingPlanView(facts);
  assert.equal(view.sections.length, 5);
  assert.match(view.sections[1]!.body, /4 页/);
  assert.match(view.sections[4]!.body, /24 分/);
});
