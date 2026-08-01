import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  STYLE_ANALYSIS_DIMENSION_LABELS,
  STYLE_ANALYSIS_STAGE_MESSAGE,
  detectStyleAnalysisMention,
  projectStyleAnalysisEntry,
  projectStyleAnalysisMentionNotice,
  submissionRoleForStyleReference,
  toggleStyleReferenceAsset,
} from './style-analysis-entry';

test('style analysis entry projects seven-dimension stage when @素材 selected', () => {
  assert.equal(STYLE_ANALYSIS_DIMENSION_LABELS.length, 7);

  const idle = projectStyleAnalysisEntry({
    attachedAssetIds: ['a1'],
    styleReferenceAssetIds: [],
  });
  assert.equal(idle.willAnalyze, false);
  assert.equal(idle.stageMessage, null);

  const active = projectStyleAnalysisEntry({
    attachedAssetIds: ['a1', 'a2'],
    styleReferenceAssetIds: ['a1'],
  });
  assert.equal(active.willAnalyze, true);
  assert.deepEqual(active.styleReferenceAssetIds, ['a1']);
  assert.equal(active.stageMessage, STYLE_ANALYSIS_STAGE_MESSAGE);
  assert.match(active.stageMessage!, /七维/);
});

test('toggle style reference is idempotent per asset', () => {
  const once = toggleStyleReferenceAsset([], 'asset-1');
  assert.deepEqual(once, ['asset-1']);
  const twice = toggleStyleReferenceAsset(once, 'asset-1');
  assert.deepEqual(twice, []);
  const other = toggleStyleReferenceAsset(once, 'asset-2');
  assert.deepEqual(other, ['asset-1', 'asset-2']);
});

test('selected style references use the production submission role', () => {
  assert.equal(
    submissionRoleForStyleReference('asset-1', ['asset-1']),
    'style'
  );
  assert.equal(
    submissionRoleForStyleReference('asset-2', ['asset-1']),
    'reference'
  );
});

test('detect @素材 mention and honest pending notice without asset', () => {
  assert.equal(detectStyleAnalysisMention('参考 @素材 出一套图'), true);
  assert.equal(detectStyleAnalysisMention('按门店资料写文案'), false);

  const pending = projectStyleAnalysisMentionNotice({
    intent: '按 @风格参考 仿一套',
    attachedAssetIds: [],
  });
  assert.equal(pending.pending, true);
  assert.match(pending.message!, /上传或点选/);

  const ready = projectStyleAnalysisMentionNotice({
    intent: '按 @参考图 仿一套',
    attachedAssetIds: ['asset-9'],
  });
  assert.equal(ready.pending, false);
  assert.equal(ready.message, STYLE_ANALYSIS_STAGE_MESSAGE);
});
