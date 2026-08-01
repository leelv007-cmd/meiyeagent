/**
 * Viral adapt paste-track (#324 / P2-12) — behavior tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIRAL_ADAPT_SOURCE_MARKER,
  availableViralSourcingTracks,
  composeViralAdaptRawInput,
  fixtureViralRewrite,
  isOpenCliTrackSelectable,
  isViralAdaptPasteRequest,
  normalizeViralPasteSource,
  parseViralAdaptPasteSource,
  notePlanInstructionsForViralAdapt,
  projectViralAdaptConfirm,
  projectViralAdaptNotePackage,
  resolveOpenCliLiveGate,
  runViralAdaptPasteToNoteProjection,
} from './viral-adapt.js';
import { HARNESS_BUILTIN_PROMPTS } from './langfuse-prompts.js';

test('live gate defaults closed — OpenCLI not selectable; paste only', () => {
  const gate = resolveOpenCliLiveGate();
  assert.equal(gate.available, false);
  assert.equal(gate.reasonCode, 'live_gate_unverified');
  assert.match(gate.statusLabel, /暂不可用|未核销/u);
  assert.doesNotMatch(gate.statusLabel, /已可用/u);
  assert.equal(isOpenCliTrackSelectable(gate), false);
  assert.deepEqual(availableViralSourcingTracks(gate), ['paste']);
});

test('live gate opens only when evidencePresent is true', () => {
  const gate = resolveOpenCliLiveGate({ evidencePresent: true });
  assert.equal(gate.available, true);
  assert.equal(gate.reasonCode, 'live_gate_verified');
  assert.deepEqual(availableViralSourcingTracks(gate), [
    'paste',
    'opencli_link',
  ]);
});

test('normalize paste source rejects empty text (no scrape fallback)', () => {
  assert.deepEqual(normalizeViralPasteSource({ noteText: '  \n  ' }), {
    error: 'empty_note_text',
  });
  const ok = normalizeViralPasteSource({
    noteText: '  标题\n正文  ',
    imageAssetIds: [' img-1 ', ''],
  });
  assert.ok(!('error' in ok));
  assert.equal(ok.track, 'paste');
  assert.equal(ok.noteText, '标题\n正文');
  assert.deepEqual(ok.imageAssetIds, ['img-1']);
});

test('confirm card explicitly names sourcing method (contract)', () => {
  const source = normalizeViralPasteSource({
    noteText: '油皮夏日护理\n三步清爽到店体验',
    imageAssetIds: ['a1'],
  });
  assert.ok(!('error' in source));
  const confirm = projectViralAdaptConfirm({ source });
  assert.equal(confirm.schemaVersion, 'viral-adapt-confirm/v1');
  assert.equal(confirm.sourceMethod.track, 'paste');
  assert.match(confirm.sourceMethod.label, /粘贴/u);
  assert.match(confirm.sourceMethod.detail, /参考图/u);
  const sourceSpec = confirm.specs.find((row) => row.key === 'source_track');
  assert.ok(sourceSpec);
  assert.match(sourceSpec.value, /粘贴/u);
  // OpenCLI slot reserved but honest while gate closed.
  assert.equal(confirm.opencliSlot.available, false);
  assert.match(confirm.opencliSlot.statusLabel, /暂不可用|未核销/u);
  assert.doesNotMatch(confirm.opencliSlot.statusLabel, /已可用/u);
  assert.match(confirm.specs.find((r) => r.key === 'deliverable')!.value, /note/u);
});

test('rawInput marker round-trips paste source for note path', () => {
  const source = normalizeViralPasteSource({
    noteText: '姐妹们！这家店的清爽护理也太懂了',
    imageAssetIds: ['asset-ref-1'],
  });
  assert.ok(!('error' in source));
  const raw = composeViralAdaptRawInput(source);
  assert.ok(raw.includes(VIRAL_ADAPT_SOURCE_MARKER));
  assert.ok(isViralAdaptPasteRequest(raw));
  assert.equal(isViralAdaptPasteRequest('普通图文意图'), false);
  const parsed = parseViralAdaptPasteSource(raw);
  assert.ok(parsed);
  assert.equal(parsed.track, 'paste');
  assert.match(parsed.noteText, /清爽护理/u);
  assert.deepEqual(parsed.imageAssetIds, ['asset-ref-1']);
});

test('fixture rewrite stays paste-honest and feeds merchantIntent', () => {
  const source = normalizeViralPasteSource({
    noteText: '【标题】油皮救星\n正文段落',
  });
  assert.ok(!('error' in source));
  const rewrite = fixtureViralRewrite(source);
  assert.equal(rewrite.schemaVersion, 'viral-adapt-rewrite/v1');
  assert.equal(rewrite.sourceTrack, 'paste');
  assert.match(rewrite.title, /油皮救星/u);
  assert.match(rewrite.sourceSummary, /粘贴/u);
  assert.doesNotMatch(rewrite.sourceSummary, /爬虫|匿名抓取/u);
  assert.ok(isViralAdaptPasteRequest(rewrite.merchantIntent));
});

test('note package projection yields carrier=note when assets present', () => {
  const source = normalizeViralPasteSource({
    noteText: '封面钩子\n页二痛点\n页三到店',
  });
  assert.ok(!('error' in source));
  const rewrite = fixtureViralRewrite(source);
  const empty = projectViralAdaptNotePackage({
    rewrite,
    orderedAssetIds: [],
  });
  assert.equal(empty.carrier, 'copy');

  const withAssets = projectViralAdaptNotePackage({
    rewrite,
    orderedAssetIds: ['p1', 'p2', 'p3'],
  });
  assert.equal(withAssets.kind, 'image_text');
  assert.equal(withAssets.carrier, 'note');
  assert.equal(withAssets.sourceTrack, 'paste');
  assert.deepEqual(withAssets.orderedAssetIds, ['p1', 'p2', 'p3']);
});

test('paste→note full projection seals confirm + note carrier', () => {
  const result = runViralAdaptPasteToNoteProjection({
    noteText: '爆款参考\n改写给本店',
    imageAssetIds: ['ref-img'],
    generatedAssetIds: ['gen-1', 'gen-2', 'gen-3'],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.package.carrier, 'note');
  assert.match(result.confirm.sourceMethod.label, /粘贴/u);
  assert.equal(result.confirm.opencliSlot.available, false);
  assert.equal(result.rewrite.sourceTrack, 'paste');
});

test('paste→note fails closed without generated assets (note not copy)', () => {
  const result = runViralAdaptPasteToNoteProjection({
    noteText: '有正文',
    generatedAssetIds: [],
  });
  assert.deepEqual(result, { ok: false, error: 'note_requires_assets' });
});

test('note plan instructions inject xhsViralRewrite only for paste-track marker', () => {
  const plain = notePlanInstructionsForViralAdapt({
    baseInstructions: 'BASE_NOTE_PLAN',
    planInput: { rawInput: '普通图文' },
  });
  assert.equal(plain.usedViralRewrite, false);
  assert.equal(plain.instructions, 'BASE_NOTE_PLAN');

  const viral = notePlanInstructionsForViralAdapt({
    baseInstructions: 'BASE_NOTE_PLAN',
    planInput: {
      rawInput: composeViralAdaptRawInput({
        track: 'paste',
        noteText: '参考正文',
        imageAssetIds: [],
      }),
    },
  });
  assert.equal(viral.usedViralRewrite, true);
  assert.match(viral.instructions, /BASE_NOTE_PLAN/u);
  assert.match(viral.instructions, /仿写/u);
  assert.ok(
    viral.instructions.includes(
      HARNESS_BUILTIN_PROMPTS.xhsViralRewrite.slice(0, 40),
    ),
  );
});
