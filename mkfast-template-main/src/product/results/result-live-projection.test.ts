import assert from 'node:assert/strict';
import test from 'node:test';

import type { CreativeWorkbenchProjection } from '@meiye/contracts';

import {
  buildLiveVideoWorksurface,
  contentPackageRefreshToken,
  latestContentPackageForWork,
  projectResultCenterLiveProjection,
} from './result-live-projection';

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
  ]);
  assert.equal(result.selected?.imageWorksurface, undefined);
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
