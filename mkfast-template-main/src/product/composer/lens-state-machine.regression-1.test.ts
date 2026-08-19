import assert from 'node:assert/strict';
import test from 'node:test';

import {
  confirmSwitch,
  createComposerLensState,
  selectLens,
  updateDeliverySuggestion,
  updateSettings,
  updateUserText,
} from './lens-state-machine';

function imageTextDraft() {
  let state = selectLens(createComposerLensState(), 'image_text');
  state = updateUserText(state, '写一条八月护发笔记');
  return updateDeliverySuggestion(
    state,
    {
      deliverableKind: 'note',
      distributionTarget: 'manual_copy',
      platform: 'xiaohongshu',
    },
    'user'
  );
}

// Regression: ISSUE-002 — copy mode retained the image-text deliverable summary
// Found by /qa on 2026-08-19
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-19.md
test('direct lens switch resets the source deliverable kind', () => {
  const state = selectLens(imageTextDraft(), 'copy');

  assert.equal(state.phase, 'selected');
  assert.equal(state.draft.delivery.deliverableKind, null);
  assert.equal(state.draft.delivery.platform, 'xiaohongshu');
  assert.equal(state.draft.delivery.distributionTarget, 'manual_copy');
});

test('confirmed lens switch resets the source deliverable kind', () => {
  const dirty = updateSettings(
    imageTextDraft(),
    { aspectRatio: '3:4' },
    'user'
  );
  const preview = selectLens(dirty, 'copy');

  assert.equal(preview.phase, 'switch_preview');
  const confirmed = confirmSwitch(preview);
  assert.equal(confirmed.phase, 'selected');
  assert.equal(confirmed.draft.delivery.deliverableKind, null);
  assert.equal(confirmed.draft.delivery.platform, 'xiaohongshu');
  assert.equal(confirmed.draft.delivery.distributionTarget, 'manual_copy');
});
