/**
 * Viral adapt journey unit tests (#324).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIRAL_ADAPT_SOURCE_MARKER,
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
    noteText: '油皮夏日护理\n三步到店',
    imageLabels: ['ref-1.png'],
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
  assert.ok(state.submitIntent);
  assert.ok(state.submitIntent.includes(VIRAL_ADAPT_SOURCE_MARKER));
  assert.match(state.submitIntent, /油皮夏日护理/u);
  assert.match(state.submitIntent, /商家粘贴/u);
});

test('confirm contract projection lists 取材方式 and OpenCLI honesty', () => {
  const view = projectViralAdaptConfirmView({
    draft: { noteText: '正文', imageLabels: [] },
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

test('submit intent composer is paste-honest', () => {
  const intent = composeViralAdaptSubmitIntent({
    noteText: '参考笔记',
    imageLabels: ['a.jpg'],
  });
  assert.ok(intent.startsWith(VIRAL_ADAPT_SOURCE_MARKER));
  assert.doesNotMatch(intent, /爬虫|账号池|fetchNote/u);
  assert.match(intent, /商家粘贴/u);
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
