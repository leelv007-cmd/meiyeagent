import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sharedAssetReceiptKey } from '@meiye/contracts';
import {
  backfillTrustedAssetReceipts,
  parseTrustedAssetReceiptBackfillManifest,
  resolveTrustedAssetReceiptBackfillMode,
} from './asset-receipt-backfill.js';
import {
  S3CompatibleAssetStorage,
  type SharedObjectClient,
} from './s3-asset-storage.js';

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function receiptKey(objectKey: string) {
  return sharedAssetReceiptKey(sha256(new TextEncoder().encode(objectKey)));
}

function memoryClient(
  objects: Map<string, { bytes: Uint8Array; contentType: string }>,
): SharedObjectClient {
  return {
    async delete(key) {
      objects.delete(key);
    },
    async get(key) {
      const value = objects.get(key);
      return value
        ? { bytes: Uint8Array.from(value.bytes), contentType: value.contentType }
        : null;
    },
    async head(key) {
      const value = objects.get(key);
      return value
        ? { contentType: value.contentType, sizeBytes: value.bytes.byteLength }
        : null;
    },
    async put(key, bytes, contentType) {
      objects.set(key, { bytes: Uint8Array.from(bytes), contentType });
    },
    async putIfAbsent(key, bytes, contentType) {
      if (objects.has(key)) return false;
      objects.set(key, { bytes: Uint8Array.from(bytes), contentType });
      return true;
    },
  };
}

test('trusted manifest backfills ProductAsset and ContentPackage media/ZIP only after dry-run verification', async (t) => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'meiye-receipt-backfill-'));
  t.after(() => rm(cacheDirectory, { force: true, recursive: true }));
  const product = Uint8Array.from([1, 2, 3]);
  const media = Uint8Array.from([4, 5, 6]);
  const archive = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
  const productKey = `workspace-a/assets/user-a/${sha256(product)}.png`;
  const mediaKey = `workspace-a/generated/${sha256(media)}.mp4`;
  const archiveKey = `workspace-a/generated/${sha256(archive)}.zip`;
  objects.set(productKey, { bytes: product, contentType: 'image/png' });
  objects.set(mediaKey, { bytes: media, contentType: 'video/mp4' });
  objects.set(archiveKey, { bytes: archive, contentType: 'application/zip' });
  const manifest = parseTrustedAssetReceiptBackfillManifest({
    records: [
      {
        contentType: 'image/png',
        createdAt: '2026-07-22T00:00:00.000Z',
        objectKey: productKey,
        sha256: sha256(product),
        sizeBytes: product.byteLength,
        source: 'product_asset',
        sourceRecordId: 'user_files:product-a',
        storageRevision: 'migration-2026-07-22-product-a',
        workspaceId: 'workspace-a',
      },
      {
        contentType: 'video/mp4',
        createdAt: '2026-07-22T00:00:01.000Z',
        objectKey: mediaKey,
        sha256: sha256(media),
        sizeBytes: media.byteLength,
        source: 'content_package_media',
        sourceRecordId: 'content-package:media-a',
        storageRevision: 'migration-2026-07-22-media-a',
        workspaceId: 'workspace-a',
      },
      {
        contentType: 'application/zip',
        createdAt: '2026-07-22T00:00:02.000Z',
        objectKey: archiveKey,
        sha256: sha256(archive),
        sizeBytes: archive.byteLength,
        source: 'content_package_export',
        sourceRecordId: 'content-package:export-a',
        storageRevision: 'migration-2026-07-22-export-a',
        workspaceId: 'workspace-a',
      },
    ],
    version: 1,
  });
  const storage = new S3CompatibleAssetStorage({
    cacheDirectory,
    client: memoryClient(objects),
  });

  assert.deepEqual(
    await backfillTrustedAssetReceipts(storage, manifest, { dryRun: true }),
    { alreadyPresent: 0, created: 0, dryRun: true, total: 3, wouldCreate: 3 },
  );
  assert.equal(objects.has(receiptKey(productKey)), false);

  assert.deepEqual(await backfillTrustedAssetReceipts(storage, manifest), {
    alreadyPresent: 0,
    created: 0,
    dryRun: true,
    total: 3,
    wouldCreate: 3,
  });
  assert.deepEqual(await backfillTrustedAssetReceipts(storage, manifest, { dryRun: false }), {
    alreadyPresent: 0,
    created: 3,
    dryRun: false,
    total: 3,
    wouldCreate: 0,
  });
  assert.deepEqual((await storage.read(productKey)).bytes, product);
  assert.deepEqual((await storage.read(mediaKey)).bytes, media);
  assert.deepEqual((await storage.read(archiveKey)).bytes, archive);
  assert.deepEqual(await backfillTrustedAssetReceipts(storage, manifest, { dryRun: false }), {
    alreadyPresent: 3,
    created: 0,
    dryRun: false,
    total: 3,
    wouldCreate: 0,
  });
  await assert.rejects(
    backfillTrustedAssetReceipts(
      storage,
      {
        ...manifest,
        records: [
          {
            ...manifest.records[0]!,
            storageRevision: 'conflicting-migration-revision',
          },
        ],
      },
      { dryRun: false },
    ),
    /trusted migration truth/,
  );
});

test('backfill mode requires an explicit dry run or apply selection', () => {
  assert.deepEqual(
    resolveTrustedAssetReceiptBackfillMode({ P1_ASSET_RECEIPT_BACKFILL_DRY_RUN: '1' }),
    { dryRun: true },
  );
  assert.deepEqual(
    resolveTrustedAssetReceiptBackfillMode({ P1_ASSET_RECEIPT_BACKFILL_APPLY: '1' }),
    { dryRun: false },
  );
  assert.throws(() => resolveTrustedAssetReceiptBackfillMode({}), /exactly one/);
  assert.throws(
    () =>
      resolveTrustedAssetReceiptBackfillMode({
        P1_ASSET_RECEIPT_BACKFILL_APPLY: '1',
        P1_ASSET_RECEIPT_BACKFILL_DRY_RUN: '1',
      }),
    /exactly one/,
  );
});

test('trusted manifest rejects ambiguous or incomplete DB truth before writing sidecars', async () => {
  const objectKey = 'workspace-a/assets/user-a/abc.png';
  const receipt = {
    contentType: 'image/png',
    createdAt: '2026-07-22T00:00:00.000Z',
    objectKey,
    sha256: 'a'.repeat(64),
    sizeBytes: 3,
    source: 'product_asset' as const,
    sourceRecordId: 'user_files:a',
    storageRevision: 'migration-a',
    workspaceId: 'workspace-a',
  };
  assert.throws(
    () =>
      parseTrustedAssetReceiptBackfillManifest({
        records: [receipt, { ...receipt, sha256: 'b'.repeat(64) }],
        version: 1,
      }),
    /ambiguous/,
  );
  assert.throws(
    () =>
      parseTrustedAssetReceiptBackfillManifest({
        records: [
          receipt,
          {
            ...receipt,
            source: 'content_package_media',
            sourceRecordId: 'content-package:media-a',
          },
        ],
        version: 1,
      }),
    /ambiguous/,
  );
  assert.throws(
    () =>
      parseTrustedAssetReceiptBackfillManifest({
        records: [{ ...receipt, sourceRecordId: '' }],
        version: 1,
      }),
    /sourceRecordId/,
  );
});
