import assert from 'node:assert/strict';
import test from 'node:test';

import { clarificationAnswerTurnMessage } from '../p1/agent-session/composer-plan-session.js';
import {
  E2E_GUIDANCE_ITEM_ID,
  E2E_GUIDANCE_QUESTION,
  e2eSessionFixtureDecision,
  isVagueGuidanceIntent,
} from './e2e-session-fixture-decision.js';

function prompt(text: string, assets: unknown[] = []): string {
  // Same shape the turn runner serialises: JSON.stringify(projection).
  return JSON.stringify({
    merchantRequest: { text, creationMode: 'customized' },
    assets,
    phase: 'intent',
  });
}

test('a vague guidance intent asks the industry question in the plan phase', () => {
  const decision = e2eSessionFixtureDecision({
    prompt: prompt('随便帮我写点这周能发的内容'),
  });
  assert.equal(decision.action.kind, 'ask_merchant');
  assert.deepEqual(
    decision.action.kind === 'ask_merchant' ? decision.action.question : null,
    { itemId: E2E_GUIDANCE_ITEM_ID, question: E2E_GUIDANCE_QUESTION },
  );
});

test('the clarification answer turn proposes a copy plan carrying the answer', () => {
  const decision = e2eSessionFixtureDecision({
    prompt: prompt(
      clarificationAnswerTurnMessage('随便帮我写点这周能发的内容', '皮肤管理'),
    ),
  });
  assert.equal(decision.action.kind, 'propose_plan');
  if (decision.action.kind !== 'propose_plan') return;
  assert.ok(decision.action.proposal.goalNarrative.includes('皮肤管理'));
  assert.ok(
    decision.action.proposal.goalNarrative.includes(
      '随便帮我写点这周能发的内容',
    ),
  );
  assert.deepEqual(
    decision.action.proposal.recommendedDeliverables.map((item) => ({
      carrier: item.carrier,
      quantity: item.quantity,
    })),
    [{ carrier: 'copy', quantity: 1 }],
  );
});

test('promotion intents stay in the Brief high-risk gate jurisdiction (no plan-phase ask)', () => {
  // 2026-08-12 adjudication: a promotion / missing-price intent always hits
  // the Brief informed-consent gate first and must not be asked twice.
  for (const text of [
    '写一条周末到店的团购活动文案',
    '写一条本周到店的优惠活动文案',
    '把新团购做一套能发的',
  ]) {
    assert.equal(isVagueGuidanceIntent(text), false, text);
    const decision = e2eSessionFixtureDecision({ prompt: prompt(text) });
    assert.equal(decision.action.kind, 'finish_turn', text);
  }
});

test('industry-named and asset-backed intents keep the deliver-first turn', () => {
  const industry = e2eSessionFixtureDecision({
    prompt: prompt('写一条新客皮肤护理到店体验文案'),
  });
  assert.equal(industry.action.kind, 'finish_turn');
  // 随便 + 皮肤 names the industry — customized route, nothing to ask.
  const vagueButNamed = e2eSessionFixtureDecision({
    prompt: prompt('随便写点皮肤管理的内容'),
  });
  assert.equal(vagueButNamed.action.kind, 'finish_turn');
  const withAssets = e2eSessionFixtureDecision({
    prompt: prompt('随便帮我写点这周能发的内容', [{ ref: 'asset-1' }]),
  });
  assert.equal(withAssets.action.kind, 'finish_turn');
});

test('三页 image-text prompts keep the three-page note plan fixture', () => {
  const decision = e2eSessionFixtureDecision({
    prompt: prompt('做一组三页的图文'),
  });
  assert.equal(decision.action.kind, 'propose_plan');
  if (decision.action.kind !== 'propose_plan') return;
  assert.deepEqual(
    decision.action.proposal.recommendedDeliverables.map((item) => ({
      carrier: item.carrier,
      quantity: item.quantity,
    })),
    [{ carrier: 'note', quantity: 3 }],
  );
  const conflictSample = e2eSessionFixtureDecision({
    prompt: prompt('三页 图文持续冲突样本'),
  });
  assert.equal(
    conflictSample.action.kind === 'propose_plan'
      ? conflictSample.action.proposal.goalNarrative
      : null,
    '图文持续冲突样本',
  );
});

test('a non-JSON prompt falls back to finish_turn', () => {
  const decision = e2eSessionFixtureDecision({ prompt: '随便写点什么' });
  assert.equal(decision.action.kind, 'finish_turn');
});
