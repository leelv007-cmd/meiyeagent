/**
 * Composer lens state machine — full phase coverage (C1 / #95, D-081).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLensSwitchPreview,
  canSubmit,
  cancelSwitch,
  confirmSwitch,
  createComposerLensState,
  lensStateView,
  requestSwitchLens,
  selectLens,
  submitComposer,
  switchRequiresConfirmation,
  undoChange,
  updateAssetRights,
  updateDeliverySuggestion,
  updateSelectedTools,
  updateSettings,
  updateSources,
  updateUserText,
  type ComposerLensState,
} from './lens-state-machine';
import { LENS_REQUIRED_SUBMIT_HINT } from './lens-labels';
import { buildComposerQuote, projectComposerQuoteView } from './quote-wiring';
import { bindQuoteView } from './lens-state-machine';

// ---------------------------------------------------------------------------
// Cold / unselected
// ---------------------------------------------------------------------------

test('cold start is unselected with no default lens', () => {
  const state = createComposerLensState();
  assert.equal(state.phase, 'unselected');
  assert.equal(state.lensId, null);
  assert.equal(state.source, null);
  assert.equal(state.draft.userText, '');

  const view = lensStateView(state);
  assert.equal(view.submitBlocked, true);
  assert.equal(view.submitHint, LENS_REQUIRED_SUBMIT_HINT);
});

test('unselected submit is blocked with required hint and focus target', () => {
  const state = createComposerLensState({ userText: '今天做个活动' });
  const gate = canSubmit(state);
  assert.equal(gate.allowed, false);
  if (!gate.allowed) {
    assert.equal(gate.reason, 'lens_unselected');
    assert.equal(gate.message, LENS_REQUIRED_SUBMIT_HINT);
    assert.equal(gate.focusTarget, 'lens_group');
  }

  const result = submitComposer(state);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.gate.allowed, false);
  }
});

// ---------------------------------------------------------------------------
// Select (user_explicit)
// ---------------------------------------------------------------------------

test('selectLens from cold records user_explicit and applies lens defaults', () => {
  let state: ComposerLensState = createComposerLensState({
    userText: '美甲优惠',
  });
  state = selectLens(state, 'image_text');

  assert.equal(state.phase, 'selected');
  assert.equal(state.lensId, 'image_text');
  assert.equal(state.source, 'user_explicit');
  assert.equal(state.draft.userText, '美甲优惠');
  assert.equal(state.draft.settings.aspectRatio, '3:4');
  assert.equal(state.draft.settings.quantity, 1);
});

test('selectLens keeps sources and asset rights from cold input', () => {
  let state: ComposerLensState = createComposerLensState();
  state = updateUserText(state, '保留原文');
  state = updateSources(state, [{ id: 'a1', kind: 'asset' }]);
  state = updateAssetRights(state, { consentScope: 'public_marketing' });
  state = selectLens(state, 'video');

  assert.equal(state.draft.userText, '保留原文');
  assert.deepEqual(state.draft.sources, [{ id: 'a1', kind: 'asset' }]);
  assert.deepEqual(state.draft.assetRights, {
    consentScope: 'public_marketing',
  });
  assert.equal(state.draft.settings.durationSeconds, 15);
  assert.equal(state.draft.settings.aspectRatio, '9:16');
});

// ---------------------------------------------------------------------------
// Switch without conflict (passthrough)
// ---------------------------------------------------------------------------

test('switch with only user text (no protected dirty) goes selected directly', () => {
  let state: ComposerLensState = createComposerLensState();
  state = selectLens(state, 'copy');
  state = updateUserText(state, '一字不改');
  state = requestSwitchLens(state, 'video');

  assert.equal(state.phase, 'selected');
  assert.equal(state.lensId, 'video');
  assert.equal(state.draft.userText, '一字不改');
  assert.equal(state.undoStack.length, 1);
});

// ---------------------------------------------------------------------------
// Switch with protected conflicts → switch_preview
// ---------------------------------------------------------------------------

function dirtySelectedState(): ComposerLensState {
  let state: ComposerLensState = createComposerLensState();
  state = selectLens(state, 'copy');
  state = updateUserText(state, '门店活动文案');
  state = updateSources(state, [{ id: 's1' }]);
  state = updateAssetRights(state, { rights: 'ok' });
  state = updateSettings(
    state,
    {
      catalogModelId: 'model.copy.pro',
      catalogModelName: '文案专业版',
      modelPolicyMode: 'fixed',
      quantity: 5,
    },
    'user'
  );
  state = updateSelectedTools(state, ['tool.multi_size']);
  const quote = buildComposerQuote({
    quoteId: 'q1',
    catalogModelId: 'model.copy.pro',
    quotePolicyRevision: 'qp-1',
    billingMode: 'per_request',
    unitRate: 1,
    quantity: 5,
  });
  state = bindQuoteView(state, projectComposerQuoteView(quote, 5));
  return state;
}

test('switch with protected fields enters switch_preview without changing lens', () => {
  let state = dirtySelectedState();
  state = requestSwitchLens(state, 'video');

  assert.equal(state.phase, 'switch_preview');
  assert.equal(state.lensId, 'copy'); // still active
  if (state.phase !== 'switch_preview') throw new Error('expected preview');
  assert.equal(state.preview.toLensId, 'video');
  assert.equal(state.preview.fromLensId, 'copy');
  assert.ok(state.preview.preserve.includes('userText'));
  assert.ok(state.preview.preserve.includes('sources'));
  assert.ok(state.preview.preserve.includes('assetRights'));
  assert.ok(state.preview.stash.includes('explicitModel'));
  assert.ok(state.preview.stash.includes('handEditedParams'));
  assert.ok(state.preview.stash.includes('selectedTools'));
  assert.ok(state.preview.stash.includes('confirmedQuote'));
  assert.ok(switchRequiresConfirmation(state.preview));
  assert.match(state.preview.primaryCtaLabel, /切换到视频/);
});

test('conflict lists cover preserve / stash / change triad', () => {
  const draft = dirtySelectedState().draft;
  const preview = buildLensSwitchPreview('copy', 'image_text', draft);

  const actions = new Set(preview.conflicts.map((c) => c.action));
  assert.ok(actions.has('preserve'));
  assert.ok(actions.has('stash'));
  // change list is populated for lens-scoped fields that will reset
  assert.ok(preview.change.length > 0);
  assert.ok(preview.preserve.length > 0);
  assert.ok(preview.stash.length > 0);
});

test('cancelSwitch restores original lens and draft', () => {
  let state = dirtySelectedState();
  const before = state;
  state = requestSwitchLens(state, 'video');
  assert.equal(state.phase, 'switch_preview');

  state = cancelSwitch(state);
  assert.equal(state.phase, 'selected');
  assert.equal(state.lensId, 'copy');
  assert.equal(state.draft.userText, before.draft.userText);
  assert.equal(state.draft.settings.catalogModelId, 'model.copy.pro');
  assert.deepEqual(state.draft.selectedToolIds, ['tool.multi_size']);
  assert.equal(state.undoStack.length, 0);
});

test('confirmSwitch applies target lens, keeps text, stashes previous', () => {
  let state = dirtySelectedState();
  state = requestSwitchLens(state, 'video');
  state = confirmSwitch(state);

  assert.equal(state.phase, 'selected');
  assert.equal(state.lensId, 'video');
  assert.equal(state.source, 'user_explicit');
  assert.equal(state.draft.userText, '门店活动文案');
  assert.deepEqual(state.draft.sources, [{ id: 's1' }]);
  assert.deepEqual(state.draft.assetRights, { rights: 'ok' });
  // lens-scoped settings reset to video defaults
  assert.equal(state.draft.settings.durationSeconds, 15);
  assert.equal(state.draft.settings.catalogModelId, null);
  assert.deepEqual(state.draft.selectedToolIds, []);
  assert.ok(state.stashByLens.copy);
  assert.equal(state.undoStack.length, 1);
});

test('undoChange after confirm restores previous lens settings', () => {
  let state = dirtySelectedState();
  state = requestSwitchLens(state, 'video');
  state = confirmSwitch(state);
  // user continues typing after switch
  state = updateUserText(state, '门店活动文案-续写');

  state = undoChange(state);
  assert.equal(state.phase, 'selected');
  assert.equal(state.lensId, 'copy');
  assert.equal(state.draft.settings.catalogModelId, 'model.copy.pro');
  assert.deepEqual(state.draft.selectedToolIds, ['tool.multi_size']);
  // live text is preserved through undo
  assert.equal(state.draft.userText, '门店活动文案-续写');
});

test('returning to a previously selected lens restores stashed settings', () => {
  let state = dirtySelectedState();
  state = requestSwitchLens(state, 'video');
  state = confirmSwitch(state);
  // clean video → copy should restore stash without preview (no video dirty)
  state = requestSwitchLens(state, 'copy');
  assert.equal(state.phase, 'selected');
  assert.equal(state.lensId, 'copy');
  assert.equal(state.draft.settings.catalogModelId, 'model.copy.pro');
  assert.deepEqual(state.draft.selectedToolIds, ['tool.multi_size']);
});

// ---------------------------------------------------------------------------
// Delivery suggestion does NOT reverse-change lens
// ---------------------------------------------------------------------------

test('platform + deliverable suggestion never changes lens', () => {
  let state: ComposerLensState = createComposerLensState();
  state = selectLens(state, 'copy');
  state = updateDeliverySuggestion(state, {
    platform: 'douyin',
    deliverableKind: 'short_video',
  });

  assert.equal(state.phase, 'selected');
  assert.equal(state.lensId, 'copy'); // still copy despite video-ish suggestion
  assert.equal(state.draft.delivery.platform, 'douyin');
  assert.equal(state.draft.delivery.deliverableKind, 'short_video');
});

// ---------------------------------------------------------------------------
// Freeze on submit
// ---------------------------------------------------------------------------

test('submit freezes lens and revisions; further select is no-op', () => {
  let state: ComposerLensState = createComposerLensState();
  state = selectLens(state, 'copy');
  state = updateUserText(state, '提交文案');
  const quote = buildComposerQuote({
    quoteId: 'q-submit',
    catalogModelId: 'model.copy.basic',
    quotePolicyRevision: 'qp-1',
    billingMode: 'per_request',
    unitRate: 1,
    quantity: 3,
  });
  state = bindQuoteView(state, projectComposerQuoteView(quote, 3));

  const result = submitComposer(state, {
    now: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected ok');
  assert.equal(result.state.phase, 'frozen');
  assert.equal(result.state.frozen.lensId, 'copy');
  assert.equal(result.state.frozen.quoteRevisionId, quote.revision);
  assert.equal(result.state.frozen.frozenAt, '2026-07-20T00:00:00.000Z');

  const blocked = selectLens(result.state, 'video');
  assert.equal(blocked.phase, 'frozen');
  assert.equal(blocked.lensId, 'copy');
});

test('video submit requires confirm; zone includes 按生成成片 N 秒计费', () => {
  let state: ComposerLensState = createComposerLensState();
  state = selectLens(state, 'video');
  const quote = buildComposerQuote({
    quoteId: 'q-video',
    catalogModelId: 'model.video.std',
    quotePolicyRevision: 'qp-v',
    billingMode: 'per_output_second',
    unitRate: 2,
    targetSeconds: 15,
    minChargeSeconds: 5,
    roundingStepSeconds: 1,
  });
  state = bindQuoteView(state, projectComposerQuoteView(quote));

  const blocked = submitComposer(state, { videoConfirmAccepted: false });
  assert.equal(blocked.ok, false);
  if (blocked.ok) throw new Error('expected block');
  assert.equal(blocked.gate.allowed, false);
  if (!blocked.gate.allowed) {
    assert.equal(blocked.gate.reason, 'video_confirm_required');
    assert.match(blocked.gate.message, /按生成成片/);
  }

  const ok = submitComposer(state, {
    videoConfirmAccepted: true,
    now: '2026-07-20T01:00:00.000Z',
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) throw new Error('expected ok');
  assert.equal(ok.state.phase, 'frozen');
  assert.ok(ok.videoConfirm?.billingNote?.includes('按生成成片'));
  assert.equal(ok.videoConfirm?.quotedSeconds, 15);
});

// ---------------------------------------------------------------------------
// Settings ownership
// ---------------------------------------------------------------------------

test('user-dirty settings are not overwritten by system defaults', () => {
  let state: ComposerLensState = createComposerLensState();
  state = selectLens(state, 'image_text');
  state = updateSettings(state, { aspectRatio: '1:1' }, 'user');
  state = updateSettings(state, { aspectRatio: '9:16' }, 'system');

  assert.equal(state.draft.settings.aspectRatio, '1:1');
  assert.equal(state.draft.fieldMeta.aspectRatio?.ownership, 'user');
  assert.equal(state.draft.fieldMeta.aspectRatio?.dirty, true);
});
