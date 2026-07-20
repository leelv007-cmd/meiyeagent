import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FileSystemAssetStorage } from '../model-supply/filesystem-asset-storage.js';
import { MediaCustodyStorageAdapter } from './media-custody-storage.js';

test('copies a resolved JPEG to one stable workspace-owned hash key', async (t) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'media-custody-'));
  t.after(() => rm(rootDirectory, { force: true, recursive: true }));
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]);
  const source = {
    assetId: 'source-a',
    bytes,
    contentType: 'image/jpeg',
    kind: 'resolved' as const,
    objectKey: 'workspace-a/assets/source-a.jpg',
    providerReadableUrl: 'data:image/jpeg;base64,/9j/2wAB',
    sha256: '1ad10116902e77eab8ab89fc5bcb100849c58934fb9dc3fd9bc914327aa2c63f',
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
          : { assetId, kind: 'failure' as const, reason: 'not_found' as const }
      );
    },
    async resolve(workspaceId: string, assetIds: string[]) {
      assert.equal(workspaceId, 'workspace-a');
      return assetIds.map((assetId) =>
        assetId === source.assetId
          ? source
          : { assetId, kind: 'failure' as const, reason: 'not_found' as const }
      );
    },
  };
  const storage = new FileSystemAssetStorage({ rootDirectory });
  const adapter = new MediaCustodyStorageAdapter(resolver, storage);

  const inspected = await adapter.inspectSources({
    sourceAssetIds: [source.assetId],
    workspaceId: 'workspace-a',
  });
  const first = await adapter.copyToOwned({
    sourceAssetId: source.assetId,
    sourceObjectKey: source.objectKey,
    workspaceId: 'workspace-a',
  });
  const replayed = await adapter.copyToOwned({
    sourceAssetId: source.assetId,
    sourceObjectKey: source.objectKey,
    workspaceId: 'workspace-a',
  });

  assert.deepEqual(inspected, [
    { id: source.assetId, objectKey: source.objectKey },
  ]);
  assert.deepEqual(replayed, first);
  assert.deepEqual(
    await adapter.inspectOwned({ assets: [first], workspaceId: 'workspace-a' }),
    [first.id]
  );
  assert.equal(first.contentType, 'image/jpeg');
  assert.equal(
    first.objectKey,
    `workspace-a/owned/${source.sha256}.jpg`
  );
  assert.deepEqual(
    new Uint8Array(await readFile(join(rootDirectory, first.objectKey))),
    bytes
  );
  const restoredJpeg = await storage.read(first.objectKey);
  assert.equal(restoredJpeg.contentType, 'image/jpeg');
  assert.deepEqual(new Uint8Array(restoredJpeg.bytes), bytes);
  await unlink(join(rootDirectory, first.objectKey));
  assert.deepEqual(
    await adapter.inspectOwned({ assets: [first], workspaceId: 'workspace-a' }),
    []
  );
});

test('keeps distinct source lineage identities while deduplicating identical bytes', async (t) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'media-custody-lineage-'));
  t.after(() => rm(rootDirectory, { force: true, recursive: true }));
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02]);
  const sha256 =
    '5038673792758fa3e1944f1b637f96a524977b33f3d048cf0ebe14e3e64b859a';
  const resolver = {
    async inspect(workspaceId: string, assetIds: string[]) {
      return assetIds.map((assetId) => ({
        assetId,
        contentType: 'image/jpeg',
        kind: 'resolved' as const,
        objectKey: `${workspaceId}/assets/${assetId}.jpg`,
      }));
    },
    async resolve(workspaceId: string, assetIds: string[]) {
      return assetIds.map((assetId) => ({
        assetId,
        bytes,
        contentType: 'image/jpeg',
        kind: 'resolved' as const,
        objectKey: `${workspaceId}/assets/${assetId}.jpg`,
        providerReadableUrl: 'data:image/jpeg;base64,/9j/2wAC',
        sha256,
      }));
    },
  };
  const adapter = new MediaCustodyStorageAdapter(
    resolver,
    new FileSystemAssetStorage({ rootDirectory })
  );
  const [first, second] = await Promise.all(
    ['source-a', 'source-b'].map((sourceAssetId) =>
      adapter.copyToOwned({
        sourceAssetId,
        sourceObjectKey: `workspace-a/assets/${sourceAssetId}.jpg`,
        workspaceId: 'workspace-a',
      })
    )
  );

  assert.equal(first?.objectKey, second?.objectKey);
  assert.notEqual(first?.id, second?.id);
});

test('round-trips a custody WebP with its real MIME type', async (t) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'media-custody-webp-'));
  t.after(() => rm(rootDirectory, { force: true, recursive: true }));
  const bytes = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
  ]);
  const storage = new FileSystemAssetStorage({ rootDirectory });

  const receipt = await storage.persistOwnedAsset({
    bytes,
    contentType: 'image/webp',
    workspaceId: 'workspace-a',
  });

  assert.match(receipt.objectKey, /^workspace-a\/owned\/[a-f0-9]{64}\.webp$/u);
  const restoredWebp = await storage.read(receipt.objectKey);
  assert.equal(restoredWebp.contentType, 'image/webp');
  assert.deepEqual(new Uint8Array(restoredWebp.bytes), bytes);
});
