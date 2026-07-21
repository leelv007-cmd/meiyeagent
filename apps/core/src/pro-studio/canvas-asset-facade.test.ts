import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CanvasAssetError,
  CanvasAssetDeletionWorker,
  CanvasAssetFacade,
  CanvasAssetPersistenceError,
  MemoryCanvasAssetRepository,
  MemoryCanvasObjectStorage,
} from './canvas-asset-facade.js';
import { MemoryProStudioAccessAudit } from './security-access-audit.js';

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

function fixture() {
  let id = 0;
  const repository = new MemoryCanvasAssetRepository();
  const storage = new MemoryCanvasObjectStorage();
  const accessAudit = new MemoryProStudioAccessAudit(
    () => new Date('2026-07-16T08:00:00.000Z')
  );
  const facade = new CanvasAssetFacade({
    accessAudit,
    repository,
    storage,
    clock: () => new Date('2026-07-16T08:00:00.000Z'),
    nextId: () => `asset-${++id}`,
  });
  return { accessAudit, facade, repository, storage };
}

test('persists a verified local derivative as a workspace-owned asset', async () => {
  const { facade, repository } = fixture();
  await repository.insert({
    id: 'source-1',
    workspaceId: 'workspace-1',
    objectKey: 'workspace-1/canvas/assets/source-1.png',
    sha256: 'a'.repeat(64),
    sizeBytes: png.byteLength,
    contentType: 'image/png',
    fileName: 'source.png',
    source: { kind: 'local_import' },
    createdAt: '2026-07-16T07:00:00.000Z',
  });
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

test('records parentless retouch uploads as original imports instead of derivatives', async () => {
  const { facade } = fixture();

  const asset = await facade.persistLocalCanvasArtifact(
    { userId: 'user-1', workspaceId: 'workspace-1' },
    {
      bytes: png,
      contentType: 'image/png',
      derivation: 'retouch',
      fileName: 'original.png',
    }
  );

  assert.deepEqual(asset.source, { kind: 'local_import' });
});

test('removes uploaded bytes when the asset record cannot be committed', async () => {
  const storage = new MemoryCanvasObjectStorage();
  const facade = new CanvasAssetFacade({
    repository: {
      claimDeletion: async () => null,
      completeDeletion: async () => false,
      enqueueOrphanDeletion: async () => {
        throw new Error('unexpected orphan recovery');
      },
      findByLegacyStorageKey: async () => null,
      get: async () => null,
      insert: async () => {
        throw new Error('database unavailable');
      },
      list: async () => [],
      releaseDeletion: async () => false,
      tombstoneAndEnqueueDeletion: async () => null,
    },
    storage,
    nextId: () => 'asset-orphan',
  });

  await assert.rejects(
    facade.persistLocalCanvasArtifact(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      {
        bytes: png,
        contentType: 'image/png',
        derivation: 'retouch',
        fileName: 'orphan.png',
      },
    ),
    /database unavailable/,
  );
  assert.equal(
    await storage.read('workspace-1/canvas/assets/asset-orphan.png'),
    null,
  );
  await storage.delete('workspace-1/canvas/assets/asset-orphan.png');
});

test('durably queues an orphan delete when metadata insertion and immediate cleanup both fail', async () => {
  class FailingRepository extends MemoryCanvasAssetRepository {
    override async insert() {
      throw new Error('metadata persistence unavailable');
    }
  }
  class FailingOnceStorage extends MemoryCanvasObjectStorage {
    private deleteAttempts = 0;

    override async delete(objectKey: string) {
      this.deleteAttempts += 1;
      if (this.deleteAttempts === 1) {
        throw new Error('immediate object cleanup unavailable');
      }
      return super.delete(objectKey);
    }
  }

  const repository = new FailingRepository();
  const storage = new FailingOnceStorage();
  const facade = new CanvasAssetFacade({
    repository,
    storage,
    nextId: () => 'asset-orphan-recovery',
  });
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };

  await assert.rejects(
    facade.persistLocalCanvasArtifact(context, {
      bytes: png,
      contentType: 'image/png',
      derivation: 'retouch',
      fileName: 'orphan-recovery.png',
    }),
    (error: unknown) =>
      error instanceof CanvasAssetPersistenceError &&
      error.recoveryQueued === true
  );

  const worker = new CanvasAssetDeletionWorker({
    claimToken: () => 'orphan-claim-1',
    repository,
    storage,
  });
  assert.deepEqual(await worker.runOnce(), {
    assetId: 'asset-orphan-recovery',
    status: 'completed',
  });
  assert.equal(
    await storage.read(
      'workspace-1/canvas/assets/asset-orphan-recovery.png'
    ),
    null
  );
});

test('rejects derivative parents that are unknown or belong to another workspace', async () => {
  const { facade, repository } = fixture();
  await repository.insert({
    id: 'foreign-parent',
    workspaceId: 'workspace-2',
    objectKey: 'workspace-2/canvas/assets/foreign-parent.png',
    sha256: 'b'.repeat(64),
    sizeBytes: png.byteLength,
    contentType: 'image/png',
    fileName: 'foreign.png',
    source: { kind: 'local_import' },
    createdAt: '2026-07-16T07:00:00.000Z',
  });
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };

  for (const parentAssetId of ['missing-parent', 'foreign-parent']) {
    await assert.rejects(
      facade.persistLocalCanvasArtifact(context, {
        bytes: png,
        contentType: 'image/png',
        derivation: 'crop',
        fileName: 'crop.png',
        parentAssetId,
      }),
      (error: unknown) =>
        error instanceof CanvasAssetError && error.code === 'NOT_FOUND'
    );
  }
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
  const { accessAudit, facade } = fixture();
  const owner = { userId: 'user-1', workspaceId: 'workspace-1' };
  const asset = await facade.persistLocalCanvasArtifact(owner, {
    bytes: png,
    contentType: 'image/png',
    derivation: 'retouch',
    fileName: 'original.png',
  });

  assert.equal((await facade.listAssets(owner)).length, 1);
  await assert.rejects(
    facade.getAsset({ userId: 'user-2', workspaceId: 'workspace-2' }, asset.id),
    (error: unknown) =>
      error instanceof CanvasAssetError && error.code === 'NOT_FOUND'
  );
  assert.equal(accessAudit.byKind('asset')[0]?.action, 'asset_access_denied');
  assert.equal(accessAudit.byKind('asset')[0]?.objectId, asset.id);
  assert.equal(accessAudit.byKind('asset')[0]?.workspaceId, 'workspace-2');
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
    source: { kind: 'local_import' },
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
    derivation: 'retouch',
    fileName: 'original.png',
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

test('tombstones an asset immediately and deletes its object through an idempotent outbox worker', async () => {
  const { facade, repository, storage } = fixture();
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };
  const asset = await facade.persistLocalCanvasArtifact(context, {
    bytes: png,
    contentType: 'image/png',
    derivation: 'retouch',
    fileName: 'delete-me.png',
  });

  await facade.deleteAsset(context, asset.id);
  await assert.rejects(facade.getAsset(context, asset.id), /not found/i);
  assert.equal(await storage.read(asset.objectKey) !== null, true);

  const worker = new CanvasAssetDeletionWorker({
    claimToken: () => 'delete-claim-1',
    clock: () => new Date('2026-07-16T09:00:00.000Z'),
    repository,
    storage,
  });
  assert.deepEqual(await worker.runOnce(), {
    assetId: asset.id,
    status: 'completed',
  });
  assert.equal(await storage.read(asset.objectKey), null);
  assert.deepEqual(await worker.runOnce(), { status: 'idle' });
  await storage.delete(asset.objectKey);
});
