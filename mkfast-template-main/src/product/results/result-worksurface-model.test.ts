import assert from 'node:assert/strict';
import test from 'node:test';

import type { PublicContentPackage } from '@meiye/contracts';

import type { ResultCenterLiveSelection } from './result-live-projection';
import {
  buildResultCopyWorksurface,
  buildResultImageWorksurface,
  buildResultVideoWorksurface,
} from './result-worksurface-model';

const version = {
  id: 'version-2',
  title: 'Canonical title',
  body: 'Canonical body',
  conversionHook: 'Canonical CTA',
  topics: ['护理'],
  orderedAssetIds: ['asset-1', 'asset-2'],
  createdAt: '2026-08-04T00:00:00.000Z',
};

function packageFixture(
  overrides: Partial<PublicContentPackage> = {}
): PublicContentPackage {
  return {
    id: 'package-1',
    currentVersionId: version.id,
    revision: 2,
    status: 'accepted',
    kind: 'image_text',
    updatedAt: '2026-08-04T01:00:00.000Z',
    versions: [version],
    variants: [],
    generated: {
      assetIds: ['asset-1', 'asset-2'],
      childRuns: [],
      ownedAssets: [
        {
          id: 'asset-1',
          objectKey: 'owned/asset-1.png',
          contentType: 'image/png',
        },
        {
          id: 'asset-2',
          objectKey: 'owned/asset-2.png',
          contentType: 'image/png',
        },
      ],
    },
    ...overrides,
  } as unknown as PublicContentPackage;
}

test('copy builder lets the canonical package revision win over stream text', () => {
  const selected = {
    copyWorksurface: {
      workId: 'work-1',
      baseRevisionId: 'job-1',
      document: {
        title: 'Projected title',
        body: 'Projected body',
        conversionHook: '',
        topics: [],
        orderedAssetIds: [],
      },
      lifecycle: 'candidate',
    },
  } as unknown as ResultCenterLiveSelection;
  const result = buildResultCopyWorksurface({
    contentPackage: packageFixture(),
    currentVersion: version,
    editVersions: [version],
    partialCandidates: [{ title: 'Streaming title', body: 'Streaming body' }],
    selected,
    workId: 'work-1',
    workspaceKind: 'copy',
  });

  assert.equal(result?.baseRevisionId, 'version-2');
  assert.equal(result?.document.title, 'Canonical title');
  assert.equal(result?.document.body, 'Canonical body');
  assert.equal(result?.lifecycle, 'adopted');
});

test('image builder projects an adopted ordered set from the package', () => {
  const result = buildResultImageWorksurface({
    contentPackage: packageFixture(),
    currentPackageVersion: version,
    workId: 'work-1',
  });

  assert.equal(result?.lifecycle, 'adopted');
  assert.equal(result?.baseRevisionId, 'version-2');
  assert.deepEqual(result?.adoptedOrderedAssetIds, ['asset-1', 'asset-2']);
  assert.deepEqual(
    result?.candidates.map((candidate) => candidate.assetId),
    ['asset-1', 'asset-2']
  );
});

test('video builder overlays canonical package adoption and owned media', () => {
  const selected = {
    workspaceKind: 'video',
    work: { id: 'work-1' },
    job: null,
    assets: [],
    contents: [],
  } as unknown as ResultCenterLiveSelection;
  const contentPackage = packageFixture({
    kind: 'video',
    generated: {
      assetIds: ['video-1'],
      childRuns: [],
      ownedAssets: [
        {
          id: 'video-1',
          objectKey: 'owned/final video.mp4',
          contentType: 'video/mp4',
        },
      ],
    },
  } as unknown as Partial<PublicContentPackage>);
  const result = buildResultVideoWorksurface({
    contentPackage,
    currentPackageVersion: version,
    selected,
    workflow: {
      workflowId: 'workflow-1',
      workId: 'work-1',
      status: 'completed',
      storyboardVersion: 1,
      storyboardRevision: 'storyboard-1',
      catalogModelId: 'video-model',
      confirmed: true,
      shots: [],
      revision: 1,
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
  });

  assert.equal(result?.loopPhase, 'adopted');
  assert.equal(result?.versionId, 'version-2');
  assert.equal(result?.composedCandidate?.assetId, 'video-1');
  assert.equal(
    result?.composedCandidate?.playableUrl,
    '/api/core/p1/assets?objectKey=owned%2Ffinal%20video.mp4'
  );
});
