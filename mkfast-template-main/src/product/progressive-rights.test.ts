import assert from 'node:assert/strict';
import test from 'node:test';

import {
  answerRightsPurpose,
  answerRightsSubject,
  answerRightsTerm,
  createProgressiveRightsDraft,
  progressiveRightsToFacts,
  projectProgressiveRightsView,
  setRightsAdvancedOpen,
  toggleRightsPlatform,
  updateRightsAdvancedDraft,
} from './progressive-rights';

test('restricted public path asks subject → purpose → platforms → term one at a time', () => {
  let draft = createProgressiveRightsDraft();
  assert.equal(
    projectProgressiveRightsView(draft).currentQuestionId,
    'subject'
  );

  draft = answerRightsSubject(draft, '顾客张女士');
  assert.equal(
    projectProgressiveRightsView(draft).currentQuestionId,
    'purpose'
  );

  draft = answerRightsPurpose(draft, 'public_marketing');
  assert.equal(
    projectProgressiveRightsView(draft).currentQuestionId,
    'platforms'
  );

  draft = toggleRightsPlatform(draft, 'xiaohongshu');
  assert.equal(projectProgressiveRightsView(draft).currentQuestionId, 'term');

  draft = answerRightsTerm(draft, { noFixedExpiry: true });
  const view = projectProgressiveRightsView(draft);
  assert.equal(view.currentQuestionId, null);
  assert.equal(view.readyForAuthorize, true);
  assert.equal(view.effectiveConsentScope, 'public_marketing');
  assert.deepEqual(view.answeredQuestionIds, [
    'subject',
    'purpose',
    'platforms',
    'term',
  ]);
});

test('unconfirmed public marketing stays internal_only', () => {
  let draft = createProgressiveRightsDraft({
    subject: '顾客李女士',
    purpose: 'public_marketing',
  });
  const view = projectProgressiveRightsView(draft);
  assert.equal(view.readyForAuthorize, false);
  assert.equal(view.effectiveConsentScope, 'internal_only');
  assert.equal(
    progressiveRightsToFacts({
      draft,
      category: 'customer_case',
      containsPerson: true,
      containsSensitiveData: false,
      minorStatus: 'none',
    }),
    null
  );

  draft = answerRightsPurpose(draft, 'internal_only');
  const internal = projectProgressiveRightsView(draft);
  assert.equal(internal.readyForAuthorize, true);
  assert.equal(internal.effectiveConsentScope, 'internal_only');
  assert.equal(internal.currentQuestionId, null);
});

test('advanced evidence expands on demand and keeps draft when collapsed', () => {
  let draft = createProgressiveRightsDraft({
    subject: '顾客王女士',
    purpose: 'public_marketing',
    platforms: ['douyin'],
    noFixedExpiry: true,
  });
  draft = updateRightsAdvancedDraft(draft, {
    evidence: 'auth-form-2026',
    exceptions: '不含付费投放',
  });
  draft = setRightsAdvancedOpen(draft, true);
  assert.equal(draft.advancedOpen, true);
  draft = setRightsAdvancedOpen(draft, false);
  assert.equal(draft.advancedOpen, false);
  assert.equal(draft.evidence, 'auth-form-2026');
  assert.equal(draft.exceptions, '不含付费投放');

  const facts = progressiveRightsToFacts({
    draft,
    category: 'customer_case',
    containsPerson: true,
    containsSensitiveData: false,
    minorStatus: 'none',
  });
  assert.ok(facts);
  assert.equal(facts?.consentScope, 'public_marketing');
  assert.equal(facts?.rightsOwner, '顾客王女士');
  assert.equal(facts?.rightsEvidence, 'auth-form-2026');
  assert.deepEqual(facts?.rightsPlatforms, ['douyin']);
  assert.equal(facts?.rightsNoFixedExpiry, true);
});
