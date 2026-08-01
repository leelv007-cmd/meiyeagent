import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CreativeWorkbenchProjection,
  PublicContentPackage,
} from '@meiye/contracts';

import {
  buildLiveVideoWorksurface,
  buildNativeVideoWorksurface,
  contentPackageRefreshToken,
  factSourcesFromGroundingSnapshot,
  imageWorksurfaceFromContentPackage,
  latestContentPackageForWork,
  projectResultCenterLiveProjection,
  resultAdjustSourceForResult,
  resultHarnessStreamLifecycle,
  resultWorkflowIdForWork,
  resultContentPackageMutationFacts,
  resultWorkspaceKindForContentPackage,
  revisionTimelineFactsFromContentPackage,
  runDetailFactsFromLiveSelection,
} from './result-live-projection';
import { projectRevisionTimeline } from './result-revision-timeline-model';
import { projectResultRunDetail } from './result-run-detail-model';

test('note ContentPackage carrier keeps its image workspace after copy-only selection execution', () => {
  assert.equal(
    resultWorkspaceKindForContentPackage({
      contentPackage: {
        currentVersionId: 'version-note',
        kind: 'image_text',
        versions: [
          { id: 'version-note', orderedAssetIds: ['owned-note-cover'] },
        ],
      },
      projectedWorkspaceKind: 'copy',
    }),
    'image'
  );
  assert.equal(
    resultWorkspaceKindForContentPackage({
      contentPackage: {
        currentVersionId: 'version-copy',
        kind: 'image_text',
        versions: [{ id: 'version-copy', orderedAssetIds: [] }],
      },
      projectedWorkspaceKind: 'copy',
    }),
    'copy'
  );
});

test('projects only completed legacy or verifiable Composer adjustment sources', () => {
  assert.deepEqual(
    resultAdjustSourceForResult({
      contentPackage: undefined,
      job: { id: 'job-1', status: 'completed' },
      workId: 'work-1',
    }),
    { baseJobId: 'job-1', kind: 'legacy_job' }
  );

  const composerPackage = {
    currentVersionId: 'version-1',
    id: 'package-1',
    revision: 3,
    source: {
      creationExecutionSnapshot: {
        id: 'snapshot-task-1',
        revision: 1,
        schemaVersion: 'creation-execution-snapshot/v1',
      },
      workId: 'work-1',
      workflowId: 'task-1',
      workflowRevision: 1,
    },
  } as Pick<
    PublicContentPackage,
    'currentVersionId' | 'id' | 'revision' | 'source'
  >;
  assert.deepEqual(
    resultAdjustSourceForResult({
      contentPackage: composerPackage,
      job: { id: 'legacy-job-also-present', status: 'completed' },
      workId: 'work-1',
    }),
    {
      expectedPackageRevision: 3,
      kind: 'content_package_snapshot',
      packageId: 'package-1',
      snapshotId: 'snapshot-task-1',
      workflowId: 'task-1',
    }
  );

  // contentPackageSourceSchema makes the snapshot optional for historical
  // packages, so this is a production-producible negative fixture.
  assert.equal(
    resultAdjustSourceForResult({
      contentPackage: {
        ...composerPackage,
        source: { assetIds: [], workId: 'work-1' },
      },
      job: null,
      workId: 'work-1',
    }),
    null
  );

  assert.deepEqual(
    resultAdjustSourceForResult({
      contentPackage: {
        ...composerPackage,
        source: { assetIds: [], workId: 'work-1' },
      },
      job: { id: 'legacy-fallback', status: 'completed' },
      workId: 'work-1',
    }),
    { baseJobId: 'legacy-fallback', kind: 'legacy_job' }
  );
});

test('uses the newest same-Work ContentPackage instead of locking the original workflow package', () => {
  const packages = [
    {
      id: 'package-derived',
      source: { workId: 'work-video-target', workflowId: 'workflow-derived' },
    },
    {
      id: 'package-original',
      source: { workId: 'work-video-target', workflowId: 'workflow-original' },
    },
    {
      id: 'package-other',
      source: { workId: 'work-other', workflowId: 'workflow-other' },
    },
  ];

  assert.equal(
    latestContentPackageForWork(packages, 'work-video-target')?.id,
    'package-derived'
  );
});

test('resolves a workId-only Result reopen to the authoritative Harness workflow', () => {
  const packages = [
    {
      source: {
        workId: 'work-copy-target',
        workflowId: 'task-authoritative',
      },
    },
    {
      source: {
        workId: 'work-other',
        workflowId: 'task-other',
      },
    },
  ];

  assert.equal(
    resultWorkflowIdForWork(packages, 'work-copy-target'),
    'task-authoritative'
  );
  assert.equal(resultWorkflowIdForWork(undefined, 'work-copy-target'), '');
  assert.equal(resultWorkflowIdForWork([], 'work-copy-target'), '');
  assert.equal(
    resultWorkflowIdForWork(
      [
        {
          source: {
            workId: 'work-cached-route',
            workflowId: 'task-stale-cached-route',
          },
        },
      ],
      'work-copy-target'
    ),
    ''
  );
});

test('terminal Harness workflow state overrides stale running progress', () => {
  assert.deepEqual(
    resultHarnessStreamLifecycle({
      hasCanonicalVersion: false,
      latestProgressState: 'running',
      projectedProgressState: 'running',
      workflowState: 'success',
    }),
    {
      progressState: 'success',
      streamActive: false,
    }
  );
  assert.deepEqual(
    resultHarnessStreamLifecycle({
      hasCanonicalVersion: false,
      latestProgressState: 'running',
      projectedProgressState: 'running',
      workflowState: 'failed',
    }),
    {
      progressState: 'failed',
      streamActive: false,
    }
  );
});

test('terminal canonical projection overrides stale running progress', () => {
  for (const projectedProgressState of ['success', 'failed'] as const) {
    assert.deepEqual(
      resultHarnessStreamLifecycle({
        hasCanonicalVersion: false,
        latestProgressState: 'running',
        projectedProgressState,
        workflowState: undefined,
      }),
      {
        progressState: projectedProgressState,
        streamActive: false,
      }
    );
  }
});

test('non-terminal canonical projection stays active after a completed stage', () => {
  assert.deepEqual(
    resultHarnessStreamLifecycle({
      hasCanonicalVersion: false,
      latestProgressState: 'success',
      projectedProgressState: 'running',
      workflowState: undefined,
    }),
    {
      progressState: 'running',
      streamActive: true,
    }
  );
});

test('changes the package refresh token when an asynchronous video rerun arrives', () => {
  const baseline = contentPackageRefreshToken({
    id: 'package-original',
    revision: 1,
    updatedAt: '2026-07-22T00:00:00.000Z',
  });
  const rerun = contentPackageRefreshToken({
    id: 'package-derived',
    revision: 1,
    updatedAt: '2026-07-22T00:00:05.000Z',
  });

  assert.notEqual(rerun, baseline);
  assert.equal(contentPackageRefreshToken(undefined), null);
});

test('Harness package is adopted only after the canonical adoption command records the candidate', () => {
  const reviewReady = {
    currentVersionId: 'version-1',
    harnessSelection: { recommendedCandidateId: 'candidate-1' },
    status: 'review_ready' as const,
    variants: [],
  };
  assert.deepEqual(resultContentPackageMutationFacts(reviewReady), {
    hasAdoptedCandidate: false,
    hasDeliverableVariant: false,
  });

  assert.deepEqual(
    resultContentPackageMutationFacts({
      ...reviewReady,
      harnessSelection: {
        ...reviewReady.harnessSelection,
        adoptedCandidateId: 'candidate-1',
      },
      status: 'accepted',
    }),
    {
      hasAdoptedCandidate: true,
      hasDeliverableVariant: false,
    }
  );
});

test('empty variants never project a deliverable package', () => {
  assert.deepEqual(
    resultContentPackageMutationFacts({
      currentVersionId: 'version-1',
      status: 'accepted',
      variants: [],
    }),
    {
      hasAdoptedCandidate: true,
      hasDeliverableVariant: false,
    }
  );
});

const projection: CreativeWorkbenchProjection = {
  works: [
    {
      id: 'work-copy-old',
      workspaceId: 'ws-1',
      sessionId: 'session-1',
      intent: 'older copy',
      mode: 'direct',
      operation: 'copy.generate',
      sourceReferences: [],
      status: 'completed',
      currentJobId: 'job-copy-old',
      createdAt: '2026-07-20T08:00:00.000Z',
      updatedAt: '2026-07-20T08:10:00.000Z',
    },
    {
      id: 'work-video-target',
      workspaceId: 'ws-1',
      sessionId: 'session-1',
      intent: 'target video',
      mode: 'direct',
      operation: 'video.generate',
      sourceReferences: [],
      status: 'completed',
      currentJobId: 'job-video-current',
      createdAt: '2026-07-20T09:00:00.000Z',
      updatedAt: '2026-07-20T09:20:00.000Z',
    },
  ],
  jobs: [
    {
      id: 'job-copy-old',
      workspaceId: 'ws-1',
      workId: 'work-copy-old',
      status: 'completed',
      contract: {
        operation: 'copy.generate',
        catalogModelId: 'copy-model',
        catalogRevision: 'catalog-1',
        quoteRevision: 'quote-1',
        quoteAcceptedAt: '2026-07-20T08:00:00.000Z',
        outputLabel: '文案',
        estimatedAmount: 1,
        currency: 'CNY',
        outputCount: 1,
        dataClass: [],
        watermarkEnabled: false,
        aigcLabelEnabled: true,
      },
      submissionKey: 'submit-copy',
      outputAssetIds: ['asset-copy'],
      outputContentIds: [],
      groundingSnapshot: {
        capturedAt: '2026-07-20T08:00:00.000Z',
        store: {
          name: '测试门店',
          city: '上海',
          district: '静安区',
          address: '测试路 1 号',
          booking: '请提前预约',
          brandVoice: '真实克制',
          prohibitions: [],
          regulated: false,
          confirmedAt: '2026-07-20T08:00:00.000Z',
          projects: [
            {
              id: 'project-copy',
              name: '夏日猫眼美甲',
              price: 128,
              durationMinutes: 90,
            },
          ],
        },
        assets: [],
      },
      createdAt: '2026-07-20T08:00:00.000Z',
      updatedAt: '2026-07-20T08:10:00.000Z',
    },
    {
      id: 'job-video-stale',
      workspaceId: 'ws-1',
      workId: 'work-video-target',
      status: 'failed',
      contract: {
        operation: 'video.generate',
        catalogModelId: 'video-model',
        catalogRevision: 'catalog-1',
        quoteRevision: 'quote-1',
        quoteAcceptedAt: '2026-07-20T09:00:00.000Z',
        outputLabel: '视频',
        estimatedAmount: 8,
        currency: 'CNY',
        outputCount: 1,
        durationSeconds: 24,
        aspectRatio: '9:16',
        dataClass: [],
        watermarkEnabled: false,
        aigcLabelEnabled: true,
      },
      submissionKey: 'submit-video-stale',
      outputAssetIds: [],
      outputContentIds: [],
      createdAt: '2026-07-20T09:00:00.000Z',
      updatedAt: '2026-07-20T09:01:00.000Z',
    },
    {
      id: 'job-video-current',
      workspaceId: 'ws-1',
      workId: 'work-video-target',
      status: 'completed',
      contract: {
        operation: 'video.generate',
        catalogModelId: 'video-model',
        catalogRevision: 'catalog-1',
        quoteRevision: 'quote-1',
        quoteAcceptedAt: '2026-07-20T09:05:00.000Z',
        outputLabel: '视频',
        estimatedAmount: 8,
        currency: 'CNY',
        outputCount: 1,
        durationSeconds: 24,
        aspectRatio: '9:16',
        dataClass: [],
        watermarkEnabled: false,
        aigcLabelEnabled: true,
      },
      submissionKey: 'submit-video-current',
      outputAssetIds: ['asset-video'],
      outputContentIds: ['content-video'],
      recommendedAssetId: 'asset-video',
      createdAt: '2026-07-20T09:05:00.000Z',
      updatedAt: '2026-07-20T09:20:00.000Z',
    },
  ],
  assets: [
    {
      id: 'asset-copy',
      workspaceId: 'ws-1',
      workId: 'work-copy-old',
      jobId: 'job-copy-old',
      kind: 'text',
      title: '旧文案',
      body: '不得回退到这条最新结果',
      createdAt: '2026-07-20T08:10:00.000Z',
    },
    {
      id: 'asset-video',
      workspaceId: 'ws-1',
      workId: 'work-video-target',
      jobId: 'job-video-current',
      kind: 'video',
      title: '抖音项目成片',
      ownedAssetId: 'owned-video-1',
      objectKey: 'video/owned-video-1.mp4',
      contentType: 'video/mp4',
      createdAt: '2026-07-20T09:20:00.000Z',
    },
  ],
  contents: [
    {
      id: 'content-video',
      workspaceId: 'ws-1',
      workId: 'work-video-target',
      jobId: 'job-video-current',
      title: '已采用成片',
      body: '',
      assetIds: ['asset-video'],
      status: 'accepted',
      createdAt: '2026-07-20T09:21:00.000Z',
      acceptedAt: '2026-07-20T09:21:00.000Z',
    },
  ],
  events: [],
};

test('binds the exact route workId and its current job without latest fallback', () => {
  const result = projectResultCenterLiveProjection(
    projection,
    'work-video-target'
  );

  assert.equal(result.selected?.work.id, 'work-video-target');
  assert.equal(result.selected?.job?.id, 'job-video-current');
  assert.equal(result.selected?.workspaceKind, 'video');
  assert.equal(result.selected?.progressState, 'success');
  assert.deepEqual(
    result.selected?.assets.map((asset) => asset.id),
    ['asset-video']
  );
  assert.equal(result.selected?.hasAdoptedCandidate, true);
  assert.equal(result.resolverWorks.length, 2);
});

test('returns no selected work for an unknown id instead of choosing another work', () => {
  const result = projectResultCenterLiveProjection(projection, 'missing-work');
  assert.equal(result.selected, null);
  assert.ok(
    result.resolverWorks.some((work) => work.workId === 'work-copy-old')
  );
});

test('maps current job lifecycle to honest shell progress', () => {
  const running = structuredClone(projection);
  running.works[1]!.status = 'running';
  running.jobs[2]!.status = 'running';
  const result = projectResultCenterLiveProjection(
    running,
    'work-video-target'
  );
  assert.equal(result.selected?.progressState, 'running');
  assert.equal(result.selected?.hasUsableCandidate, true);
});

test('projects copy facts from the exact recommended/current job asset', () => {
  const result = projectResultCenterLiveProjection(projection, 'work-copy-old');
  assert.equal(result.selected?.workspaceKind, 'copy');
  assert.equal(result.selected?.copyWorksurface?.document.title, '旧文案');
  assert.equal(
    result.selected?.copyWorksurface?.document.body,
    '不得回退到这条最新结果'
  );
  assert.equal(result.selected?.copyWorksurface?.lifecycle, 'candidate');
  assert.deepEqual(result.selected?.copyWorksurface?.factSources, [
    {
      id: 'grounding:job-copy-old:project:project-copy:price',
      kind: 'price',
      label: '夏日猫眼美甲价格',
      summary: '128 元 · 测试门店已确认',
      status: 'confirmed',
      sourceRef: 'grounding:job-copy-old:project:project-copy',
    },
    {
      id: 'grounding:job-copy-old:identity:store',
      kind: 'identity',
      label: '门店身份',
      summary: '测试门店 · 上海静安区',
      status: 'confirmed',
      sourceRef: 'grounding:job-copy-old:store',
    },
  ]);
  assert.equal(result.selected?.imageWorksurface, undefined);
});

test('revision timeline facts project ContentPackage versions without inventing a ledger', () => {
  const facts = revisionTimelineFactsFromContentPackage({
    currentVersionId: 'ver-2',
    versions: [
      {
        id: 'ver-1',
        title: '初稿',
        body: 'body-1',
        createdAt: '2026-07-20T08:00:00.000Z',
        orderedAssetIds: [],
        topics: [],
        source: 'ai_generated',
      },
      {
        id: 'ver-2',
        title: '手改',
        body: 'body-2',
        createdAt: '2026-07-20T09:00:00.000Z',
        orderedAssetIds: ['asset-1'],
        topics: [],
        source: 'merchant_edited',
        derivedFromVersionId: 'ver-1',
        createdBy: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      },
    ],
  });
  const view = projectRevisionTimeline(facts);
  assert.equal(view.entries.length, 2);
  assert.equal(view.entries[0]?.isCurrent, true);
  assert.equal(view.entries[0]?.derivedFromLabel, '基于「初稿」');
  // createdBy UUID must never become the operator label.
  assert.equal(view.entries[0]?.operatorLabel, '本店同事');
  assert.doesNotMatch(JSON.stringify(view), /a1b2c3d4-e5f6/u);
});

test('revision timeline facts mark and restore only the selected platform history', () => {
  const facts = revisionTimelineFactsFromContentPackage({
    currentVersionId: 'xiaohongshu-v2',
    versions: [
      {
        body: '小红书初稿',
        createdAt: '2026-07-20T08:00:00.000Z',
        id: 'xiaohongshu-v1',
        orderedAssetIds: ['xhs-image-1'],
        title: '小红书初稿',
        topics: ['美甲'],
      },
      {
        body: '小红书手改稿',
        createdAt: '2026-07-20T09:00:00.000Z',
        derivedFromVersionId: 'xiaohongshu-v1',
        id: 'xiaohongshu-v2',
        orderedAssetIds: ['xhs-image-2'],
        source: 'merchant_edited',
        title: '小红书手改稿',
        topics: ['美甲'],
      },
    ],
  });
  const view = projectRevisionTimeline(facts);

  assert.deepEqual(
    view.entries.map(({ versionId }) => versionId),
    ['xiaohongshu-v2', 'xiaohongshu-v1']
  );
  assert.equal(view.entries[0]?.isCurrent, true);
  assert.equal(
    view.entries[1]?.recoverAction?.targetVersionId,
    'xiaohongshu-v1'
  );
  assert.doesNotMatch(
    JSON.stringify(view),
    /package-v|douyin-v|video-account-v/u
  );
});

test('run detail facts strip provider identity and keep merchant language', () => {
  const live = projectResultCenterLiveProjection(projection, 'work-copy-old');
  const job = live.selected!.job!;
  job.failureCode = 'TIMEOUT';
  job.productUsageQuantity = 1;
  job.executionProvenance = {
    actualCatalogModelId: 'catalog-secret',
    modelDisplayName: '门店文案助手',
    providerModel: 'openai/gpt-4o',
    apiCounterparty: 'sub2api',
  };
  const facts = runDetailFactsFromLiveSelection({
    workId: 'work-copy-old',
    phase: 'failed',
    progressState: 'failed',
    job,
    workspaceKind: 'copy',
  });
  const view = projectResultRunDetail(facts);
  assert.equal(view.modelSummary, '使用模型：门店文案助手');
  assert.equal(view.failureSummary, '生成超时，可以重试。');
  assert.doesNotMatch(JSON.stringify(view), /openai|sub2api|catalog-secret/iu);
  assert.doesNotMatch(JSON.stringify(view), /work-copy-old/u);
});

test('fact sources only include referenced materials and rights for current revision', () => {
  const live = projectResultCenterLiveProjection(projection, 'work-copy-old');
  const job = live.selected!.job!;
  job.groundingSnapshot = {
    ...job.groundingSnapshot!,
    assets: [
      {
        id: 'mat-used',
        sourceType: 'real',
        category: 'store',
        tags: [],
        consentScope: 'public_marketing',
        containsPerson: false,
        containsSensitiveData: false,
        minorStatus: 'none',
        authorizationStatus: 'authorized',
        rightsEvidenceRecorded: true,
      },
      {
        id: 'mat-unused',
        sourceType: 'real',
        category: 'price_list',
        tags: [],
        consentScope: 'internal_only',
        containsPerson: false,
        containsSensitiveData: false,
        minorStatus: 'none',
        authorizationStatus: 'authorized',
        rightsEvidenceRecorded: true,
      },
    ],
  };
  const items = factSourcesFromGroundingSnapshot(live.selected!.work, job, {
    referencedAssetIds: ['mat-used'],
    contentPackageRights: { state: 'authorized' },
  });
  assert.ok(
    items.some(
      (item) => item.kind === 'material' && item.id.includes('mat-used')
    )
  );
  assert.equal(
    items.some((item) => item.id.includes('mat-unused')),
    false
  );
  assert.ok(items.some((item) => item.kind === 'rights'));
  assert.ok(items.some((item) => item.kind === 'identity'));
});

test('projects persisted image candidates without inventing adoption', () => {
  const image = structuredClone(projection);
  image.works[0]!.operation = 'image.generate';
  image.jobs[0]!.contract.operation = 'image.generate';
  image.assets[0] = {
    ...image.assets[0]!,
    kind: 'image',
    ownedAssetId: 'owned-image-1',
    objectKey: 'images/owned-image-1.png',
    contentType: 'image/png',
  };
  const result = projectResultCenterLiveProjection(image, 'work-copy-old');
  assert.equal(result.selected?.workspaceKind, 'image');
  assert.equal(result.selected?.imageWorksurface?.lifecycle, 'candidate');
  assert.deepEqual(result.selected?.imageWorksurface?.candidates, [
    {
      assetId: 'asset-copy',
      previewUrl: '/api/core/p1/assets?objectKey=images%2Fowned-image-1.png',
      persisted: true,
      rightsOk: true,
      generationOk: true,
      recipeOrder: 1,
    },
  ]);
});

test('joins only the public video workflow with the exact canonical asset', () => {
  const result = projectResultCenterLiveProjection(
    projection,
    'work-video-target'
  );
  assert.ok(result.selected);
  const state = buildLiveVideoWorksurface(result.selected!, {
    workflowId: 'workflow-public-1',
    workId: 'work-video-target',
    status: 'completed',
    storyboardVersion: 2,
    storyboardRevision: 'storyboard-2',
    catalogModelId: 'video-model',
    confirmed: true,
    shots: [],
    revision: 4,
    updatedAt: '2026-07-20T09:20:00.000Z',
  });

  assert.equal(state?.workflowId, 'workflow-public-1');
  assert.equal(state?.composedCandidate?.assetId, 'asset-video');
  assert.equal(
    state?.composedCandidate?.playableUrl,
    '/api/core/p1/assets?objectKey=video%2Fowned-video-1.mp4'
  );
  assert.equal(state?.loopPhase, 'adopted');
});

test('projects a model-native video from the canonical ContentPackage without a legacy workflow', () => {
  const result = projectResultCenterLiveProjection(
    projection,
    'work-video-target'
  );
  assert.ok(result.selected);
  const contentPackage = {
    id: 'package-video-native',
    kind: 'video',
    currentVersionId: 'version-video-native',
    revision: 1,
    status: 'review_ready',
    updatedAt: '2026-07-25T09:00:00.000Z',
    versions: [
      {
        id: 'version-video-native',
        body: '门店项目成片分镜',
        orderedAssetIds: ['asset-video-native'],
      },
    ],
    generated: {
      ownedAssets: [
        {
          id: 'asset-video-native',
          contentType: 'video/mp4',
          objectKey: 'owned/video-native.mp4',
        },
      ],
      childRuns: [
        {
          actualCatalogModelId: 'seedance-2',
          assetIds: ['asset-video-native'],
          runId: 'model-job-video-native',
        },
      ],
    },
  } as unknown as PublicContentPackage;

  const state = buildNativeVideoWorksurface(result.selected!, contentPackage);

  assert.equal(state?.workflowId, 'model-job-video-native');
  assert.equal(state?.storyboard.length, 1);
  assert.equal(state?.composedCandidate?.assetId, 'asset-video-native');
  assert.equal(
    state?.composedCandidate?.playableUrl,
    '/api/core/p1/assets?objectKey=owned%2Fvideo-native.mp4'
  );
  assert.equal(state?.loopPhase, 'candidate_ready');
});

test('refuses a public video workflow that belongs to another work', () => {
  const result = projectResultCenterLiveProjection(
    projection,
    'work-video-target'
  );
  assert.ok(result.selected);
  const state = buildLiveVideoWorksurface(result.selected!, {
    workflowId: 'workflow-other',
    workId: 'work-other',
    status: 'completed',
    storyboardVersion: 1,
    storyboardRevision: 'storyboard-other',
    catalogModelId: 'video-model',
    confirmed: true,
    shots: [],
    revision: 1,
    updatedAt: '2026-07-20T09:20:00.000Z',
  });
  assert.equal(state, undefined);
});

test('a delivered 图文 package carries the worksurface the legacy projection cannot', () => {
  const facts = imageWorksurfaceFromContentPackage({
    adopted: true,
    generated: {
      assetIds: ['asset-page-1', 'asset-page-2'],
      ownedAssets: [
        {
          id: 'owned-2',
          objectKey: 'owned/page 2.png',
          sourceAssetId: 'asset-page-2',
        },
        { id: 'asset-page-1', objectKey: 'owned/page-1.png' },
      ],
    },
    version: {
      id: 'version-1',
      orderedAssetIds: ['asset-page-1', 'asset-page-2'],
    },
    workId: 'work-note',
  });

  assert.equal(facts?.outputType, 'ordered_image_set');
  assert.equal(facts?.slot, 'gallery');
  assert.equal(facts?.lifecycle, 'adopted');
  assert.equal(facts?.baseRevisionId, 'version-1');
  assert.equal(facts?.focusedAssetId, 'asset-page-1');
  assert.equal(facts?.mediaVersionReady, true);
  assert.deepEqual(facts?.adoptedOrderedAssetIds, [
    'asset-page-1',
    'asset-page-2',
  ]);
  // Ordered by the version, not by the order the owned assets happen to arrive
  // in, and matched by `id` as well as `sourceAssetId`.
  assert.deepEqual(
    facts?.candidates.map((candidate) => candidate.previewUrl),
    [
      '/api/core/p1/assets?objectKey=owned%2Fpage-1.png',
      '/api/core/p1/assets?objectKey=owned%2Fpage%202.png',
    ]
  );
  assert.deepEqual(
    facts?.candidates.map((candidate) => candidate.recipeOrder),
    [1, 2]
  );
});

test('an unadopted 图文 package is a candidate, and one with no images stays empty', () => {
  const candidate = imageWorksurfaceFromContentPackage({
    adopted: false,
    generated: { assetIds: ['asset-page-1'] },
    version: { id: 'version-1', orderedAssetIds: [] },
    workId: 'work-note',
  });

  // Falls back to the generated ids when the version adopted none yet.
  assert.equal(candidate?.lifecycle, 'candidate');
  assert.equal(candidate?.outputType, 'single_image');
  assert.equal(candidate?.slot, 'standalone');
  assert.deepEqual(candidate?.adoptedOrderedAssetIds, []);
  // No owned asset yet: the card must not claim a durable media version.
  assert.equal(candidate?.mediaVersionReady, false);
  assert.equal(candidate?.candidates[0]?.persisted, false);
  assert.equal(candidate?.candidates[0]?.previewUrl, undefined);

  assert.equal(
    imageWorksurfaceFromContentPackage({
      adopted: true,
      generated: { assetIds: [] },
      version: { id: 'version-1', orderedAssetIds: [] },
      workId: 'work-note',
    }),
    undefined
  );
});
