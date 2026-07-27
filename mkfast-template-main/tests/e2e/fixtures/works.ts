import type { PublicContentPackage } from '@meiye/contracts';
import type { Page } from '@playwright/test';
import type { RawCanonicalHistory } from '../../../src/product/canonical-history-model';

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJAAAAAElFTkSuQmCC',
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
    updatedAt: '2026-07-27T09:00:00.000Z',
    versions: [
      {
        body: '模型原生直出的护理成片。',
        createdAt: '2026-07-27T09:00:00.000Z',
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
  await page.route('**/api/core/p1/assets?*', (route) =>
    route.fulfill({
      body: TRANSPARENT_PNG,
      contentType: 'image/png',
      status: 200,
    })
  );
}
