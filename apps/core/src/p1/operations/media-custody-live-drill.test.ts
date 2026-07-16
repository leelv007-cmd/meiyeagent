/**
 * Ticket 22: live storage drill — reconcile samples a missing replica and
 * repairMediaCustody copies source bytes into owned storage.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { FileSystemAssetStorage } from '../model-supply/filesystem-asset-storage.js';
import {
  reconcileMediaCustody,
  repairMediaCustody,
} from './media-custody.js';
import { MediaCustodyStorageAdapter } from './media-custody-storage.js';

test('ticket 22 live drill: sample missing replica then repair via filesystem copy', async (t) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'media-custody-live-'));
  t.after(() => rm(rootDirectory, { force: true, recursive: true }));

  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xaa, 0xbb]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sourceObjectKey = 'workspace-a/assets/source-live.jpg';
  await mkdir(join(rootDirectory, 'workspace-a/assets'), { recursive: true });
  await writeFile(join(rootDirectory, sourceObjectKey), bytes);

  const source = {
    assetId: 'source-live',
    bytes,
    contentType: 'image/jpeg',
    kind: 'resolved' as const,
    objectKey: sourceObjectKey,
    providerReadableUrl: 'data:image/jpeg;base64,/9j/',
    sha256,
  };
  const resolver = {
    async inspect(workspaceId: string, assetIds: string[]) {
      assert.equal(workspaceId, 'workspace-a');
      return assetIds.map((assetId) =>
        assetId === source.assetId
          ? {
              assetId,
              contentType: source.contentType,
              kind: 'resolved' as const,
              objectKey: source.objectKey,
            }
          : { assetId, kind: 'failure' as const, reason: 'not_found' as const },
      );
    },
    async resolve(workspaceId: string, assetIds: string[]) {
      assert.equal(workspaceId, 'workspace-a');
      return assetIds.map((assetId) =>
        assetId === source.assetId
          ? source
          : { assetId, kind: 'failure' as const, reason: 'not_found' as const },
      );
    },
  };
  const storage = new FileSystemAssetStorage({ rootDirectory });
  const adapter = new MediaCustodyStorageAdapter(resolver, storage);

  const packageInput = {
    contentPackages: [
      {
        generated: { assetIds: [], ownedAssets: [] },
        id: 'package-live',
        source: { assetIds: ['source-live'] },
        versions: [
          { id: 'version-live', orderedAssetIds: ['source-live'] },
        ],
        workspaceId: 'workspace-a',
      },
    ],
    sourceAssets: [{ id: 'source-live', objectKey: sourceObjectKey }],
    workspaceId: 'workspace-a',
  };

  const before = reconcileMediaCustody(packageInput);
  assert.equal(before.summary.sampledLinks, 1);
  assert.equal(before.summary.missingReplicas, 1);
  assert.deepEqual(before.repairs, [
    {
      action: 'copy_to_owned',
      packageId: 'package-live',
      sourceAssetId: 'source-live',
      sourceObjectKey,
      versionId: 'version-live',
    },
  ]);

  const repaired = await repairMediaCustody({
    ...packageInput,
    packageId: 'package-live',
    storage: adapter,
    versionId: 'version-live',
  });

  assert.equal(repaired.report.summary.missingReplicas, 0);
  const ownedId = repaired.contentPackages[0]?.versions[0]?.orderedAssetIds[0];
  assert.ok(ownedId);
  assert.notEqual(ownedId, 'source-live');
  const owned = repaired.contentPackages[0]?.generated.ownedAssets?.find(
    (asset) => asset.id === ownedId,
  );
  assert.ok(owned);
  assert.equal(owned.sourceAssetId, 'source-live');
  assert.deepEqual(
    new Uint8Array(await readFile(join(rootDirectory, owned.objectKey))),
    bytes,
  );
});
