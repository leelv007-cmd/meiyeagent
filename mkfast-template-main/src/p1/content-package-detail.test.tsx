import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContentPackageDetail,
  contentPackageRunCapabilityLabel,
  type ContentPackageLineageProjection,
} from './content-package-detail';
import type { ContentPackageProjection } from './content-package-card';

function packageProjection(
  id: string,
  title: string,
  workId?: string
): ContentPackageProjection {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-15T08:00:00.000Z',
    currentVersionId: `${id}-v2`,
    exportReceipts: [],
    generated: { assetIds: ['image-1'], childRuns: [] },
    id,
    kind: 'image_text',
    lineage: {},
    revision: 2,
    rights: { state: 'authorized' },
    source: { assetIds: ['image-1'], ...(workId ? { workId } : {}) },
    status: 'accepted',
    statusGroup: 'usable',
    statusLabel: '可使用',
    updatedAt: '2026-07-15T08:05:00.000Z',
    variants: [],
    versions: [
      {
        body: '历史正文',
        createdAt: '2026-07-15T08:00:00.000Z',
        id: `${id}-v1`,
        orderedAssetIds: ['image-1'],
        source: 'ai_generated',
        title: '历史标题',
        topics: ['美业'],
      },
      {
        body: `${title}正文`,
        conversionHook: '私信预约',
        createdAt: '2026-07-15T08:05:00.000Z',
        id: `${id}-v2`,
        orderedAssetIds: ['image-1'],
        source: 'merchant_edited',
        title,
        topics: ['美业', '同城'],
      },
    ],
    workspaceId: 'workspace-1',
  };
}

test('renders immutable versions, evidence, receipts, and lineage as an archive', () => {
  const contentPackage = packageProjection(
    'package-2',
    '夏日美甲新色',
    'work-2'
  );
  contentPackage.exportReceipts = [
    {
      artifactAssetId: 'export-1',
      createdAt: '2026-07-15T09:00:00.000Z',
      id: 'receipt-1',
      platform: 'xiaohongshu',
      status: 'succeeded',
      variantVersionId: 'xhs-v1',
    },
  ];
  const lineage: ContentPackageLineageProjection = {
    ancestors: [packageProjection('package-1', '来源成品')],
    children: [packageProjection('package-3', '衍生成品')],
    truncated: false,
  };
  const opened: string[] = [];

  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={contentPackage}
      lineage={lineage}
      media={[
        {
          assetId: 'image-1',
          href: '/dashboard/assets/image-1',
          kind: 'image',
          src: '/api/core/p1/assets/image-1',
          title: '成品预览',
        },
      ]}
      onOpenPackage={(packageId) => opened.push(packageId)}
    />
  );

  assert.match(html, /夏日美甲新色/);
  assert.match(html, /历史标题/);
  assert.match(html, /当前版本/);
  assert.match(html, /商户编辑/);
  assert.match(html, /小红书 · 导出成功/u);
  assert.match(html, /来源成品/);
  assert.match(html, /衍生成品/);
  assert.match(html, /src="\/api\/core\/p1\/assets\/image-1"/u);
  assert.deepEqual(opened, []);
});

test('renders the exact source Work result handoff', () => {
  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={packageProjection('package-2', '成品', 'work/2')}
    />
  );

  assert.match(html, /data-cutover-state="result-center-handoff"/u);
  assert.match(
    html,
    /href="\/dashboard\/results\/work%2F2\?contentId=package-2"/u
  );
  assert.match(html, /继续在结果中心处理/u);
});

test('keeps legacy packages without a source Work read-only and targetless', () => {
  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={packageProjection('legacy-package', '旧成品')}
    />
  );

  assert.match(html, /data-cutover-state="legacy-read-only"/u);
  assert.match(html, /历史只读档案/u);
  assert.doesNotMatch(html, /\/dashboard\/results\//u);
  assert.doesNotMatch(html, /<(?:form|input|textarea)\b/u);
});

test('projects historical usage labels without exposing retry controls', () => {
  const contentPackage = packageProjection('package-ledger', '账本', 'work-1');
  contentPackage.generated.childRuns = [
    {
      productUsage: {
        quantity: 1,
        status: 'committed',
      },
      runId: 'run-1',
      runType: 'model_job',
    },
  ];

  const html = renderToStaticMarkup(
    <ContentPackageDetail contentPackage={contentPackage} />
  );

  assert.match(html, /文案生成/);
  assert.match(html, /已结算/);
  assert.doesNotMatch(html, /重试/u);
  assert.equal(contentPackageRunCapabilityLabel('creative_job'), '内容生成');
  assert.equal(
    contentPackageRunCapabilityLabel('durable_video_workflow'),
    '视频生成'
  );
});
