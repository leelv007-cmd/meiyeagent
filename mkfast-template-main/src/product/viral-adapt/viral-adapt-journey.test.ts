/**
 * Viral adapt journey unit tests (#324).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceViralSourcingToConfirm,
  canAdvanceViralSourcing,
  cancelViralAdaptJourney,
  composeViralAdaptSubmitIntent,
  confirmViralAdaptJourney,
  createViralAdaptJourneyState,
  defaultViralOpenCliLiveGate,
  isViralAdaptRecipeIntent,
  isViralOpenCliTrackEnabled,
  projectViralAdaptConfirmView,
  startViralAdaptJourney,
  updateViralPasteDraft,
} from './viral-adapt-journey';

test('live gate default is closed and never claims available', () => {
  const gate = defaultViralOpenCliLiveGate();
  assert.equal(gate.available, false);
  assert.match(gate.statusLabel, /暂不可用|未核销/u);
  assert.doesNotMatch(gate.statusLabel, /已可用/u);
  assert.equal(isViralOpenCliTrackEnabled(gate), false);
});

test('journey: chip → sourcing → confirm (source method) → ready intent', () => {
  let state = createViralAdaptJourneyState();
  state = startViralAdaptJourney(state);
  assert.equal(state.phase, 'sourcing');

  assert.equal(canAdvanceViralSourcing(state.draft), false);
  state = updateViralPasteDraft(state, {
    noteText:
      '油皮夏日护理\n三步到店\nhttps://xhs.invalid/explore/private-note?xsec_token=SECRET',
    imageAssetIds: ['asset-reference-1'],
  });
  assert.equal(canAdvanceViralSourcing(state.draft), true);

  const advanced = advanceViralSourcingToConfirm(state);
  assert.ok(!('error' in advanced));
  state = advanced;
  assert.equal(state.phase, 'confirm');
  assert.ok(state.confirm);
  assert.equal(state.confirm.schemaVersion, 'viral-adapt-confirm/v1');
  assert.match(state.confirm.sourceMethod.label, /粘贴/u);
  assert.match(state.confirm.sourceMethod.detail, /参考图/u);
  const sourceSpec = state.confirm.specs.find((r) => r.key === 'source_track');
  assert.ok(sourceSpec);
  assert.match(sourceSpec.value, /粘贴/u);
  assert.equal(state.confirm.opencliSlot.available, false);
  assert.match(state.confirm.opencliSlot.statusLabel, /暂不可用|未核销/u);

  const confirmed = confirmViralAdaptJourney(state);
  assert.ok(!('error' in confirmed));
  state = confirmed;
  assert.equal(state.phase, 'ready');
  assert.equal(
    state.merchantIntent,
    '请为本店项目复刻一篇小红书爆款笔记，参考素材已由商家确认。'
  );
  assert.deepEqual(state.sourcePayload, {
    schemaVersion: 'viral-adapt-source/v1',
    track: 'paste',
    noteText:
      '油皮夏日护理\n三步到店\nhttps://xhs.invalid/explore/private-note?xsec_token=SECRET',
    authorizedAssetIds: ['asset-reference-1'],
  });
  assert.doesNotMatch(state.merchantIntent, /\[viral_adapt_source:/u);
  assert.doesNotMatch(state.merchantIntent, /asset-reference-1/u);
  assert.doesNotMatch(state.merchantIntent, /油皮夏日护理/u);
  assert.doesNotMatch(state.merchantIntent, /https:\/\/|xsec_token|SECRET/u);
});

test('confirm contract projection lists 取材方式 and OpenCLI honesty', () => {
  const view = projectViralAdaptConfirmView({
    draft: { noteText: '正文', imageAssetIds: [] },
    liveGate: defaultViralOpenCliLiveGate(),
  });
  assert.equal(view.sourceMethod.track, 'paste');
  assert.equal(
    view.specs.some((s) => s.key === 'source_track' && /粘贴/u.test(s.value)),
    true
  );
  assert.equal(view.opencliSlot.available, false);
  assert.doesNotMatch(view.opencliSlot.statusLabel, /已可用/u);
});

test('empty paste cannot leave sourcing', () => {
  const state = startViralAdaptJourney(createViralAdaptJourneyState());
  const result = advanceViralSourcingToConfirm(state);
  assert.deepEqual(result, { error: 'empty_note_text' });
});

test('cancel resets journey', () => {
  let state = startViralAdaptJourney(createViralAdaptJourneyState());
  state = updateViralPasteDraft(state, { noteText: 'x' });
  state = cancelViralAdaptJourney(state);
  assert.equal(state.phase, 'idle');
  assert.equal(state.draft.noteText, '');
});

test('submit intent is merchant-safe while the structured source stays hidden', () => {
  const privateNoteToken =
    'RAW_NOTE_TOKEN_9f71 https://xhs.invalid/explore/private-note?xsec_token=SECRET';
  const intent = composeViralAdaptSubmitIntent({
    noteText: privateNoteToken,
    imageAssetIds: ['asset-reference-1'],
  });
  assert.doesNotMatch(intent, /爬虫|账号池|fetchNote/u);
  assert.doesNotMatch(intent, /\[viral_adapt_source:/u);
  assert.doesNotMatch(intent, /参考图资产|asset-reference-1/u);
  assert.doesNotMatch(intent, /RAW_NOTE_TOKEN_9f71/u);
  assert.doesNotMatch(intent, /https:\/\/|xsec_token|SECRET/u);
  assert.equal(
    intent,
    '请为本店项目复刻一篇小红书爆款笔记，参考素材已由商家确认。'
  );
});

test('recipe intent detector matches chip handoff copy', () => {
  assert.equal(
    isViralAdaptRecipeIntent(
      '帮我复刻一条爆款笔记：我会粘贴原文或参考内容，请按本店项目改写成可发版本。'
    ),
    true
  );
  assert.equal(isViralAdaptRecipeIntent('帮我做一篇小红书图文笔记'), false);
});
