import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { ContentItem, CreativeContent } from '@meiye/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  canonicalLegacyContentDetail,
  type CanonicalMediaProjection,
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

const { CanonicalLegacyContentCard } = await import(
  './canonical-history-page'
);

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
