import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ContentPackage } from '@meiye/contracts';

import { validateContentPackageVisibleCopyPolicy } from './content-package-visible-copy-policy.js';

test('validates note page copy as canonical visible text', async () => {
  const version = {
    body: '普通正文',
    createdAt: '2026-08-02T00:00:00.000Z',
    id: 'note-version-1',
    note: {
      plan: {
        pages: [
          {
            id: 'page-1',
            textBlock: {
              body: '卫健委批准的正规医美机构',
              title: '三甲医院合作单位',
            },
          },
        ],
      },
    },
    orderedAssetIds: ['asset-page-1'],
    title: '普通标题',
    topics: [],
  } as unknown as ContentPackage['versions'][number];
  const contentPackage = {
    revision: 1,
    variants: [],
    versions: [version],
    workspaceId: 'workspace-note-policy',
  } as unknown as ContentPackage;

  const result = await validateContentPackageVisibleCopyPolicy({
    contentPackage,
    intendedUse: 'public_content',
    phase: 'delivery',
    target: 'content_package.edit',
    versionId: version.id,
  });

  assert.equal(result.passed, false);
  assert.equal(result.failures[0]?.gateId, 'critical_fact_source');
  assert.deepEqual(
    result.claimExtraction?.claims.map(({ field }) => field),
    ['note.pages.page-1.title', 'note.pages.page-1.body']
  );
});
