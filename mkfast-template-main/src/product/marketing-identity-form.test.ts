import assert from 'node:assert/strict';
import test from 'node:test';

import {
  answerMarketingIdentityQuestion,
  marketingIdentityFlowState,
  marketingIdentityRegistrationFromDraft,
  marketingIdentityRegistrationPayload,
  type MarketingIdentityDraft,
  type MarketingIdentityQuestionId,
} from './marketing-identity-form';

function answer(
  draft: MarketingIdentityDraft,
  questionId: MarketingIdentityQuestionId,
  value: boolean | string | readonly string[]
) {
  return answerMarketingIdentityQuestion(draft, questionId, value);
}

// D-142: every identity now names the reach it was authorized for, so the
// shared journeys below answer the two scope questions the same way.
const SCOPE = {
  platforms: ['xiaohongshu', 'douyin'],
  scenes: ['daily_service_exposure'],
} as const;

function answerScope(draft: MarketingIdentityDraft) {
  return answer(
    answer(draft, 'allowedPlatforms', SCOPE.platforms),
    'allowedScenes',
    SCOPE.scenes
  );
}

test('brand identity registration asks one question at a time and keeps answered chips editable', () => {
  let draft: MarketingIdentityDraft = {};
  assert.deepEqual(marketingIdentityFlowState(draft), {
    answeredQuestionIds: [],
    currentQuestionId: 'kind',
    readyForPreview: false,
  });

  draft = answer(draft, 'kind', 'brand');
  draft = answer(draft, 'displayName', '青禾美业');
  draft = answer(draft, 'owner', '青禾品牌中心');
  draft = answer(draft, 'primaryClaimOrRole', '让专业护理更安心');
  draft = answer(draft, 'professionalBoundaries', '不提供医疗诊断');
  draft = answer(draft, 'expressionSamples', '先了解你的需求，再推荐护理方案');
  draft = answer(draft, 'sourceRef', 'brand-guideline-2026');
  draft = answer(draft, 'forbiddenClaims', '不承诺永久效果');
  draft = answer(draft, 'visualPrinciples', '自然肤色');
  draft = answer(draft, 'seriesAnchors', '每周护肤答疑');

  // The scope questions come last, and until both are ticked the wizard has
  // somewhere left to go.
  assert.equal(
    marketingIdentityFlowState(draft).currentQuestionId,
    'allowedPlatforms'
  );
  draft = answerScope(draft);

  const ready = marketingIdentityFlowState(draft);
  assert.equal(ready.currentQuestionId, null);
  assert.equal(ready.readyForPreview, true);
  assert.deepEqual(ready.answeredQuestionIds, [
    'kind',
    'displayName',
    'owner',
    'primaryClaimOrRole',
    'professionalBoundaries',
    'expressionSamples',
    'sourceRef',
    'forbiddenClaims',
    'visualPrinciples',
    'seriesAnchors',
    'allowedPlatforms',
    'allowedScenes',
  ]);

  draft = answer(draft, 'displayName', '青禾护理');
  const payload = marketingIdentityRegistrationFromDraft(draft);
  assert.equal(payload.kind, 'brand');
  assert.equal(payload.displayName, '青禾护理');
});

test('personal identity registration records explicit authorization answers before preview', () => {
  let draft: MarketingIdentityDraft = {};
  draft = answer(draft, 'kind', 'person');
  draft = answer(draft, 'displayName', '小美老师');
  draft = answer(draft, 'owner', '张小美');
  draft = answer(draft, 'primaryClaimOrRole', '染发师');
  draft = answer(draft, 'professionalBoundaries', '只分享染发与护发经验');
  draft = answer(draft, 'expressionSamples', '先看发质，再选发色');
  draft = answer(draft, 'sourceRef', 'authorization-form-1');
  draft = answer(draft, 'portraitAuthorized', true);

  assert.deepEqual(marketingIdentityFlowState(draft), {
    answeredQuestionIds: [
      'kind',
      'displayName',
      'owner',
      'primaryClaimOrRole',
      'professionalBoundaries',
      'expressionSamples',
      'sourceRef',
      'portraitAuthorized',
    ],
    currentQuestionId: 'voiceAuthorized',
    readyForPreview: false,
  });

  draft = answer(draft, 'voiceAuthorized', false);
  draft = answerScope(draft);
  const payload = marketingIdentityRegistrationFromDraft(draft);
  assert.equal(marketingIdentityFlowState(draft).readyForPreview, true);
  assert.equal(payload.kind, 'person');
  if (payload.kind !== 'person') assert.fail('Expected personal identity.');
  assert.equal(payload.portraitAuthorization, 'authorized');
  assert.equal(payload.voiceAuthorization, 'not_authorized');
});

test('identity draft preserves spaces and line breaks while the current answer is edited', () => {
  let draft: MarketingIdentityDraft = {};
  draft = answer(draft, 'displayName', 'Qing');
  draft = answer(draft, 'displayName', `${draft.displayName ?? ''} `);
  draft = answer(draft, 'displayName', `${draft.displayName ?? ''}He`);
  assert.equal(draft.displayName, 'Qing He');

  draft = answer(draft, 'expressionSamples', 'First line');
  draft = answer(
    draft,
    'expressionSamples',
    `${draft.expressionSamples ?? ''}\n`
  );
  draft = answer(
    draft,
    'expressionSamples',
    `${draft.expressionSamples ?? ''}Second line`
  );
  assert.equal(draft.expressionSamples, 'First line\nSecond line');
});

test('brand identity registration includes optional brand guidance in the command', () => {
  const payload = marketingIdentityRegistrationPayload({
    kind: 'brand',
    displayName: '青禾美业',
    owner: '青禾品牌中心',
    primaryClaimOrRole: '让专业护理更安心',
    professionalBoundaries: '不提供医疗诊断',
    expressionSamples: '先了解你的需求，再推荐护理方案',
    sourceRef: 'brand-guideline-2026',
    allowedPlatforms: SCOPE.platforms,
    allowedScenes: SCOPE.scenes,
    forbiddenClaims: '绝不代言速效美白\n不承诺永久效果',
    visualPrinciples: '自然肤色\n留白干净',
    seriesAnchors: '每周护肤答疑\n到店护理日记',
  });

  assert.equal(payload.kind, 'brand');
  if (payload.kind !== 'brand') assert.fail('Expected brand identity.');
  assert.deepEqual(payload.forbiddenClaims, [
    '绝不代言速效美白',
    '不承诺永久效果',
  ]);
  assert.deepEqual(payload.visualPrinciples, ['自然肤色', '留白干净']);
  assert.deepEqual(payload.seriesAnchors, ['每周护肤答疑', '到店护理日记']);
});

test('brand identity registration allows optional brand guidance to be left blank', () => {
  const payload = marketingIdentityRegistrationPayload({
    kind: 'brand',
    displayName: '青禾美业',
    owner: '青禾品牌中心',
    primaryClaimOrRole: '让专业护理更安心',
    professionalBoundaries: '不提供医疗诊断',
    expressionSamples: '先了解你的需求，再推荐护理方案',
    sourceRef: 'brand-guideline-2026',
    allowedPlatforms: SCOPE.platforms,
    allowedScenes: SCOPE.scenes,
    forbiddenClaims: '',
    visualPrinciples: '',
    seriesAnchors: '',
  });

  assert.equal(payload.kind, 'brand');
  if (payload.kind !== 'brand') assert.fail('Expected brand identity.');
  assert.deepEqual(payload.forbiddenClaims, []);
  assert.deepEqual(payload.visualPrinciples, []);
  assert.deepEqual(payload.seriesAnchors, []);
});

test('identity registration creates an explicit personal authorization contract', () => {
  const payload = marketingIdentityRegistrationPayload({
    kind: 'person',
    displayName: '小美老师',
    owner: '张小美',
    primaryClaimOrRole: '染发师',
    professionalBoundaries: '只分享染发与护发经验',
    expressionSamples: '先看发质，再选发色',
    sourceRef: 'authorization-form-1',
    allowedPlatforms: SCOPE.platforms,
    allowedScenes: SCOPE.scenes,
    portraitAuthorized: true,
    voiceAuthorized: false,
  });

  assert.equal(payload.kind, 'person');
  if (payload.kind !== 'person') assert.fail('Expected person identity.');
  assert.equal(payload.portraitAuthorization, 'authorized');
  assert.equal(payload.voiceAuthorization, 'not_authorized');
});

test('registered reach is exactly what the merchant ticked, never the full catalog', () => {
  // This assertion used to read the other way round: it pinned allowedScenes to
  // all five scenes, endorsing a client that answered on the merchant's behalf.
  const payload = marketingIdentityRegistrationPayload({
    kind: 'person',
    displayName: '小美老师',
    owner: '张小美',
    primaryClaimOrRole: '染发师',
    professionalBoundaries: '只分享染发与护发经验',
    expressionSamples: '先看发质，再选发色',
    sourceRef: 'authorization-form-1',
    allowedPlatforms: ['xiaohongshu'],
    allowedScenes: ['brand_personal_ip'],
    portraitAuthorized: true,
    voiceAuthorized: true,
  });

  assert.deepEqual(payload.allowedPlatforms, ['xiaohongshu']);
  assert.deepEqual(payload.allowedScenes, ['brand_personal_ip']);
});

test('a scope left untouched is not an answer and blocks registration', () => {
  let draft: MarketingIdentityDraft = {};
  draft = answer(draft, 'kind', 'person');
  draft = answer(draft, 'displayName', '小美老师');
  draft = answer(draft, 'owner', '张小美');
  draft = answer(draft, 'primaryClaimOrRole', '染发师');
  draft = answer(draft, 'professionalBoundaries', '只分享染发与护发经验');
  draft = answer(draft, 'expressionSamples', '先看发质，再选发色');
  draft = answer(draft, 'sourceRef', 'authorization-form-1');
  draft = answer(draft, 'portraitAuthorized', true);
  draft = answer(draft, 'voiceAuthorized', true);

  // Ticking a platform and then unticking it leaves an empty list, which is a
  // question still open — not a merchant who authorized nothing.
  draft = answer(draft, 'allowedPlatforms', ['douyin']);
  draft = answer(draft, 'allowedPlatforms', []);
  const flow = marketingIdentityFlowState(draft);
  assert.equal(flow.currentQuestionId, 'allowedPlatforms');
  assert.equal(flow.readyForPreview, false);
  assert.throws(() => marketingIdentityRegistrationFromDraft(draft), {
    message: 'Identity registration is incomplete.',
  });

  draft = answer(draft, 'allowedPlatforms', ['douyin']);
  draft = answer(draft, 'allowedScenes', ['traffic_opportunity']);
  assert.equal(marketingIdentityFlowState(draft).readyForPreview, true);
});

test('scope answers are deduplicated, catalog-ordered, and reject unknown values', () => {
  let draft: MarketingIdentityDraft = {};
  draft = answer(draft, 'allowedPlatforms', [
    'offline',
    'xiaohongshu',
    'offline',
  ]);
  assert.deepEqual(draft.allowedPlatforms, ['xiaohongshu', 'offline']);

  assert.throws(
    () => answer(draft, 'allowedScenes', ['daily_service_exposure', 'wechat']),
    { message: 'Unknown identity scope value: wechat' }
  );
  assert.throws(() => answer(draft, 'allowedPlatforms', 'xiaohongshu'), {
    message: 'Identity scope answers must be arrays.',
  });
});
