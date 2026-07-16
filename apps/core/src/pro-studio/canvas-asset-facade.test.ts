import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CanvasAssetError,
  CanvasAssetFacade,
  MemoryCanvasAssetRepository,
  MemoryCanvasObjectStorage,
} from './canvas-asset-facade.js';

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

function fixture() {
  let id = 0;
  const repository = new MemoryCanvasAssetRepository();
  const storage = new MemoryCanvasObjectStorage();
  const facade = new CanvasAssetFacade({
    repository,
    storage,
    clock: () => new Date('2026-07-16T08:00:00.000Z'),
    nextId: () => `asset-${++id}`,
  });
  return { facade, repository, storage };
}

test('persists a verified local derivative as a workspace-owned asset', async () => {
  const { facade, repository } = fixture();
  const asset = await facade.persistLocalCanvasArtifact(
    { userId: 'user-1', workspaceId: 'workspace-1' },
    {
      bytes: png,
      contentType: 'image/png',
      derivation: 'crop',
      fileName: 'cropped.png',
      parentAssetId: 'source-1',
    }
  );

  assert.equal(asset.workspaceId, 'workspace-1');
  assert.equal(asset.source.kind, 'local_canvas_derivative');
  assert.equal(asset.source.parentAssetId, 'source-1');
  assert.match(asset.objectKey, /^workspace-1\/canvas\/assets\//);
  assert.equal(repository.inspect()[0]?.sha256.length, 64);
});

test('rejects generated output and forged media bytes at the local-artifact seam', async () => {
  const { facade } = fixture();
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };

  await assert.rejects(
    facade.persistLocalCanvasArtifact(context, {
      bytes: png,
      contentType: 'image/png',
      derivation: 'generation' as 'crop',
      fileName: 'generated.png',
      parentAssetId: 'source-1',
    }),
    (error: unknown) =>
      error instanceof CanvasAssetError &&
      error.code === 'GENERATED_ASSET_REJECTED'
  );
  await assert.rejects(
    facade.persistLocalCanvasArtifact(context, {
      bytes: Uint8Array.from([1, 2, 3]),
      contentType: 'image/png',
      derivation: 'crop',
      fileName: 'forged.png',
      parentAssetId: 'source-1',
    }),
    (error: unknown) =>
      error instanceof CanvasAssetError && error.code === 'INVALID_MEDIA'
  );
});

test('lists and reads assets without leaking their existence across workspaces', async () => {
  const { facade } = fixture();
  const owner = { userId: 'user-1', workspaceId: 'workspace-1' };
  const asset = await facade.persistLocalCanvasArtifact(owner, {
    bytes: png,
    contentType: 'image/png',
    derivation: 'mask',
    fileName: 'mask.png',
    parentAssetId: 'source-1',
  });

  assert.equal((await facade.listAssets(owner)).length, 1);
  await assert.rejects(
    facade.getAsset({ userId: 'user-2', workspaceId: 'workspace-2' }, asset.id),
    (error: unknown) =>
      error instanceof CanvasAssetError && error.code === 'NOT_FOUND'
  );
});

test('hydrates legacy storageKey references to server asset IDs', async () => {
  const { facade, repository, storage } = fixture();
  await storage.put('workspace-1/canvas/assets/legacy.png', png);
  await repository.insert({
    id: 'asset-legacy',
    workspaceId: 'workspace-1',
    objectKey: 'workspace-1/canvas/assets/legacy.png',
    legacyStorageKey: 'image_files/legacy',
    sha256: 'a'.repeat(64),
    sizeBytes: png.byteLength,
    contentType: 'image/png',
    fileName: 'legacy.png',
    source: { kind: 'local_canvas_derivative', derivation: 'crop' },
    createdAt: '2026-07-16T08:00:00.000Z',
  });

  const hydrated = await facade.hydrateGraph('workspace-1', {
    schemaVersion: 1,
    nodes: [
      {
        id: 'image-1',
        type: 'image',
        data: { storageKey: 'image_files/legacy' },
      },
    ],
    edges: [],
  });

  assert.deepEqual(hydrated.nodes[0]?.data, { assetId: 'asset-legacy' });
});

test('serves private media with nosniff and bounded byte ranges', async () => {
  const { facade } = fixture();
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };
  const asset = await facade.persistLocalCanvasArtifact(context, {
    bytes: png,
    contentType: 'image/png',
    derivation: 'crop',
    fileName: 'crop.png',
    parentAssetId: 'source-1',
  });

  const delivery = await facade.getAssetDelivery(context, {
    assetId: asset.id,
    range: 'bytes=0-3',
  });
  assert.equal(delivery.status, 206);
  assert.equal(
    delivery.headers['content-range'],
    `bytes 0-3/${png.byteLength}`
  );
  assert.equal(delivery.headers['content-type'], 'image/png');
  assert.equal(delivery.headers['x-content-type-options'], 'nosniff');
  assert.equal(delivery.headers['cache-control'], 'private, no-store');
  assert.deepEqual([...delivery.body], [...png.slice(0, 4)]);
});
