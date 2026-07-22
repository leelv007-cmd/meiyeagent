import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedAssetReceiptKey } from '@meiye/contracts';
import {
  decideSharedAssetCleanup,
  inspectSharedAsset,
  putImmutableSharedAsset,
  sha256Hex,
  SharedAssetPostWriteVerificationError,
  writeSharedAssetReceipt,
} from './shared-asset-receipt';
import type { R2BucketInterface } from './types';

const bytes = Uint8Array.from([137, 80, 78, 71]);
const objectKey = 'workspace-a/assets/user-a/asset.png';

function bucketWithObject() {
  const objects = new Map<
    string,
    {
      bytes: Uint8Array;
      contentType: string;
      customMetadata?: Record<string, string>;
    }
  >();
  objects.set(objectKey, {
    bytes,
    contentType: 'image/png',
    customMetadata: { sha256: 'a'.repeat(64) },
  });
  const bucket = {
    async put(
      key: string,
      value: string | ArrayBufferView,
      options?: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
        onlyIf?: Headers;
      }
    ) {
      if (options?.onlyIf?.get('if-none-match') === '*' && objects.has(key)) {
        return null;
      }
      objects.set(key, {
        bytes:
          typeof value === 'string'
            ? new TextEncoder().encode(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
        contentType:
          options?.httpMetadata?.contentType ?? 'application/octet-stream',
        customMetadata: options?.customMetadata,
      });
      return {};
    },
    async get(key: string) {
      const object = objects.get(key);
      return object
        ? {
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(Uint8Array.from(object.bytes));
                controller.close();
              },
            }),
            httpMetadata: { contentType: object.contentType },
          }
        : null;
    },
    async head(key: string) {
      const object = objects.get(key);
      return object
        ? {
            size: object.bytes.byteLength,
            httpMetadata: { contentType: object.contentType },
            customMetadata: object.customMetadata,
          }
        : null;
    },
  } as unknown as R2BucketInterface;
  return { bucket, objects };
}

test('writes the Core-readable receipt only after the R2 object is verified', async () => {
  const hash = await sha256Hex(bytes);
  const { bucket, objects } = bucketWithObject();
  objects.get(objectKey)!.customMetadata = { sha256: hash };

  const receipt = await writeSharedAssetReceipt({
    bucket,
    bytes,
    contentType: 'image/png',
    objectKey,
    sha256: hash,
  });
  const receiptKey = sharedAssetReceiptKey(
    await sha256Hex(new TextEncoder().encode(objectKey))
  );
  const stored = objects.get(receiptKey);
  assert.ok(stored);
  assert.equal(stored.contentType, 'application/json');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(stored.bytes)), receipt);
  assert.equal(receipt.objectKey, objectKey);
  assert.equal(receipt.sha256, hash);
  assert.deepEqual(
    await writeSharedAssetReceipt({
      bucket,
      bytes,
      contentType: 'image/png',
      objectKey,
      sha256: hash,
    }),
    receipt
  );
});

test('keeps the immutable R2 object when a matching writer repeats', async () => {
  const hash = await sha256Hex(bytes);
  const { bucket, objects } = bucketWithObject();
  objects.delete(objectKey);

  await putImmutableSharedAsset({
    bucket,
    bytes,
    contentType: 'image/png',
    objectKey,
    sha256: hash,
  });
  await putImmutableSharedAsset({
    bucket,
    bytes,
    contentType: 'image/png',
    objectKey,
    sha256: hash,
  });
  await assert.rejects(
    putImmutableSharedAsset({
      bucket,
      bytes: Uint8Array.from([...bytes, 0]),
      contentType: 'image/png',
      objectKey,
      sha256: await sha256Hex(Uint8Array.from([...bytes, 0])),
    }),
    /could not be verified/
  );
});

test('does not register a receipt when R2 metadata does not verify the upload', async () => {
  const { bucket, objects } = bucketWithObject();
  await assert.rejects(
    writeSharedAssetReceipt({
      bucket,
      bytes,
      contentType: 'image/png',
      objectKey,
      sha256: await sha256Hex(bytes),
    }),
    /could not be verified/
  );
  assert.equal(
    [...objects.keys()].some((key) => key.startsWith('_meiye-asset-receipts/')),
    false
  );
});

test('marks a post-PUT verification outage as recoverable cleanup work', async () => {
  const hash = await sha256Hex(bytes);
  const { bucket, objects } = bucketWithObject();
  objects.delete(objectKey);
  let heads = 0;
  const unavailableAfterWrite = {
    ...bucket,
    async head(key: string) {
      heads += 1;
      if (key === objectKey && heads === 2) {
        throw new Error('simulated verification timeout');
      }
      return bucket.head(key);
    },
  } as R2BucketInterface;

  await assert.rejects(
    putImmutableSharedAsset({
      bucket: unavailableAfterWrite,
      bytes,
      contentType: 'image/png',
      objectKey,
      sha256: hash,
    }),
    SharedAssetPostWriteVerificationError
  );
  assert.equal(objects.has(objectKey), true);
});

test('fences stale cleanup against a newer receipt and recovers sidecar-only deletion', () => {
  const receipt = {
    contentType: 'image/png',
    createdAt: '2026-07-22T00:00:00.000Z',
    objectKey,
    sha256: 'a'.repeat(64),
    sizeBytes: bytes.byteLength,
    storageRevision: 'revision-b',
  };
  assert.equal(
    decideSharedAssetCleanup(
      { objectExists: true, objectVerified: true, receipt },
      'revision-a',
    ),
    'preserve',
  );
  assert.equal(
    decideSharedAssetCleanup(
      { objectExists: true },
      'revision-a',
    ),
    'unknown',
  );
  assert.equal(
    decideSharedAssetCleanup(
      { objectExists: false, receipt: { ...receipt, storageRevision: 'revision-a' } },
      'revision-a',
    ),
    'delete',
  );
  assert.equal(
    decideSharedAssetCleanup(
      { objectExists: false, receipt },
      'revision-a',
    ),
    'unknown',
  );
  assert.equal(
    decideSharedAssetCleanup({ objectExists: false }, 'revision-a'),
    'deleted',
  );
});

test('requires a readable object body to verify a receipt generation', async () => {
  const hash = await sha256Hex(bytes);
  const { bucket, objects } = bucketWithObject();
  objects.get(objectKey)!.customMetadata = { sha256: hash };
  await writeSharedAssetReceipt({
    bucket,
    bytes,
    contentType: 'image/png',
    objectKey,
    sha256: hash,
  });
  assert.equal((await inspectSharedAsset(bucket, objectKey)).objectVerified, true);
  objects.set(objectKey, {
    bytes: Uint8Array.from([...bytes, 0]),
    contentType: 'image/png',
    customMetadata: { sha256: hash },
  });
  assert.equal((await inspectSharedAsset(bucket, objectKey)).objectVerified, false);
});

test('treats a receipt PUT success without a readable sidecar as registration failure', async () => {
  const hash = await sha256Hex(bytes);
  const { bucket, objects } = bucketWithObject();
  objects.get(objectKey)!.customMetadata = { sha256: hash };
  const receiptKey = sharedAssetReceiptKey(
    await sha256Hex(new TextEncoder().encode(objectKey)),
  );
  const unavailableReceiptWrite = {
    ...bucket,
    async put(key: string, value: string | ArrayBufferView, options?: Parameters<R2BucketInterface['put']>[2]) {
      if (key === receiptKey) return {};
      return bucket.put(key, value, options);
    },
  } as R2BucketInterface;
  await assert.rejects(
    writeSharedAssetReceipt({
      bucket: unavailableReceiptWrite,
      bytes,
      contentType: 'image/png',
      objectKey,
      sha256: hash,
    }),
    /did not expose the persisted receipt/,
  );
});
