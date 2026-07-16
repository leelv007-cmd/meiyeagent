import assert from 'node:assert/strict';
import test from 'node:test';

import { transitionContentPackage } from './content-package.js';
import { OperationsApplicationService } from './application-service.js';
import { RecordedCanvasExportAdapter, RecordedImageGenerationAdapter } from './adapters.js';
import { OperationsFoundationModule } from './foundation-module.js';
import { reconcileMediaCustody, repairMediaCustody } from './media-custody.js';
import { MemoryOperationsRepository } from './repository.js';

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

test('Foundation repair copies every missing source once and persists lineage and version references', async () => {
  const repository = new MemoryOperationsRepository();
  const context = {
    actor: 'admin' as const,
    correlationId: 'custody-repair-correlation',
    userId: 'custody-admin',
    workspaceId: 'workspace-a',
  };
  repository.grantMembership(context.userId, context.workspaceId);
  const copiedSourceIds: string[] = [];
  const operations = new OperationsApplicationService(repository, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    mediaCustodyStorage: {
      async inspectOwned(input) {
        return input.assets.map((asset) => asset.id);
      },
      async copyToOwned(input: {
        sourceAssetId: string;
        workspaceId: string;
      }) {
        copiedSourceIds.push(input.sourceAssetId);
        return {
          contentType: 'image/jpeg',
          id: `owned-${input.sourceAssetId}`,
          objectKey: `${input.workspaceId}/owned/${input.sourceAssetId}.jpg`,
          sha256: input.sourceAssetId.endsWith('a')
            ? 'a'.repeat(64)
            : 'b'.repeat(64),
          sizeBytes: 3,
        };
      },
      async inspectSources(input: {
        sourceAssetIds: string[];
        workspaceId: string;
      }) {
        return input.sourceAssetIds.map((sourceAssetId) => ({
          id: sourceAssetId,
          objectKey: `${input.workspaceId}/assets/${sourceAssetId}.jpg`,
        }));
      },
    },
    notifier: { async send() {} },
  });
  const created = await operations.createContentPackage(context, {
    kind: 'image_text',
    source: { assetIds: ['source-a', 'source-b'] },
  });
  const state = await repository.loadWorkspace(context.workspaceId);
  assert.ok(state);
  const packageIndex = state.contentPackages.findIndex(
    (contentPackage) => contentPackage.id === created.id
  );
  const accepted = transitionContentPackage(
    { ...created, status: 'review_ready' },
    {
      type: 'adopted',
      version: {
        body: 'Custody repair',
        createdAt: '2026-07-16T10:00:00.000Z',
        createdBy: context.userId,
        id: 'version-a',
        orderedAssetIds: ['source-a', 'source-b'],
        title: 'Custody repair',
        topics: [],
      },
    },
    '2026-07-16T10:00:00.000Z'
  );
  accepted.versions.push({
    ...accepted.versions[0]!,
    id: 'version-b',
    orderedAssetIds: ['source-a'],
  });
  state.contentPackages[packageIndex] = accepted;
  await repository.saveWorkspace(state);
  const foundation = new OperationsFoundationModule(operations, {
    adminActorIds: [context.userId],
  });
  const command = {
    context,
    idempotencyKey: 'repair-version-a',
    input: {
      action: 'repair_media_custody',
      payload: {
        packageId: created.id,
        versionId: 'version-a',
      },
    },
  };

  const repaired = (await foundation.execute(command)) as {
    copiedAssetIds: string[];
    report: { summary: { missingReplicas: number } };
  };
  const replayed = await foundation.execute(command);
  const replayedWithAnotherKey = await foundation.execute({
    ...command,
    idempotencyKey: 'repair-version-a-again',
  });

  assert.deepEqual(replayed, repaired);
  assert.deepEqual(replayedWithAnotherKey, repaired);
  assert.deepEqual(copiedSourceIds, ['source-a', 'source-b']);
  assert.deepEqual(repaired.copiedAssetIds, [
    'owned-source-a',
    'owned-source-b',
  ]);
  assert.equal(repaired.report.summary.missingReplicas, 0);
  const repairedState = await repository.loadWorkspace(context.workspaceId);
  const repairedPackage = repairedState?.contentPackages.find(
    (contentPackage) => contentPackage.id === created.id
  );
  assert.deepEqual(repairedPackage?.versions[0]?.orderedAssetIds, [
    'owned-source-a',
    'owned-source-b',
  ]);
  assert.deepEqual(repairedPackage?.versions[1]?.orderedAssetIds, ['source-a']);
  assert.deepEqual(repairedPackage?.generated.assetIds, [
    'owned-source-a',
    'owned-source-b',
  ]);
  assert.deepEqual(repairedPackage?.source.assetIds, ['source-a', 'source-b']);
  assert.deepEqual(
    repairedPackage?.generated.ownedAssets?.map((asset) => ({
      id: asset.id,
      sourceAssetId: asset.sourceAssetId,
    })),
    [
      { id: 'owned-source-a', sourceAssetId: 'source-a' },
      { id: 'owned-source-b', sourceAssetId: 'source-b' },
    ]
  );
});
