import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentPackageDetail } from './content-package-detail';
import type { ContentPackageProjection } from './content-package-card';

function projection(workId?: string): ContentPackageProjection {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-20T08:00:00.000Z',
    currentVersionId: 'version-1',
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: 'package-1',
    kind: 'image_text',
    lineage: {},
    revision: 1,
    rights: { state: 'authorized' },
    source: { assetIds: [], ...(workId ? { workId } : {}) },
    status: 'accepted',
    statusGroup: 'usable',
    statusLabel: '可使用',
    updatedAt: '2026-07-20T08:00:00.000Z',
    variants: [],
    versions: [
      {
        body: '历史正文',
        createdAt: '2026-07-20T08:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: [],
        title: '历史标题',
        topics: ['美业'],
      },
    ],
    workspaceId: 'workspace-1',
  };
}

test('renders a precise Result Center handoff and no duplicate active actions', () => {
  const html = renderToStaticMarkup(
    <ContentPackageDetail contentPackage={projection('work/with space')} />
  );

  assert.match(
    html,
    /href="\/dashboard\/results\/work%2Fwith%20space\?contentId=package-1"/u
  );
  assert.match(html, /继续在结果中心处理/u);
  for (const label of [
    '保存为新版本',
    '回滚为新版本',
    '导出小红书',
    '批准并交付',
    '重试交付',
    '重试导出',
    '生成视频',
  ]) {
    assert.doesNotMatch(html, new RegExp(label, 'u'));
  }
  assert.doesNotMatch(html, /<button[^>]*>[^<]*做同款<\/button>/u);
  assert.doesNotMatch(html, /<(?:input|textarea|form)\b/u);
});

test('keeps a package without source Work read-only and never guesses a result target', () => {
  const html = renderToStaticMarkup(
    <ContentPackageDetail contentPackage={projection()} />
  );

  assert.match(html, /data-cutover-state="legacy-read-only"/u);
  assert.match(html, /历史只读档案/u);
  assert.doesNotMatch(html, /\/dashboard\/results\//u);
});
