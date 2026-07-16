import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ContentPackage,
  CreativeAssetProjection,
  CreativeContent,
  CreativeJob,
  CreativeWork,
} from '@meiye/contracts';

import {
  buildCopyCandidateSelectorModel,
  copyCandidateActionErrorMessage,
  createCopyCandidateCommand,
  currentCreativeJobForWork,
  moveOrderedVisualAsset,
  toggleOrderedVisualAsset,
} from './copy-candidate-selector-model';

const job: CreativeJob = {
  batchNumber: 2,
  batchRootJobId: 'job-copy-root',
  contract: {
    aigcLabelEnabled: true,
    catalogModelId: 'copy-model',
    catalogRevision: 'catalog-v1',
    currency: 'CNY',
    dataClass: [],
    estimatedAmount: 3,
    operation: 'copy.generate',
    outputCount: 3,
    outputLabel: '3 条内容候选',
    quoteAcceptedAt: '2026-07-13T08:00:00.000Z',
    quoteRevision: 'quote-v1',
    watermarkEnabled: false,
  },
  createdAt: '2026-07-13T08:00:00.000Z',
  id: 'job-copy-current',
  outputAssetIds: ['asset-a', 'asset-b', 'asset-c'],
  outputContentIds: [],
  productUsageQuantity: 1,
  qualityRetryNumber: 0,
  status: 'completed',
  submissionKey: 'copy-current',
  updatedAt: '2026-07-13T08:00:01.000Z',
  workId: 'work-copy',
  workspaceId: 'workspace-copy',
};

const assets: CreativeAssetProjection[] = [
  {
    body: '**C 正文**',
    candidateIndex: 2,
    conversionHook: '预约前留言',
    createdAt: '2026-07-13T08:00:01.000Z',
    id: 'asset-c',
    jobId: job.id,
    kind: 'text',
    title: '候选 C',
    workId: job.workId,
    workspaceId: job.workspaceId,
  },
  {
    body: '**A 正文**',
    candidateIndex: 0,
    conversionHook: '立即咨询',
    createdAt: '2026-07-13T08:00:01.000Z',
    id: 'asset-a',
    jobId: job.id,
    kind: 'text',
    title: '候选 A',
    workId: job.workId,
    workspaceId: job.workspaceId,
  },
  {
    body: '**B 正文**',
    candidateIndex: 1,
    conversionHook: '收藏后预约',
    createdAt: '2026-07-13T08:00:01.000Z',
    id: 'asset-b',
    jobId: job.id,
    kind: 'text',
    title: '候选 B',
    workId: job.workId,
    workspaceId: job.workspaceId,
  },
];

const work: CreativeWork = {
  createdAt: '2026-07-13T08:00:00.000Z',
  currentJobId: job.id,
  id: job.workId,
  intent: '写一组门店文案',
  mode: 'agent',
  sessionId: 'session-copy',
  sourceReferences: [],
  status: 'completed',
  updatedAt: '2026-07-13T08:00:01.000Z',
  workspaceId: job.workspaceId,
};

test('resolves the current job inside one work without crossing work boundaries', () => {
  const newerSameWork = {
    ...job,
    id: 'job-copy-newer',
    updatedAt: '2026-07-13T08:00:03.000Z',
  };
  const newestOtherWork = {
    ...job,
    id: 'job-other-work',
    updatedAt: '2026-07-13T08:00:04.000Z',
    workId: 'work-other',
  };
  const jobs = [newerSameWork, newestOtherWork, job];

  assert.equal(currentCreativeJobForWork(work, jobs)?.id, job.id);
  assert.equal(
    currentCreativeJobForWork({ ...work, currentJobId: undefined }, jobs)?.id,
    newerSameWork.id
  );
  assert.equal(
    currentCreativeJobForWork({ ...work, currentJobId: 'job-missing' }, jobs),
    undefined
  );
  assert.equal(currentCreativeJobForWork(undefined, jobs), undefined);
});

test('sorts one complete copy batch into stable A/B/C candidates', () => {
  const model = buildCopyCandidateSelectorModel({
    assets,
    contents: [],
    job,
  });

  assert.equal(model.status, 'ready');
  assert.deepEqual(
    model.candidates.map((candidate) => [candidate.label, candidate.asset.id]),
    [
      ['A', 'asset-a'],
      ['B', 'asset-b'],
      ['C', 'asset-c'],
    ]
  );
  assert.equal(model.selectedAssetId, undefined);
  assert.equal(model.canAccept, false);
  assert.equal(model.batchLabel, '第 2 批');
});

test('requires an explicit valid selection before the one accept action', () => {
  const selected = buildCopyCandidateSelectorModel({
    assets,
    contents: [],
    job,
    selectedAssetId: 'asset-b',
  });
  const unknown = buildCopyCandidateSelectorModel({
    assets,
    contents: [],
    job,
    selectedAssetId: 'asset-unknown',
  });

  assert.equal(selected.selectedAssetId, 'asset-b');
  assert.equal(selected.canAccept, true);
  assert.equal(unknown.selectedAssetId, undefined);
  assert.equal(unknown.canAccept, false);
});

test('locks the batch to its one persisted accepted Content', () => {
  const contents: CreativeContent[] = [
    {
      acceptedAt: '2026-07-13T08:05:00.000Z',
      assetIds: ['asset-b'],
      body: '**B 正文**',
      createdAt: '2026-07-13T08:05:00.000Z',
      id: 'content-b',
      jobId: job.id,
      status: 'accepted',
      title: '候选 B',
      workId: job.workId,
      workspaceId: job.workspaceId,
    },
  ];
  const model = buildCopyCandidateSelectorModel({
    assets,
    contents,
    job: { ...job, outputContentIds: ['content-b'] },
    selectedAssetId: 'asset-a',
  });

  assert.equal(model.status, 'accepted');
  assert.equal(model.acceptedAssetId, 'asset-b');
  assert.equal(model.acceptedPackageId, undefined);
  assert.equal(model.selectedAssetId, 'asset-b');
  assert.equal(model.canAccept, false);
  assert.equal(model.canPaidReroll, false);
  assert.equal(model.canQualityRetry, false);
  assert.equal(
    model.candidates.find((candidate) => candidate.asset.id === 'asset-b')
      ?.accepted,
    true
  );
});

test('locks the batch to its adopted ContentPackage without legacy double writes', () => {
  const contentPackage: ContentPackage = {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-13T08:05:00.000Z',
    currentVersionId: 'package-version-1',
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: 'package-1',
    kind: 'image_text',
    lineage: {},
    rights: { state: 'authorized' },
    source: { assetIds: ['asset-b'], workId: job.workId },
    status: 'accepted',
    updatedAt: '2026-07-13T08:05:00.000Z',
    variants: [],
    versions: [
      {
        body: '**B 正文**',
        createdAt: '2026-07-13T08:05:00.000Z',
        id: 'package-version-1',
        orderedAssetIds: [],
        title: '候选 B',
        topics: [],
      },
    ],
    workspaceId: job.workspaceId,
  };

  const model = buildCopyCandidateSelectorModel({
    assets,
    contents: [],
    job,
    packages: [contentPackage],
  });

  assert.equal(model.status, 'accepted');
  assert.equal(model.acceptedAssetId, 'asset-b');
  assert.equal(model.acceptedPackageId, 'package-1');
  assert.equal(model.canAccept, false);
});

test('keeps paid and quality usage copy explicit without inventing a zero price', () => {
  const paid = buildCopyCandidateSelectorModel({
    assets,
    contents: [],
    job,
  });
  const exhausted = buildCopyCandidateSelectorModel({
    assets,
    contents: [],
    job: {
      ...job,
      batchNumber: 4,
      productUsageQuantity: 0,
      qualityRetryNumber: 2,
      rerollKind: 'quality',
    },
  });

  assert.equal(paid.remainingQualityRetries, 2);
  assert.equal(paid.usedQualityRetries, 0);
  assert.match(paid.currentUsageLabel, /消耗 1 次/);
  assert.match(paid.paidUsageLabel, /将消耗 1 次/);
  assert.match(paid.qualityUsageLabel, /额外消耗 0 次/);
  assert.equal(exhausted.remainingQualityRetries, 0);
  assert.equal(exhausted.usedQualityRetries, 2);
  assert.equal(exhausted.canQualityRetry, false);
  assert.match(exhausted.currentUsageLabel, /额外消耗 0 次/);
  assert.match(exhausted.qualityUsageLabel, /免费机会已用完/);
  assert.doesNotMatch(
    JSON.stringify({ paid, exhausted }),
    /(?:¥|\bCNY\b|元)\s*0/
  );
});

test('maps command failures to stable user-facing copy', () => {
  assert.match(copyCandidateActionErrorMessage('accept'), /刷新后确认/);
  assert.match(copyCandidateActionErrorMessage('paid-reroll'), /换一批/);
  assert.match(copyCandidateActionErrorMessage('quality-retry'), /免费机会/);
  assert.doesNotMatch(
    [
      copyCandidateActionErrorMessage('accept'),
      copyCandidateActionErrorMessage('paid-reroll'),
      copyCandidateActionErrorMessage('quality-retry'),
    ].join(' '),
    /(?:Job|Asset|JSON|QUALITY_RETRY_LIMIT_REACHED)/
  );
});

test('rejects incomplete or duplicate candidate indexes instead of guessing order', () => {
  const model = buildCopyCandidateSelectorModel({
    assets: [assets[0]!, assets[1]!, { ...assets[2]!, candidateIndex: 0 }],
    contents: [],
    job,
  });

  assert.equal(model.status, 'invalid');
  assert.deepEqual(model.candidates, []);
  assert.equal(model.canAccept, false);
  assert.equal(model.canPaidReroll, false);
  assert.equal(model.canQualityRetry, false);
});

test('builds one stable idempotency and submission key per click', () => {
  const first = createCopyCandidateCommand({
    action: 'quality-retry',
    clickToken: 'click-one',
    jobId: job.id,
  });
  const replay = createCopyCandidateCommand({
    action: 'quality-retry',
    clickToken: 'click-one',
    jobId: job.id,
  });
  const nextClick = createCopyCandidateCommand({
    action: 'quality-retry',
    clickToken: 'click-two',
    jobId: job.id,
  });
  const accept = createCopyCandidateCommand({
    action: 'accept',
    assetId: 'asset-b',
    clickToken: 'click-accept',
    jobId: job.id,
    visualAssetIds: ['image-2', 'image-1'],
    workId: job.workId,
  });

  assert.deepEqual(replay, first);
  assert.notEqual(nextClick.idempotencyKey, first.idempotencyKey);
  assert.equal(first.action, 'quality_retry_creative_job');
  assert.equal(first.payload.submissionKey, first.idempotencyKey);
  assert.equal(accept.action, 'adopt_into_content_package');
  assert.deepEqual(accept.payload, {
    copyCandidateAssetId: 'asset-b',
    visualAssetIds: ['image-2', 'image-1'],
    workId: job.workId,
  });
});

test('keeps visual selection ordered while merchants remove, restore, and move images', () => {
  assert.deepEqual(
    toggleOrderedVisualAsset(['image-1', 'image-2'], 'image-1'),
    ['image-2']
  );
  assert.deepEqual(toggleOrderedVisualAsset(['image-2'], 'image-1'), [
    'image-2',
    'image-1',
  ]);
  assert.deepEqual(
    moveOrderedVisualAsset(['image-2', 'image-1'], 'image-1', -1),
    ['image-1', 'image-2']
  );
  assert.deepEqual(
    moveOrderedVisualAsset(['image-2', 'image-1'], 'image-2', -1),
    ['image-2', 'image-1']
  );
});
