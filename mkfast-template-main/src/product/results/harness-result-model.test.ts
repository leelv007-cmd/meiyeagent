import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compactDeliveredCopyResult,
  harnessCandidateResultModel,
  harnessCopyStreamPhase,
} from '@/product/results/harness-result-model';

test('the drafting label is reserved for a workflow that is not waiting on the merchant', () => {
  assert.equal(harnessCopyStreamPhase('suspended'), 'awaiting_confirmation');
  assert.equal(harnessCopyStreamPhase('running'), 'drafting');
  assert.equal(harnessCopyStreamPhase('waiting'), 'drafting');
  assert.equal(harnessCopyStreamPhase(undefined), 'drafting');
});

test('a finished workflow is not drafting — its text is already delivered', () => {
  // 「无假流式」: the renderer keys its caret / reveal off this phase, so
  // calling a terminal run drafting is what animates delivered copy.
  assert.equal(harnessCopyStreamPhase('success'), 'completed');
  assert.equal(harnessCopyStreamPhase('failed'), 'completed');
});

test('delivered copy without visual assets uses a compact text result', () => {
  const compact = compactDeliveredCopyResult({
    currentVersionId: 'version-1',
    generated: { assetIds: [] },
    kind: 'image_text',
    versions: [
      {
        id: 'version-1',
        title: '真实到店记录',
        body: '把服务细节和预约方式说清楚。',
        conversionHook: '私信预约',
        orderedAssetIds: [],
      },
    ],
  });

  assert.deepEqual(compact, {
    title: '真实到店记录',
    body: '把服务细节和预约方式说清楚。',
    conversionHook: '私信预约',
  });
  assert.equal(
    compactDeliveredCopyResult({
      currentVersionId: 'version-1',
      generated: { assetIds: ['asset-1'] },
      kind: 'image_text',
      versions: [
        {
          id: 'version-1',
          title: '有图成品',
          body: '正文',
          orderedAssetIds: ['asset-1'],
        },
      ],
    }),
    null
  );
});

test('compact copy result is carrier-gated: note (ordered media) and media (video) are not compact', () => {
  // #314: image_text + orderedAssetCount > 0 ⇒ note carrier — not pure copy.
  assert.equal(
    compactDeliveredCopyResult({
      currentVersionId: 'version-1',
      generated: { assetIds: [] },
      kind: 'image_text',
      versions: [
        {
          id: 'version-1',
          title: '图文笔记',
          body: '页组 + 封面 + 正文',
          orderedAssetIds: ['page-1', 'page-2'],
        },
      ],
    }),
    null,
    'orderedAssetCount > 0 under image_text is the note carrier'
  );
  // media carrier (wire kind video) is never compact text.
  assert.equal(
    compactDeliveredCopyResult({
      currentVersionId: 'version-1',
      generated: { assetIds: [] },
      kind: 'video',
      versions: [
        {
          id: 'version-1',
          title: '成片',
          body: '15 秒到店',
          orderedAssetIds: [],
        },
      ],
    }),
    null,
    'video wire kind maps to media carrier, not copy'
  );
  // generated assets without ordered ids still block compact delivery.
  assert.equal(
    compactDeliveredCopyResult({
      currentVersionId: 'version-1',
      generated: { assetIds: ['asset-pending'] },
      kind: 'image_text',
      versions: [
        {
          id: 'version-1',
          title: '待配图文案',
          body: '正文已出，图还在跑',
          orderedAssetIds: [],
        },
      ],
    }),
    null
  );
});

test('Harness result keeps the scored winner primary and exposes alternatives', () => {
  const result = harnessCandidateResultModel({
    currentVersionId: 'version-c02',
    harnessSelection: { recommendedCandidateId: 'c02' },
    versions: [
      harnessVersion('c01', 70),
      harnessVersion('c02', 92),
      harnessVersion('c03', 88),
    ],
  });

  assert.equal(result?.primary.candidateId, 'c02');
  assert.deepEqual(
    result?.alternatives.map(({ candidateId }) => candidateId),
    ['c03', 'c01']
  );
  assert.equal(result?.adoptedCandidateId, undefined);
});

function harnessVersion(candidateId: string, score: number) {
  return {
    body: `${candidateId} 正文`,
    conversionHook: '私信预约',
    harnessCandidateId: candidateId,
    harnessScore: score,
    id: `version-${candidateId}`,
    orderedAssetIds: [],
    title: `${candidateId} 标题`,
  };
}
