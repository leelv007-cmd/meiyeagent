import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type {
  ContentItem,
  CreativeContent,
  CreativeWork,
} from '@meiye/contracts';
import type { ContentPackageProjection } from '@/p1/content-package-card';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  canonicalLegacyContentDetail,
  type CanonicalMediaProjection,
  type RawCanonicalHistory,
} from './canonical-history-model';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = {}',
      };
    }
    return nextResolve(specifier, context);
  },
});

const { CanonicalHistoryList, CanonicalLegacyContentCard } = await import(
  './canonical-history-page'
);

test('shared content package observers disable retries consistently', () => {
  for (const file of [
    './canonical-history-page.tsx',
    './creative-object-page.tsx',
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const anchor = source.indexOf(
      "queryKey: p1QueryKeys.request('operations', 'content_packages')"
    );
    assert.notEqual(anchor, -1, file);
    assert.match(source.slice(anchor, anchor + 500), /retry: false/u, file);
  }
});

function creativeWork(
  id: string,
  sessionId: string,
  status: CreativeWork['status']
): CreativeWork {
  return {
    createdAt: '2026-07-18T08:00:00.000Z',
    id,
    intent: `${id} intent`,
    mode: 'agent',
    sessionId,
    sourceReferences: [],
    status,
    updatedAt: '2026-07-18T09:00:00.000Z',
    workspaceId: 'workspace-1',
  };
}

function contentPackage(
  workId: string,
  status: 'accepted' | 'review_ready',
  revision: number
): ContentPackageProjection {
  return {
    compliance: {
      aigcLabelEnabled: true,
      watermarkEnabled: false,
    },
    createdAt: '2026-07-18T08:30:00.000Z',
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: `package-${workId}`,
    kind: 'image_text',
    lineage: {},
    revision,
    rights: { state: 'authorized' },
    source: { assetIds: [], workId },
    status,
    statusGroup: 'usable',
    statusLabel: '可使用',
    updatedAt: '2026-07-18T10:00:00.000Z',
    variants: [],
    versions: [],
    workspaceId: 'workspace-1',
  };
}

function canonicalHistory(works: CreativeWork[]): RawCanonicalHistory {
  return {
    assets: [],
    canvasWorks: [],
    contents: [],
    creativeWorks: works,
    exportReceipts: [],
    imageJobs: [],
    jobs: [],
    sessions: works.map((work) => ({
      createdAt: work.createdAt,
      id: work.sessionId,
      updatedAt: work.updatedAt,
      workIds: [work.id],
    })),
    tasks: [],
  };
}

const creativeContent: CreativeContent = {
  acceptedAt: '2026-07-15T09:00:00.000Z',
  assetIds: ['creative-asset'],
  body: 'P1 历史正文',
  createdAt: '2026-07-15T08:00:00.000Z',
  id: 'legacy-content',
  jobId: 'job-1',
  status: 'accepted',
  title: 'P1 历史标题',
  workId: 'work-1',
  workspaceId: 'workspace-1',
};

const productContent: ContentItem = {
  assetIds: ['product-asset'],
  complianceStatus: 'clear',
  createdAt: '2026-07-15T07:00:00.000Z',
  id: 'legacy-content',
  projectId: 'project-1',
  scenario: '旧 Product 场景',
  selected: true,
  status: 'draft',
  variants: [
    {
      aiDefaultVersionId: 'product-version',
      currentVersionId: 'product-version',
      id: 'product-variant',
      platform: 'douyin',
      versions: [
        {
          assetOrder: ['product-asset'],
          body: '旧 Product 正文',
          conversionHook: '',
          createdAt: '2026-07-15T07:00:00.000Z',
          id: 'product-version',
          source: 'merchant',
          title: '旧 Product 标题',
          topics: [],
        },
      ],
    },
  ],
};

const mediaById: Record<string, CanonicalMediaProjection> = {
  'creative-asset': {
    assetId: 'creative-asset',
    href: '/dashboard/assets/creative-asset',
    kind: 'image',
    src: '/api/media/creative-asset',
    title: 'P1 历史图片',
  },
  'product-asset': {
    assetId: 'product-asset',
    href: '/dashboard/assets/product-asset',
    kind: 'image',
    src: '/api/media/product-asset',
    title: '旧 Product 图片',
  },
};

test('renders one read-only legacy source instead of merging both galleries', () => {
  const detail = canonicalLegacyContentDetail(
    [creativeContent],
    [productContent],
    'legacy-content'
  );
  assert.ok(detail);
  const html = renderToStaticMarkup(
    createElement(CanonicalLegacyContentCard, {
      detail,
      media: detail.assetIds.map((id) => mediaById[id]!),
    })
  );

  assert.match(html, /只读/u);
  assert.match(html, /P1 历史正文/u);
  assert.match(html, /P1 历史图片/u);
  assert.doesNotMatch(html, /旧 Product 正文|旧 Product 图片/u);
});

test('history rows use package delivery truth and label unmapped old works honestly', () => {
  const delivered = creativeWork(
    'work-delivered',
    'session-delivered',
    'draft'
  );
  const legacy = creativeWork('work-legacy', 'session-legacy', 'completed');
  const history = canonicalHistory([delivered, legacy]);
  const items = [
    {
      detail: '草稿 · 对象已保存，但尚未提交执行',
      href: '/dashboard/works/work-delivered',
      id: delivered.id,
      kind: 'work' as const,
      title: '已交付作品',
      updatedAt: delivered.updatedAt,
    },
    {
      detail: '已完成',
      href: '/dashboard/works/work-legacy',
      id: legacy.id,
      kind: 'work' as const,
      title: '旧版作品',
      updatedAt: legacy.updatedAt,
    },
    {
      detail: '1 个 Work',
      href: '/dashboard/sessions/session-delivered',
      id: delivered.sessionId,
      kind: 'session' as const,
      title: '创作记录',
      updatedAt: delivered.updatedAt,
    },
  ];

  const html = renderToStaticMarkup(
    createElement(CanonicalHistoryList, {
      contentPackages: [contentPackage(delivered.id, 'review_ready', 3)],
      hasStore: true,
      history,
      items,
      mode: 'recent',
    })
  );

  assert.match(html, /已交付/u);
  assert.match(html, /第 3 版/u);
  assert.match(html, /可使用/u);
  assert.match(html, /旧版流程记录/u);
  assert.match(html, /dashboard\/content\?packageId=package-work-delivered/u);
  assert.doesNotMatch(html, /对象已保存|尚未提交执行/u);
});

test('history rows show package synchronization instead of a transient legacy label', () => {
  const work = creativeWork('work-syncing', 'session-syncing', 'completed');
  const history = canonicalHistory([work]);
  const html = renderToStaticMarkup(
    createElement(CanonicalHistoryList, {
      contentPackages: [],
      contentPackagesSynchronizing: true,
      hasStore: true,
      history,
      items: [
        {
          detail: '已完成',
          href: '/dashboard/works/work-syncing',
          id: work.id,
          kind: 'work' as const,
          title: '刚完成的作品',
          updatedAt: work.updatedAt,
        },
      ],
      mode: 'recent',
    })
  );

  assert.match(html, /同步中/u);
  assert.doesNotMatch(html, /旧版流程记录/u);
});
