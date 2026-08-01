/**
 * Viral adapt journey unit tests (#324).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceViralSourcingToConfirm,
  beginViralOpenCliRead,
  canAdvanceViralSourcing,
  cancelViralAdaptJourney,
  completeViralOpenCliRead,
  composeViralAdaptReadySource,
  confirmViralAdaptJourney,
  createViralAdaptJourneyState,
  defaultViralOpenCliLiveGate,
  isViralAdaptRecipeIntent,
  isViralOpenCliTrackEnabled,
  projectViralAdaptConfirmView,
  selectViralAdaptSourceTrack,
  startViralAdaptJourney,
  updateViralOpenCliLink,
  updateViralPasteDraft,
} from './viral-adapt-journey';

test('live gate default is closed and never claims available', () => {
  const gate = defaultViralOpenCliLiveGate();
  assert.equal(gate.available, false);
  assert.match(gate.statusLabel, /暂不可用|未核销/u);
  assert.doesNotMatch(gate.statusLabel, /已可用/u);
  assert.equal(isViralOpenCliTrackEnabled(gate), false);
});

test('verified live gate defaults to logged-in read but keeps paste fallback', () => {
  const state = startViralAdaptJourney(
    createViralAdaptJourneyState({
      evidencePresent: true,
      bridgeReady: true,
    })
  );

  assert.equal(state.sourceTrack, 'opencli_link');
  assert.equal(state.liveGate.available, true);
  assert.equal(state.opencli.bridgeReady, true);

  const paste = selectViralAdaptSourceTrack(state, 'paste');
  assert.equal(paste.sourceTrack, 'paste');
});

test('verified live gate without a ready device bridge defaults to paste', () => {
  const state = createViralAdaptJourneyState({ evidencePresent: true });

  assert.equal(state.liveGate.available, true);
  assert.equal(state.opencli.bridgeReady, false);
  assert.equal(state.sourceTrack, 'paste');
});

test('gate=false forces paste even when a host bridge is ready', () => {
  const state = startViralAdaptJourney(
    createViralAdaptJourneyState({
      evidencePresent: false,
      bridgeReady: true,
    })
  );

  assert.equal(state.sourceTrack, 'paste');
  assert.equal(state.opencli.bridgeReady, false);
  assert.equal(
    selectViralAdaptSourceTrack(state, 'opencli_link').sourceTrack,
    'paste'
  );
});

test('logged-in read separates merchant intent from the hidden source payload', () => {
  const completeUrl =
    'https://www.xiaohongshu.com/explore/fixture-note?xsec_token=fixture-secret';
  let state = startViralAdaptJourney(
    createViralAdaptJourneyState({ evidencePresent: true, bridgeReady: true })
  );
  state = updateViralOpenCliLink(state, completeUrl);

  const reading = beginViralOpenCliRead(state);
  assert.ok(!('error' in reading));
  state = reading;
  assert.equal(state.opencli.status, 'reading');

  const completed = completeViralOpenCliRead(state, {
    schemaVersion: 'viral-opencli-read/v1',
    noteText: '登录态读取的 fixture 笔记',
    authorizedAssets: [{ id: 'asset-opencli-1', revision: 'asset-revision-1' }],
  });
  assert.ok(!('error' in completed));
  state = completed;
  assert.equal(state.opencli.noteUrl, '');
  assert.equal(canAdvanceViralSourcing(state), true);

  const advanced = advanceViralSourcingToConfirm(state);
  assert.ok(!('error' in advanced));
  state = advanced;
  assert.equal(state.confirm?.sourceMethod.track, 'opencli_link');
  assert.match(state.confirm?.sourceMethod.label ?? '', /登录态/u);

  const confirmed = confirmViralAdaptJourney(state);
  assert.ok(!('error' in confirmed));
  assert.match(confirmed.merchantIntent ?? '', /本店项目|商家已确认/u);
  assert.doesNotMatch(
    confirmed.merchantIntent ?? '',
    /viral_adapt_source|asset-opencli-1|登录态读取的 fixture 笔记|xsec_token|fixture-secret|xiaohongshu\.com/u
  );
  assert.deepEqual(confirmed.sourcePayload, {
    schemaVersion: 'viral-adapt-source/v1',
    track: 'opencli_link',
    noteText: '登录态读取的 fixture 笔记',
    authorizedAssetIds: ['asset-opencli-1'],
  });
});

test('logged-in read rejects an imported asset without a real revision', () => {
  let state = startViralAdaptJourney(
    createViralAdaptJourneyState({ evidencePresent: true, bridgeReady: true })
  );
  state = updateViralOpenCliLink(
    state,
    'https://www.xiaohongshu.com/explore/fixture-note'
  );
  const reading = beginViralOpenCliRead(state);
  assert.ok(!('error' in reading));

  assert.deepEqual(
    completeViralOpenCliRead(reading, {
      schemaVersion: 'viral-opencli-read/v1',
      noteText: 'fixture note',
      authorizedAssets: [{ id: 'asset-opencli-1', revision: '' }],
    }),
    { error: 'invalid_bridge_result' }
  );
});

test('journey: chip → sourcing → confirm → safe merchant intent + hidden payload', () => {
  let state = createViralAdaptJourneyState();
  state = startViralAdaptJourney(state);
  assert.equal(state.phase, 'sourcing');

  assert.equal(canAdvanceViralSourcing(state), false);
  state = updateViralPasteDraft(state, {
    noteText:
      '油皮夏日护理\n三步到店\nhttps://xhs.invalid/explore/private-note?xsec_token=SECRET',
    imageAssetIds: ['asset-reference-1'],
  });
  assert.equal(canAdvanceViralSourcing(state), true);

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
  assert.doesNotMatch(
    state.merchantIntent,
    /viral_adapt_source|asset-reference-1|油皮夏日护理|商家粘贴|https:\/\/|xsec_token|SECRET/u
  );
  assert.deepEqual(state.sourcePayload, {
    schemaVersion: 'viral-adapt-source/v1',
    track: 'paste',
    noteText:
      '油皮夏日护理\n三步到店\nhttps://xhs.invalid/explore/private-note?xsec_token=SECRET',
    authorizedAssetIds: ['asset-reference-1'],
  });
});

test('confirm contract projection lists 取材方式 and OpenCLI honesty', () => {
  const view = projectViralAdaptConfirmView({
    sourceTrack: 'paste',
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

test('ready source composer never puts hidden source material in merchant intent', () => {
  const privateNoteToken =
    'RAW_NOTE_TOKEN_9f71 https://xhs.invalid/explore/private-note?xsec_token=SECRET';
  const ready = composeViralAdaptReadySource({
    sourceTrack: 'paste',
    draft: {
      noteText: privateNoteToken,
      imageAssetIds: ['asset-reference-1'],
    },
  });
  assert.doesNotMatch(
    ready.merchantIntent,
    /viral_adapt_source|参考图资产|asset-reference-1|RAW_NOTE_TOKEN_9f71|https:\/\/|xsec_token|SECRET|爬虫|账号池|fetchNote/u
  );
  assert.equal(
    ready.merchantIntent,
    '请为本店项目复刻一篇小红书爆款笔记，参考素材已由商家确认。'
  );
  assert.deepEqual(ready.sourcePayload, {
    schemaVersion: 'viral-adapt-source/v1',
    track: 'paste',
    noteText: privateNoteToken,
    authorizedAssetIds: ['asset-reference-1'],
  });
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
