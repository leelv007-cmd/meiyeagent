import assert from 'node:assert/strict';
import test from 'node:test';

import {
  autoConfirmedCreativeBrief,
  compactDeliveredCopyResult,
  harnessCandidateResultModel,
  harnessCopyStreamPhase,
  quoteRecoveryReady,
  restoredCreationOperation,
  streamErrorCode,
  workbenchComplianceContractValues,
  workbenchComplianceDefaults,
  workbenchGreetingName,
} from '@/product/workbench-state-model';

test('uses a non-blank store name for the personalized greeting', () => {
  assert.equal(workbenchGreetingName('  星月美甲  '), '星月美甲');
  assert.equal(workbenchGreetingName('   '), undefined);
  assert.equal(workbenchGreetingName(null), undefined);
});

test('falls back to the first known name when earlier candidates are blank', () => {
  assert.equal(
    workbenchGreetingName(undefined, '  林晓  '),
    '林晓',
    'a blank confirmed store name still yields the drafted name'
  );
  assert.equal(
    workbenchGreetingName('星月美甲', '林晓'),
    '星月美甲',
    'a confirmed store name wins over later candidates'
  );
  assert.equal(workbenchGreetingName(null, '   ', undefined), undefined);
});

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

test('an unexecuted video work restores its persisted creation operation', () => {
  assert.equal(
    restoredCreationOperation({ work: { operation: 'video.generate' } }),
    'video.generate'
  );
  assert.equal(
    restoredCreationOperation({
      currentJob: { contract: { operation: 'image.generate' } },
      work: { operation: 'video.generate' },
    }),
    'image.generate'
  );
  assert.equal(restoredCreationOperation({ work: {} }), 'copy.generate');
});

test('new work creation carries the three safe drafts into an atomically confirmed Brief', () => {
  assert.deepEqual(
    autoConfirmedCreativeBrief({
      audience: '附近有护理需求的顾客',
      scene: '基于已选素材介绍本次服务',
      tone: '专业、克制、可信',
    }),
    {
      autoConfirmBrief: true,
      briefDrafts: {
        audience: '附近有护理需求的顾客',
        scene: '基于已选素材介绍本次服务',
        tone: '专业、克制、可信',
      },
    }
  );
});

test('quote recovery waits for a genuinely new quote revision', () => {
  assert.equal(
    quoteRecoveryReady('quote-a', undefined, 'catalog-b', 'catalog-b'),
    false
  );
  assert.equal(
    quoteRecoveryReady('quote-a', 'quote-a', 'catalog-b', 'catalog-b'),
    false
  );
  assert.equal(
    quoteRecoveryReady('quote-a', 'quote-b', 'catalog-b', 'catalog-a'),
    false
  );
  assert.equal(
    quoteRecoveryReady('quote-a', 'quote-b', 'catalog-b', 'catalog-b'),
    true
  );
});

test('copy stream preserves a typed API error code from the raw error envelope', () => {
  assert.equal(
    streamErrorCode(
      new Error(
        JSON.stringify({
          error: {
            code: 'CREATIVE_QUOTE_CHANGED',
            message: 'The execution quote changed.',
          },
        })
      )
    ),
    'CREATIVE_QUOTE_CHANGED'
  );
  assert.equal(
    streamErrorCode(
      new Error(
        JSON.stringify({
          error: {
            code: 'INSUFFICIENT_ENTITLEMENT',
            message: 'Copy allowance is insufficient.',
          },
        })
      )
    ),
    'INSUFFICIENT_ENTITLEMENT'
  );
  assert.equal(streamErrorCode(new Error('network unavailable')), undefined);
});

test('admin false defaults remain false in the two real compliance switches and execution contract', () => {
  const switches = workbenchComplianceDefaults({
    'compliance.aigc_label.default': false,
    'compliance.watermark.default': true,
  });
  assert.deepEqual(switches, {
    aigcLabelEnabled: false,
    watermarkEnabled: true,
  });
  assert.deepEqual(workbenchComplianceContractValues(switches), {
    aigcLabelEnabled: false,
    watermarkEnabled: true,
  });
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
