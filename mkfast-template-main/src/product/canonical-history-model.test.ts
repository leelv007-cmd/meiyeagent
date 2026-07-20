import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { officialCanvasWorkName } from '@meiye/contracts';
import {
  canonicalAssetItems,
  canonicalHistoryWithComposedVideos,
  canonicalHistoryItems,
  composedVideoCanonicalAssets,
  queryCanonicalHistory,
  type RawCanonicalHistory,
} from './canonical-history-model';
import type { ComposedVideoTaskEnvelope } from './async-task-center-model';
import { overwriteGetLocale } from '../locale/paraglide/runtime';

const history: RawCanonicalHistory = {
  assets: [
    {
      createdAt: '2026-07-12T10:03:00.000Z',
      id: 'creative-asset-a',
      jobId: 'job-a',
      kind: 'image',
      ownedAssetId: 'owned-asset-a',
      title: '猫眼项目主视觉',
      workId: 'creative-work-a',
      workspaceId: 'workspace-a',
    },
  ],
  canvasWorks: [
    {
      aigcLabelEnabled: true,
      brandWatermarkEnabled: false,
      createdAt: '2026-07-12T09:00:00.000Z',
      currentRevisionId: 'revision-a',
      id: 'canvas-work-a',
      name: '价格卡画布',
      revisions: [],
      updatedAt: '2026-07-12T10:04:00.000Z',
    },
  ],
  contents: [],
  creativeWorks: [
    {
      createdAt: '2026-07-12T10:01:00.000Z',
      id: 'creative-work-a',
      intent: '猫眼项目内容',
      mode: 'agent',
      sessionId: 'session-a',
      sourceReferences: [],
      status: 'completed',
      updatedAt: '2026-07-12T10:03:00.000Z',
      workspaceId: 'workspace-a',
    },
  ],
  exportReceipts: [],
  imageJobs: [],
  jobs: [],
  sessions: [
    {
      createdAt: '2026-07-12T10:01:00.000Z',
      id: 'session-a',
      updatedAt: '2026-07-12T10:03:00.000Z',
      workIds: ['creative-work-a'],
    },
  ],
  tasks: [],
};

function completedVideoEnvelope(input: {
  assetId: string;
  objectKey: string;
  storyboardVersion: number;
  updatedAt: string;
  workflowId: string;
}): ComposedVideoTaskEnvelope {
  return {
    job: {
      createdAt: '2026-07-12T10:04:00.000Z',
      jobId: `tracer-${input.workflowId}`,
      status: 'completed',
      updatedAt: input.updatedAt,
    },
    workflow: {
      actorId: 'owner-a',
      aigcLabelEnabled: true,
      catalogModelId: 'seedance-2',
      composedAsset: {
        contentType: 'video/mp4',
        id: input.assetId,
        objectKey: input.objectKey,
        sha256: `sha-${input.assetId}`,
        technicalValidation: { playable: true },
      },
      confirmed: true,
      createdAt: '2026-07-12T10:04:00.000Z',
      id: input.workflowId,
      revision: input.storyboardVersion,
      shots: [],
      status: 'completed',
      storyboardRevision: `storyboard-${input.storyboardVersion}`,
      storyboardVersion: input.storyboardVersion,
      updatedAt: input.updatedAt,
      workId: 'creative-work-a',
      workspaceId: 'workspace-a',
    },
  };
}

describe('canonical history projection', () => {
  it('projects only canonical objects and sorts recent activity', () => {
    const items = canonicalHistoryItems(history);

    assert.equal(items[0]?.id, 'canvas-work-a');
    assert.deepEqual(
      items.filter((item) => item.kind === 'work').map((item) => item.id),
      ['canvas-work-a', 'creative-work-a']
    );
    assert.equal(
      items.find((item) => item.id === 'session-a')?.href,
      '/dashboard/sessions/session-a'
    );
  });

  it('keeps legacy content on the read-only query address', () => {
    const items = canonicalHistoryItems({
      ...history,
      contents: [
        {
          acceptedAt: '2026-07-12T10:05:00.000Z',
          assetIds: [],
          body: '历史正文',
          createdAt: '2026-07-12T10:04:00.000Z',
          id: 'legacy-content-a',
          jobId: 'job-a',
          status: 'accepted',
          title: '历史标题',
          workId: 'creative-work-a',
          workspaceId: 'workspace-a',
        },
      ],
    });

    assert.equal(
      items.find((item) => item.id === 'legacy-content-a')?.href,
      '/dashboard/content?contentId=legacy-content-a'
    );
  });

  it('localizes only reserved canvas names and preserves user-authored names', () => {
    overwriteGetLocale(() => 'en');
    try {
      const items = canonicalHistoryItems({
        ...history,
        canvasWorks: [
          { ...history.canvasWorks[0]!, name: '我的作品' },
          {
            ...history.canvasWorks[0]!,
            id: 'official-canvas-work',
            name: officialCanvasWorkName('price_card'),
          },
        ],
      });
      const userWork = items.find((item) => item.id === 'canvas-work-a');
      const officialWork = items.find(
        (item) => item.id === 'official-canvas-work'
      );

      assert.equal(userWork?.title, '我的作品');
      assert.equal(officialWork?.title, 'Price card work');
    } finally {
      overwriteGetLocale(() => 'zh');
    }

    const userWork = canonicalHistoryItems({
      ...history,
      canvasWorks: [{ ...history.canvasWorks[0]!, name: 'My best work' }],
    }).find((item) => item.id === 'canvas-work-a');
    assert.equal(userWork?.title, 'My best work');
  });

  it('uses a named preset title instead of its internal execution intent', () => {
    const internalIntent = '内部命名预设执行摘要';
    const namedPreset = {
      id: 'template-a',
      internalIntent,
      name: '到店套餐说明',
    };
    const items = canonicalHistoryItems(
      {
        ...history,
        creativeWorks: [
          {
            ...history.creativeWorks[0]!,
            intent: internalIntent,
            sourceReferences: [{ id: namedPreset.id, kind: 'template' }],
          },
        ],
      },
      [],
      [namedPreset],
      true
    );

    assert.equal(
      items.find((item) => item.id === 'creative-work-a')?.title,
      namedPreset.name
    );
  });

  it('does not show a persisted media asset twice', () => {
    const assets = canonicalAssetItems(history, [
      {
        aigcStatus: 'ai_generated',
        authorizationStatus: 'authorized',
        consentScope: 'public_marketing',
        containsPerson: false,
        containsSensitiveData: false,
        createdAt: '2026-07-12T10:03:00.000Z',
        id: 'owned-asset-a',
        mediaType: 'image',
        minorStatus: 'none',
        objectKey: 'workspace/asset-a.png',
        replacementRequired: false,
        rightsOwner: 'workspace-a',
        sourceType: 'ai_generated',
        tags: ['猫眼'],
      },
    ]);

    assert.deepEqual(
      assets.map((item) => item.id),
      ['creative-asset-a']
    );
  });

  it('localizes uploaded Asset facts instead of exposing raw enum fallbacks', () => {
    overwriteGetLocale(() => 'en');
    const items = canonicalAssetItems(history, [
      {
        aigcStatus: 'not_ai',
        authorizationStatus: 'authorized',
        consentScope: 'public_marketing',
        containsPerson: false,
        containsSensitiveData: false,
        createdAt: '2026-07-12T10:06:00.000Z',
        id: 'uploaded-asset-no-tags',
        mediaType: 'video',
        minorStatus: 'none',
        objectKey: 'workspace/upload.mp4',
        replacementRequired: false,
        rightsOwner: 'workspace-a',
        sourceType: 'real',
        tags: [],
      },
    ]);
    const uploaded = items.find((item) => item.id === 'uploaded-asset-no-tags');

    assert.equal(uploaded?.detail, 'Real asset \u00b7 Pending confirmation');
    assert.equal(uploaded?.title, 'Video material');
    assert.doesNotMatch(
      `${uploaded?.detail} ${uploaded?.title}`,
      /real|authorized|video Asset/u
    );

    overwriteGetLocale(() => 'zh');
  });

  it('projects readable job facts without exposing operation or model identifiers', () => {
    const items = canonicalHistoryItems({
      ...history,
      imageJobs: [
        {
          actualModelId: 'recorded-private-image-model',
          createdAt: '2026-07-12T10:02:00.000Z',
          id: 'image-job-a',
          origin: {
            id: 'layout-work-a',
            kind: 'layout_work',
            revisionId: 'layout-revision-a',
          },
          requestedModelId: 'internal-requested-image-model',
          status: 'completed',
          updatedAt: '2026-07-12T10:03:00.000Z',
        },
        {
          actualModelId: 'recorded-private-image-model',
          createdAt: '2026-07-12T10:02:30.000Z',
          id: 'image-job-advanced',
          origin: {
            id: 'advanced-canvas-a',
            kind: 'advanced_canvas',
            revisionId: 'advanced-revision-a',
          },
          requestedModelId: 'internal-requested-image-model',
          status: 'completed',
          updatedAt: '2026-07-12T10:03:30.000Z',
        },
      ],
      jobs: [
        {
          contract: {
            aigcLabelEnabled: true,
            catalogModelId: 'internal-copy-model',
            catalogRevision: 'catalog-a',
            currency: 'CNY',
            dataClass: [],
            estimatedAmount: 1,
            operation: 'copy.generate',
            outputCount: 3,
            outputLabel: '3 条内容候选',
            quoteAcceptedAt: '2026-07-12T10:02:00.000Z',
            quoteRevision: 'quote-a',
            watermarkEnabled: false,
          },
          createdAt: '2026-07-12T10:02:00.000Z',
          id: 'copy-job-a',
          outputAssetIds: [],
          outputContentIds: [],
          status: 'completed',
          submissionKey: 'submission-a',
          updatedAt: '2026-07-12T10:03:00.000Z',
          workId: 'creative-work-a',
          workspaceId: 'workspace-a',
        },
      ],
    });
    const visible = items
      .filter((item) => item.kind === 'job')
      .map((item) => `${item.title} ${item.detail}`)
      .join(' ');

    assert.doesNotMatch(
      visible,
      /copy\.generate|recorded-private|internal-requested|internal-copy/u
    );
    assert.match(visible, /画布图片生成/u);
    assert.equal(
      items.filter((item) => item.id.startsWith('image-job-')).length,
      2
    );
  });

  it('uses the authorized proxy for each media source and keeps one Asset identity', () => {
    const productAssets = [
      {
        aigcStatus: 'ai_generated' as const,
        authorizationStatus: 'authorized' as const,
        consentScope: 'public_marketing' as const,
        containsPerson: false,
        containsSensitiveData: false,
        createdAt: '2026-07-12T10:03:00.000Z',
        id: 'owned-asset-a',
        mediaType: 'image' as const,
        minorStatus: 'none' as const,
        objectKey: 'workspace/a b&?.png',
        replacementRequired: false,
        rightsOwner: 'workspace-a',
        sourceType: 'ai_generated' as const,
        tags: ['猫眼'],
      },
      {
        aigcStatus: 'not_ai' as const,
        authorizationStatus: 'authorized' as const,
        consentScope: 'public_marketing' as const,
        containsPerson: false,
        containsSensitiveData: false,
        createdAt: '2026-07-12T10:05:00.000Z',
        id: 'uploaded-asset-b',
        mediaType: 'video' as const,
        minorStatus: 'none' as const,
        objectKey: 'workspace/upload b&?.mp4',
        replacementRequired: false,
        rightsOwner: 'workspace-a',
        sourceType: 'real' as const,
        tags: ['门店实拍'],
      },
    ];
    const mediaHistory: RawCanonicalHistory = {
      ...history,
      assets: [
        {
          ...history.assets[0]!,
          contentType: 'image/png',
          objectKey: 'workspace/a b&?.png',
        },
      ],
      contents: [
        {
          acceptedAt: '2026-07-12T10:04:00.000Z',
          assetIds: ['creative-asset-a'],
          body: '正文',
          createdAt: '2026-07-12T10:04:00.000Z',
          id: 'content-a',
          jobId: 'job-a',
          status: 'accepted',
          title: '猫眼内容',
          workId: 'creative-work-a',
          workspaceId: 'workspace-a',
        },
      ],
      jobs: [
        {
          contract: {
            aigcLabelEnabled: true,
            catalogModelId: 'model-a',
            catalogRevision: 'catalog-a',
            currency: 'CNY',
            dataClass: [],
            estimatedAmount: 1,
            operation: 'image.generate',
            outputCount: 1,
            outputLabel: '猫眼主视觉',
            quoteAcceptedAt: '2026-07-12T10:02:00.000Z',
            quoteRevision: 'quote-a',
            watermarkEnabled: false,
          },
          createdAt: '2026-07-12T10:02:00.000Z',
          id: 'job-a',
          outputAssetIds: ['owned-asset-a'],
          outputContentIds: ['content-a'],
          status: 'completed',
          submissionKey: 'submission-a',
          updatedAt: '2026-07-12T10:04:00.000Z',
          workId: 'creative-work-a',
          workspaceId: 'workspace-a',
        },
      ],
    };

    const items = canonicalHistoryItems(mediaHistory, productAssets);
    const creativeAsset = items.find((item) => item.id === 'creative-asset-a');
    const content = items.find((item) => item.id === 'content-a');
    const job = items.find((item) => item.id === 'job-a');
    const standaloneUpload = canonicalAssetItems(
      mediaHistory,
      productAssets
    ).find((item) => item.id === 'uploaded-asset-b');

    assert.equal(creativeAsset?.media?.[0]?.assetId, 'creative-asset-a');
    assert.equal(
      creativeAsset?.media?.[0]?.src,
      '/api/core/p1/assets?objectKey=workspace%2Fa%20b%26%3F.png'
    );
    assert.equal(content?.media?.[0], creativeAsset?.media?.[0]);
    assert.equal(job?.media?.[0]?.assetId, 'creative-asset-a');
    assert.equal(
      standaloneUpload?.media?.[0]?.src,
      '/api/storage/file?key=workspace%2Fupload%20b%26%3F.mp4'
    );
  });

  it('does not manufacture a thumbnail for text or missing media receipts', () => {
    const items = canonicalHistoryItems({
      ...history,
      assets: [
        {
          ...history.assets[0]!,
          body: '只有文字',
          kind: 'text',
        },
      ],
    });

    assert.equal(
      items.find((item) => item.id === 'creative-asset-a')?.media,
      undefined
    );
  });

  it('projects only completed playable composed videos with their durable Asset identity', () => {
    const completed = completedVideoEnvelope({
      assetId: 'composed-asset-v1',
      objectKey: 'workspace-a/composed/final v1.mp4',
      storyboardVersion: 1,
      updatedAt: '2026-07-12T10:05:00.000Z',
      workflowId: 'workflow-raw-v1',
    });
    const running: ComposedVideoTaskEnvelope = {
      ...completed,
      workflow: {
        ...completed.workflow,
        composedAsset: undefined,
        id: 'workflow-running',
        status: 'running',
      },
    };
    const unplayable: ComposedVideoTaskEnvelope = {
      ...completed,
      workflow: {
        ...completed.workflow,
        composedAsset: {
          ...completed.workflow.composedAsset!,
          id: 'composed-asset-unplayable',
          technicalValidation: { playable: false },
        },
        id: 'workflow-unplayable',
      },
    };
    const completedWithLaggingTracer: ComposedVideoTaskEnvelope = {
      ...completed,
      job: { ...completed.job!, status: 'running' },
    };

    const assets = composedVideoCanonicalAssets([
      running,
      unplayable,
      completedWithLaggingTracer,
      completed,
    ]);

    assert.deepEqual(
      assets.map((asset) => asset.id),
      ['composed-asset-v1']
    );
    assert.equal(assets[0]?.ownedAssetId, 'composed-asset-v1');
    assert.equal(assets[0]?.workId, 'creative-work-a');
    assert.doesNotMatch(assets[0]?.title ?? '', /workflow-raw-v1|tracer-/u);
  });

  it('keeps immutable composed video versions in Work history and reuses one authorized media projection', () => {
    const projected = canonicalHistoryWithComposedVideos(history, [
      completedVideoEnvelope({
        assetId: 'composed-asset-v2',
        objectKey: 'workspace-a/composed/final v2.mp4',
        storyboardVersion: 2,
        updatedAt: '2026-07-12T10:06:00.000Z',
        workflowId: 'workflow-raw-v2',
      }),
      completedVideoEnvelope({
        assetId: 'composed-asset-v1',
        objectKey: 'workspace-a/composed/final v1.mp4',
        storyboardVersion: 1,
        updatedAt: '2026-07-12T10:05:00.000Z',
        workflowId: 'workflow-raw-v1',
      }),
    ]);
    const items = canonicalHistoryItems(projected);
    const work = items.find((item) => item.id === 'creative-work-a');
    const versionOne = items.find((item) => item.id === 'composed-asset-v1');
    const versionTwo = items.find((item) => item.id === 'composed-asset-v2');

    assert.deepEqual(
      work?.media?.map((media) => media.assetId),
      ['composed-asset-v2', 'composed-asset-v1']
    );
    assert.equal(
      versionOne?.media?.[0]?.src,
      '/api/core/p1/assets?objectKey=workspace-a%2Fcomposed%2Ffinal%20v1.mp4'
    );
    assert.equal(
      versionTwo?.media?.[0],
      work?.media?.find((media) => media.assetId === 'composed-asset-v2')
    );
    assert.equal(
      versionTwo?.href,
      '/dashboard/assets/composed-asset-v2?from=assets'
    );
    assert.doesNotMatch(
      `${versionOne?.title} ${versionOne?.detail}`,
      /workflow-raw|tracer-|workspace-a\/composed/u
    );
    assert.deepEqual(
      history.assets.map((asset) => asset.id),
      ['creative-asset-a']
    );
  });

  it('does not duplicate a composed receipt that already has a canonical Asset projection', () => {
    const projected = canonicalHistoryWithComposedVideos(
      {
        ...history,
        assets: [
          {
            ...history.assets[0]!,
            id: 'creative-video-a',
            kind: 'video',
            ownedAssetId: 'composed-asset-v1',
          },
        ],
      },
      [
        completedVideoEnvelope({
          assetId: 'composed-asset-v1',
          objectKey: 'workspace-a/composed/final v1.mp4',
          storyboardVersion: 1,
          updatedAt: '2026-07-12T10:05:00.000Z',
          workflowId: 'workflow-raw-v1',
        }),
      ]
    );

    assert.deepEqual(
      projected.assets.map((asset) => asset.id),
      ['creative-video-a']
    );
  });

  it('searches the same projection and returns an honest empty result', () => {
    const items = canonicalHistoryItems(history);

    assert.deepEqual(
      queryCanonicalHistory(items, '价格卡').map((item) => item.id),
      ['canvas-work-a']
    );
    assert.deepEqual(queryCanonicalHistory(items, '瑜伽'), []);
  });
});
