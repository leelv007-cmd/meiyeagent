import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRecommendationHandoff,
  buildRecommendationHandoff,
} from './recommendation-handoff';
import { createComposerLensState } from './composer/lens-state-machine';

const REC = {
  title: '周末到店预约',
  whyNow: '周末客流高峰',
  customerAction: '点链接预约',
};

test('P0-4: handoff without outputHint does not preset any lens (esp. not copy)', () => {
  const handoff = buildRecommendationHandoff(REC);
  assert.equal(handoff.outputHint, undefined);
  assert.ok(handoff.intent.length > 0);

  const next = applyRecommendationHandoff(createComposerLensState(), handoff);
  assert.equal(next.phase, 'unselected');
  assert.equal(next.lensId, null);
  assert.equal(next.draft.userText, handoff.intent);
});

test('P0-4: handoff with outputHint selects that lens, not a hard-coded copy', () => {
  const handoff = buildRecommendationHandoff(REC, 'image_text');
  assert.equal(handoff.outputHint, 'image_text');

  const next = applyRecommendationHandoff(createComposerLensState(), handoff);
  assert.equal(next.phase, 'selected');
  assert.equal(next.lensId, 'image_text');
  assert.equal(next.draft.userText, handoff.intent);
});

test('P0-4: video outputHint is respected', () => {
  const handoff = buildRecommendationHandoff(REC, 'video');
  const next = applyRecommendationHandoff(createComposerLensState(), handoff);
  assert.equal(next.lensId, 'video');
});
