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
import type { VideoWorkflowPublicProjection } from '@meiye/contracts';
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

function publicVideoWorkflow(input: {
  status?: VideoWorkflowPublicProjection['status'];
  storyboardVersion?: number;
  updatedAt?: string;
  workflowId: string;
  workId?: string;
}): VideoWorkflowPublicProjection {
  return {
    catalogModelId: 'seedance-2',
    confirmed: input.status !== 'draft',
    revision: input.storyboardVersion ?? 1,
    shots: [],
    status: input.status ?? 'completed',
    storyboardRevision: `storyboard-${input.storyboardVersion ?? 1}`,
    storyboardVersion: input.storyboardVersion ?? 1,
    updatedAt: input.updatedAt ?? '2026-07-12T10:05:00.000Z',
    workId: input.workId ?? 'creative-work-a',
    workflowId: input.workflowId,
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

  it('keeps recorded work intent after hidden-prompt preset retirement', () => {
    const legacyGeneratedPrompt = '内部命名预设执行摘要';
    const namedPreset = {
      id: 'template-a',
      name: '到店套餐说明',
    };
    const items = canonicalHistoryItems(
      {
        ...history,
        creativeWorks: [
          {
            ...history.creativeWorks[0]!,
            intent: legacyGeneratedPrompt,
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
      legacyGeneratedPrompt
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

  it('public video_workflows list does not manufacture composed media assets', () => {
    const assets = composedVideoCanonicalAssets([
      publicVideoWorkflow({
        status: 'running',
        workflowId: 'workflow-running',
      }),
      publicVideoWorkflow({
        status: 'completed',
        storyboardVersion: 1,
        updatedAt: '2026-07-12T10:05:00.000Z',
        workflowId: 'workflow-raw-v1',
      }),
      publicVideoWorkflow({
        status: 'failed',
        workflowId: 'workflow-failed',
      }),
    ]);

    // Owned assets / Result Center remain the media source of truth.
    assert.deepEqual(assets, []);
  });

  it('canonical history is unchanged when only public video projections are available', () => {
    const projected = canonicalHistoryWithComposedVideos(history, [
      publicVideoWorkflow({
        storyboardVersion: 2,
        updatedAt: '2026-07-12T10:06:00.000Z',
        workflowId: 'workflow-raw-v2',
      }),
      publicVideoWorkflow({
        storyboardVersion: 1,
        updatedAt: '2026-07-12T10:05:00.000Z',
        workflowId: 'workflow-raw-v1',
      }),
    ]);

    assert.equal(projected, history);
    assert.deepEqual(
      projected.assets.map((asset) => asset.id),
      ['creative-asset-a']
    );
    assert.doesNotMatch(
      projected.assets.map((asset) => asset.id).join(' '),
      /workflow-raw|tracer-/u
    );
  });

  it('does not invent media when a work already has a canonical video Asset', () => {
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
        publicVideoWorkflow({
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
