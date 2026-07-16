import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentPackageCard } from './content-package-card';

test('renders one user-facing package without leaking internal status names', () => {
  const html = renderToStaticMarkup(
    <ContentPackageCard
      contentPackage={{
        compliance: {
          aigcLabelEnabled: true,
          watermarkEnabled: false,
        },
        createdAt: '2026-07-15T08:00:00.000Z',
        currentVersionId: 'version-1',
        exportReceipts: [],
        generated: {
          assetIds: ['image-1', 'image-2'],
          childRuns: [],
        },
        id: 'package-1',
        kind: 'image_text',
        lineage: {},
        rights: { state: 'authorized' },
        source: { assetIds: ['source-1'] },
        status: 'accepted',
        statusGroup: 'usable',
        statusLabel: '可使用',
        updatedAt: '2026-07-15T08:05:00.000Z',
        variants: [],
        versions: [
          {
            body: '这是已采用的正文。',
            createdAt: '2026-07-15T08:00:00.000Z',
            id: 'version-1',
            orderedAssetIds: ['image-2', 'image-1'],
            title: '夏日美甲新色',
            topics: [],
          },
        ],
        workspaceId: 'workspace-1',
      }}
      media={[
        {
          assetId: 'image-2',
          href: '/dashboard/assets/owned-image-2',
          kind: 'image',
          src: '/api/product/assets/owned-image-2/content',
          title: '图片 2',
        },
        {
          assetId: 'image-1',
          href: '/dashboard/assets/owned-image-1',
          kind: 'image',
          src: '/api/product/assets/owned-image-1/content',
          title: '图片 1',
        },
      ]}
      onOpen={() => undefined}
    />
  );

  assert.match(html, /夏日美甲新色/);
  assert.match(html, /这是已采用的正文/);
  assert.match(html, /可使用/);
  assert.match(html, /2 张素材/);
  assert.match(html, /查看详情/);
  assert.ok(
    html.indexOf('/api/product/assets/owned-image-2/content') <
      html.indexOf('/api/product/assets/owned-image-1/content')
  );
  assert.doesNotMatch(html, /accepted/);
});

test('plays an owned composed video directly from the ContentPackage receipt', () => {
  const html = renderToStaticMarkup(
    <ContentPackageCard
      contentPackage={{
        compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
        createdAt: '2026-07-15T08:00:00.000Z',
        currentVersionId: 'video-version-1',
        exportReceipts: [],
        generated: {
          assetIds: ['owned-video-1'],
          childRuns: [],
          ownedAssets: [
            {
              contentType: 'video/mp4',
              id: 'owned-video-1',
              objectKey: 'workspace-1/composed/final video.mp4',
              sha256: 'video-sha',
            },
          ],
        },
        id: 'video-package-1',
        kind: 'video',
        lineage: {},
        rights: { state: 'authorized' },
        source: { assetIds: [], workflowId: 'workflow-video-1' },
        status: 'accepted',
        statusGroup: 'usable',
        statusLabel: '可使用',
        updatedAt: '2026-07-15T08:05:00.000Z',
        variants: [],
        versions: [
          {
            body: 'opening: 门店开场',
            createdAt: '2026-07-15T08:05:00.000Z',
            id: 'video-version-1',
            orderedAssetIds: ['owned-video-1'],
            title: '视频成片 · V1',
            topics: [],
          },
        ],
        workspaceId: 'workspace-1',
      }}
    />
  );

  assert.match(html, /<video/);
  assert.match(html, /controls=""/);
  assert.match(
    html,
    /\/api\/core\/p1\/assets\?objectKey=workspace-1%2Fcomposed%2Ffinal%20video\.mp4/
  );
});
