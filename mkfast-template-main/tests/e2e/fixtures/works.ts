import type { PublicContentPackage } from '@meiye/contracts';
import type { Page } from '@playwright/test';
import type { RawCanonicalHistory } from '../../../src/product/canonical-history-model';

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJAAAAAElFTkSuQmCC',
  'base64'
);

const PLAYABLE_MP4 = Buffer.from(
  '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',
  'base64'
);

const EMPTY_CANONICAL_HISTORY = {
  assets: [],
  canvasWorks: [],
  contents: [],
  creativeWorks: [],
  exportReceipts: [],
  imageJobs: [],
  jobs: [],
  sessions: [],
  tasks: [],
} satisfies RawCanonicalHistory;

function ownedAsset(id: string, contentType: string) {
  return {
    contentType,
    id,
    objectKey: `workspace-browser-fixture/${id}`,
    sha256: `sha-${id}`,
  };
}

function fixture(
  overrides: Partial<PublicContentPackage> &
    Pick<PublicContentPackage, 'id' | 'kind'>
): PublicContentPackage {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-27T08:00:00.000Z',
    currentVersionId: 'version-1',
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    lineage: {},
    revision: 7,
    rights: { state: 'authorized' },
    source: { assetIds: [] },
    status: 'accepted',
    updatedAt: '2026-07-27T08:00:00.000Z',
    variants: [],
    versions: [],
    workspaceId: 'workspace-browser-fixture',
    ...overrides,
  };
}

export const WORKS_BROWSER_FIXTURES: PublicContentPackage[] = [
  fixture({
    id: 'fixture-copy',
    kind: 'image_text',
    updatedAt: '2026-07-27T12:00:00.000Z',
    versions: [
      {
        body: '把本周护理重点整理成一条可以直接复制使用的文案。',
        createdAt: '2026-07-27T12:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: [],
        title: '护理预约文案',
        topics: [],
      },
    ],
  }),
  fixture({
    generated: {
      assetIds: ['fixture-image-asset'],
      childRuns: [],
      ownedAssets: [ownedAsset('fixture-image-asset', 'image/png')],
    },
    id: 'fixture-image',
    kind: 'image_text',
    updatedAt: '2026-07-27T11:00:00.000Z',
    versions: [
      {
        body: '',
        createdAt: '2026-07-27T11:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: ['fixture-image-asset'],
        title: '门店护理主图',
        topics: [],
      },
    ],
  }),
  fixture({
    generated: {
      assetIds: ['fixture-note-asset'],
      childRuns: [],
      ownedAssets: [ownedAsset('fixture-note-asset', 'image/jpeg')],
    },
    id: 'fixture-note',
    kind: 'image_text',
    updatedAt: '2026-07-27T10:00:00.000Z',
    versions: [
      {
        body: '一套图文笔记，图片和正文作为同一份成品呈现。',
        createdAt: '2026-07-27T10:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: ['fixture-note-asset'],
        title: '夏日护理图文笔记',
        topics: [],
      },
    ],
  }),
  fixture({
    generated: {
      assetIds: ['fixture-video-asset'],
      childRuns: [],
      ownedAssets: [ownedAsset('fixture-video-asset', 'video/mp4')],
    },
    id: 'fixture-video',
    kind: 'video',
    legacySource: {
      mappingConfidence: 'exact',
      sourceId: 'fixture-durable-video-workflow',
      sourceType: 'durable_video_workflow',
    },
    source: {
      assetIds: [],
      targetPlatform: 'douyin',
      workId: 'fixture-video-work',
    },
    updatedAt: '2026-07-27T09:00:00.000Z',
    variants: [
      {
        currentVersionId: 'variant-version-1',
        id: 'fixture-video-douyin',
        platform: 'douyin',
        versions: [
          {
            body: '模型原生直出的护理成片。',
            createdAt: '2026-07-27T09:00:00.000Z',
            id: 'variant-version-1',
            orderedAssetIds: ['fixture-video-asset'],
            title: '到店护理成片',
            topics: [],
          },
        ],
      },
    ],
    versions: [
      {
        body: '模型原生直出的护理成片。',
        createdAt: '2026-07-27T09:00:00.000Z',
        exportUseDelivery: {
          exportUse: 'offline_material',
          kind: 'light_composer',
          materialSpecs: [
            {
              aspectRatio: '210:297',
              cropStrategy: 'contain_brand_safe',
              format: 'image/png',
              height: 3508,
              purpose: 'offline_a4_poster',
              renderer: 'light-composer',
              rendererVersion: 'light-composer-v1',
              textSafeArea: {
                bottom: 176,
                left: 176,
                right: 176,
                top: 176,
              },
              width: 2480,
            },
          ],
          receiptCommand: 'export_work',
          sourcePackageId: 'fixture-video',
          sourceVersionId: 'version-1',
          sourceWorkId: 'fixture-video-work',
          templateRole: 'offline_material',
        },
        id: 'version-1',
        orderedAssetIds: ['fixture-video-asset'],
        title: '到店护理成片',
        topics: [],
      },
    ],
  }),
];

export async function installWorksBrowserFixtures(page: Page) {
  await page.route('**/api/core/p1/query', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      action?: string;
      module?: string;
    } | null;
    if (body?.module !== 'operations') {
      await route.continue();
      return;
    }
    if (body.action === 'content_packages') {
      await route.fulfill({ json: { data: WORKS_BROWSER_FIXTURES } });
      return;
    }
    if (body.action === 'canonical_history') {
      await route.fulfill({ json: { data: EMPTY_CANONICAL_HISTORY } });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/core/p1/assets?*', (route) => {
    const objectKey = new URL(route.request().url()).searchParams.get(
      'objectKey'
    );
    const video = objectKey?.endsWith('/fixture-video-asset') ?? false;
    return route.fulfill({
      body: video ? PLAYABLE_MP4 : TRANSPARENT_PNG,
      contentType: video ? 'video/mp4' : 'image/png',
      status: 200,
    });
  });
}
