import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileMediaCustody, repairMediaCustody } from './media-custody.js';

test('labels source, owned, and replica custody and returns repairable missing links', () => {
  const report = reconcileMediaCustody({
    contentPackages: [
      {
        generated: {
          assetIds: ['owned-a', 'source-b'],
          ownedAssets: [
            {
              contentType: 'image/png',
              id: 'owned-a',
              objectKey: 'workspace-a/generated/owned-a.png',
              sha256: 'a'.repeat(64),
              sourceAssetId: 'source-a',
            },
          ],
        },
        id: 'package-a',
        source: { assetIds: ['source-a', 'source-b'] },
        versions: [
          { id: 'version-a', orderedAssetIds: ['owned-a', 'source-b'] },
        ],
        workspaceId: 'workspace-a',
      },
    ],
    sourceAssets: [
      { id: 'source-a', objectKey: 'workspace-a/assets/source-a.png' },
      { id: 'source-b', objectKey: 'workspace-a/assets/source-b.png' },
    ],
    workspaceId: 'workspace-a',
  });

  assert.deepEqual(
    report.assets.map((asset) => [asset.id, asset.custody]),
    [
      ['source-a', 'source'],
      ['source-b', 'source'],
      ['owned-a', 'owned'],
    ]
  );
  assert.equal(report.packageLinks[0]?.status, 'complete');
  assert.equal(report.packageLinks[0]?.sourceAssetId, 'source-a');
  assert.equal(report.packageLinks[1]?.status, 'missing_replica');
  assert.deepEqual(report.repairs, [
    {
      action: 'copy_to_owned',
      packageId: 'package-a',
      sourceAssetId: 'source-b',
      sourceObjectKey: 'workspace-a/assets/source-b.png',
      versionId: 'version-a',
    },
  ]);
  assert.equal(report.summary.sampledLinks, 2);
  assert.equal(report.summary.missingReplicas, 1);
});

test('uses explicit source lineage instead of inferring it from array order', () => {
  const report = reconcileMediaCustody({
    contentPackages: [
      {
        generated: {
          assetIds: ['owned-b'],
          ownedAssets: [
            {
              contentType: 'image/png',
              id: 'owned-b',
              objectKey: 'workspace-a/generated/owned-b.png',
              sha256: 'b'.repeat(64),
              sourceAssetId: 'source-b',
            },
          ],
        },
        id: 'package-a',
        source: { assetIds: ['source-a', 'source-b'] },
        versions: [{ id: 'version-a', orderedAssetIds: ['owned-b'] }],
        workspaceId: 'workspace-a',
      },
    ],
    sourceAssets: [
      { id: 'source-a', objectKey: 'workspace-a/assets/source-a.png' },
      { id: 'source-b', objectKey: 'workspace-a/assets/source-b.png' },
    ],
    workspaceId: 'workspace-a',
  });

  assert.equal(report.packageLinks[0]?.sourceAssetId, 'source-b');
});

test('repairs an owned receipt whose physical object failed integrity inspection', async () => {
  const copied: string[] = [];
  const result = await repairMediaCustody({
    contentPackages: [
      {
        generated: {
          assetIds: ['owned-stale'],
          ownedAssets: [
            {
              contentType: 'image/jpeg',
              id: 'owned-stale',
              objectKey: `workspace-a/owned/${'a'.repeat(64)}.jpg`,
              sha256: 'a'.repeat(64),
              sizeBytes: 3,
              sourceAssetId: 'source-a',
            },
          ],
        },
        id: 'package-a',
        source: { assetIds: ['source-a'] },
        versions: [
          { id: 'version-a', orderedAssetIds: ['owned-stale'] },
        ],
        workspaceId: 'workspace-a',
      },
    ],
    packageId: 'package-a',
    sourceAssets: [],
    storage: {
      async copyToOwned(input) {
        copied.push(input.sourceAssetId);
        return {
          contentType: 'image/jpeg',
          id: 'owned-repaired',
          objectKey: `workspace-a/owned/${'b'.repeat(64)}.jpg`,
          sha256: 'b'.repeat(64),
          sizeBytes: 3,
        };
      },
      async inspectOwned() {
        return [];
      },
      async inspectSources() {
        return [
          {
            id: 'source-a',
            objectKey: 'workspace-a/assets/source-a.jpg',
          },
        ];
      },
    },
    versionId: 'version-a',
    workspaceId: 'workspace-a',
  });

  assert.deepEqual(copied, ['source-a']);
  assert.deepEqual(
    result.contentPackages[0]?.versions[0]?.orderedAssetIds,
    ['owned-repaired']
  );
  assert.equal(result.report.summary.missingReplicas, 0);
});

test('rejects cross-workspace owned object keys instead of calling them replicas', () => {
  assert.throws(
    () =>
      reconcileMediaCustody({
        contentPackages: [
          {
            generated: {
              assetIds: [],
              ownedAssets: [
                {
                  contentType: 'image/png',
                  id: 'owned-foreign',
                  objectKey: 'workspace-b/generated/foreign.png',
                  sha256: 'b'.repeat(64),
                },
              ],
            },
            id: 'package-a',
            source: { assetIds: [] },
            versions: [],
            workspaceId: 'workspace-a',
          },
        ],
        sourceAssets: [],
        workspaceId: 'workspace-a',
      }),
    /workspace-owned object key/u
  );
});
