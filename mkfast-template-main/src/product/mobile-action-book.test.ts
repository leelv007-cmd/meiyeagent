import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { ContentPackage } from '@meiye/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mobileContentPackage } from './mobile-content-package';

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

const { MobilePublishRoutes } = await import('./mobile-action-book');

function contentPackage(
  id: string,
  workId: string,
  updatedAt: string,
  status: ContentPackage['status'] = 'draft'
): ContentPackage {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: updatedAt,
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id,
    kind: 'image_text',
    lineage: {},
    rights: { state: 'authorized' },
    source: { assetIds: [], workId },
    status,
    updatedAt,
    variants: [],
    versions: [],
    workspaceId: 'workspace-1',
  };
}

test('binds mobile editing to an explicit package or Work without first-item guessing', () => {
  const unrelated = contentPackage(
    'package-unrelated',
    'work-unrelated',
    '2026-07-15T09:00:00.000Z'
  );
  const older = contentPackage(
    'package-work-old',
    'work-selected',
    '2026-07-15T08:00:00.000Z'
  );
  const latest = contentPackage(
    'package-work-latest',
    'work-selected',
    '2026-07-15T08:30:00.000Z'
  );
  const packages = [unrelated, older, latest];

  assert.equal(
    mobileContentPackage(packages, { workId: 'work-selected' })?.id,
    'package-work-latest'
  );
  assert.equal(
    mobileContentPackage(packages, {
      packageId: 'package-work-old',
      workId: 'work-selected',
    })?.id,
    'package-work-old'
  );
  assert.equal(
    mobileContentPackage(packages, { packageId: 'package-missing' }),
    undefined
  );
  assert.equal(
    mobileContentPackage(packages, {
      packageId: 'package-unrelated',
      workId: 'work-selected',
    }),
    undefined
  );
});

test('uses the latest usable package when mobile dashboard has no explicit binding', () => {
  const packages = [
    contentPackage(
      'package-new-draft',
      'work-new',
      '2026-07-15T09:30:00.000Z'
    ),
    contentPackage(
      'package-accepted',
      'work-accepted',
      '2026-07-15T09:00:00.000Z',
      'accepted'
    ),
    contentPackage(
      'package-review-ready',
      'work-review',
      '2026-07-15T09:15:00.000Z',
      'review_ready'
    ),
  ];

  assert.equal(mobileContentPackage(packages, {})?.id, 'package-review-ready');
});

test('renders honest mobile publishing routes before any publish action', () => {
  const html = renderToStaticMarkup(
    createElement(MobilePublishRoutes, {
      canCreateL3: true,
      douyinIntegrated: false,
      onCreateL3() {},
    })
  );

  assert.match(html, /未接入/u);
  assert.match(html, /<button[^>]*disabled[^>]*>[^<]*L1/u);
  assert.match(
    html,
    /<button(?![^>]* disabled="")[^>]*>L3 生成人工发布包<\/button>/u
  );
});
