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
        revision: 0,
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
        revision: 0,
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

test('no-media package uses porcelain title band with ink text, not white on muted', () => {
  const html = renderToStaticMarkup(
    <ContentPackageCard
      contentPackage={{
        compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
        createdAt: '2026-07-15T08:00:00.000Z',
        currentVersionId: 'version-empty',
        exportReceipts: [],
        generated: { assetIds: [], childRuns: [] },
        id: 'package-no-media',
        kind: 'image_text',
        lineage: {},
        revision: 0,
        rights: { state: 'authorized' },
        source: { assetIds: [] },
        status: 'draft',
        statusGroup: 'creating',
        statusLabel: '创作中',
        updatedAt: '2026-07-15T08:05:00.000Z',
        variants: [],
        versions: [
          {
            body: '尚无封面素材。',
            createdAt: '2026-07-15T08:00:00.000Z',
            id: 'version-empty',
            orderedAssetIds: [],
            title: '无媒体成品',
            topics: [],
          },
        ],
        workspaceId: 'workspace-1',
      }}
      onOpen={() => undefined}
    />
  );

  assert.match(html, /data-has-media="false"/);
  assert.match(html, /bg-\[var\(--paper\)\]/);
  assert.match(html, /text-\[var\(--ink-90\)\]/);
  assert.doesNotMatch(html, /meiye-media-mask/);
  // Title must not use white-on-muted treatment when media is absent.
  assert.doesNotMatch(
    html,
    /text-white \[text-shadow:0_1px_2px_oklch\(0_0_0\/0\.45\)\]/
  );
  assert.match(html, /无媒体成品/);
  assert.match(html, /创作中/);
});

test('uses the attached generated image as the visible library cover', () => {
  const html = renderToStaticMarkup(
    <ContentPackageCard
      contentPackage={{
        compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
        createdAt: '2026-07-17T08:00:00.000Z',
        currentVersionId: 'version-with-generation',
        exportReceipts: [],
        generated: {
          assetIds: ['generated-image'],
          childRuns: [],
          ownedAssets: [
            {
              contentType: 'image/png',
              id: 'generated-image',
              objectKey: 'workspace-1/generated/generated-image.png',
              sha256: 'generated-image-sha',
            },
          ],
        },
        id: 'package-with-generation',
        kind: 'image_text',
        lineage: {},
        revision: 0,
        rights: { state: 'authorized' },
        source: { assetIds: ['source-image'] },
        status: 'accepted',
        statusGroup: 'usable',
        statusLabel: '可使用',
        updatedAt: '2026-07-17T08:05:00.000Z',
        variants: [],
        versions: [
          {
            body: '生成图已加入成品。',
            createdAt: '2026-07-17T08:05:00.000Z',
            id: 'version-with-generation',
            orderedAssetIds: ['source-image', 'generated-image'],
            title: '生成图成品',
            topics: [],
          },
        ],
        workspaceId: 'workspace-1',
      }}
      media={[
        {
          assetId: 'source-image',
          href: '/dashboard/assets/source-image',
          kind: 'image',
          src: '/api/product/assets/source-image/content',
          title: '原始参考图',
        },
        {
          assetId: 'generated-image',
          href: '/dashboard/assets/generated-image',
          kind: 'image',
          src: '/api/core/p1/assets?objectKey=generated-image',
          title: '生成图',
        },
      ]}
    />
  );

  assert.ok(
    html.indexOf('/api/core/p1/assets?objectKey=generated-image') <
      html.indexOf('/api/product/assets/source-image/content')
  );
});
