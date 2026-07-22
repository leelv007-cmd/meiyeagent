import {
  sharedAssetReceiptKey,
  type SharedAssetStorageReceipt,
} from '@meiye/contracts';
import type { R2BucketInterface } from './types';

/** The conditional R2 PUT may have succeeded before verification became unavailable. */
export class SharedAssetPostWriteVerificationError extends Error {
  constructor(cause: unknown) {
    super(
      'Shared asset write completed but post-write verification was unavailable.',
      { cause }
    );
    this.name = 'SharedAssetPostWriteVerificationError';
  }
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export async function sharedAssetReceiptKeyForObject(objectKey: string) {
  return sharedAssetReceiptKey(
    await sha256Hex(new TextEncoder().encode(objectKey))
  );
}

export async function putImmutableSharedAsset(input: {
  bucket: R2BucketInterface;
  bytes: Uint8Array;
  contentType: string;
  objectKey: string;
  sha256: string;
  storageRevision?: string;
}) {
  const existing = await input.bucket.head(input.objectKey);
  if (existing) {
    assertStoredSharedAsset(existing, input);
    return;
  }
  let created: unknown;
  try {
    created = await input.bucket.put(input.objectKey, input.bytes, {
      customMetadata: {
        sha256: input.sha256,
        sharedAssetReceipt: 'v1',
        ...(input.storageRevision
          ? { storageRevision: input.storageRevision }
          : {}),
      },
      httpMetadata: { contentType: input.contentType },
      onlyIf: new Headers({ 'if-none-match': '*' }),
    });
  } catch (error) {
    throw new SharedAssetPostWriteVerificationError(error);
  }
  try {
    const stored = await input.bucket.head(input.objectKey);
    if (!stored) {
      throw new Error('Shared asset write did not expose an object.');
    }
    assertStoredSharedAsset(stored, input);
  } catch (error) {
    if (created !== null) {
      throw new SharedAssetPostWriteVerificationError(error);
    }
    throw error;
  }
}

export async function writeSharedAssetReceipt(input: {
  bucket: R2BucketInterface;
  bytes: Uint8Array;
  contentType: string;
  objectKey: string;
  sha256: string;
  storageRevision?: string;
}) {
  const stored = await input.bucket.head(input.objectKey);
  if (!stored) {
    throw new Error(
      'Shared asset write could not be verified before receipt registration.'
    );
  }
  assertStoredSharedAsset(stored, input);
  const key = await sharedAssetReceiptKeyForObject(input.objectKey);
  const existing = await readSharedAssetReceipt(input.bucket, key);
  if (existing) return assertSameReceipt(existing, input);
  const receipt: SharedAssetStorageReceipt = {
    contentType: input.contentType,
    createdAt: new Date().toISOString(),
    objectKey: input.objectKey,
    sha256: input.sha256,
    sizeBytes: input.bytes.byteLength,
    storageRevision: input.storageRevision ?? crypto.randomUUID(),
  };
  const created = await input.bucket.put(key, JSON.stringify(receipt), {
    httpMetadata: { contentType: 'application/json' },
    onlyIf: new Headers({ 'if-none-match': '*' }),
  });
  if (created === null) {
    const winner = await readSharedAssetReceipt(input.bucket, key);
    if (!winner) {
      throw new Error('Shared asset receipt write did not expose its winner.');
    }
    return assertSameReceipt(winner, input);
  }
  const persisted = await readSharedAssetReceipt(input.bucket, key);
  if (!persisted) {
    throw new Error('Shared asset receipt write did not expose the persisted receipt.');
  }
  return assertSameReceipt(persisted, input);
}

export interface SharedAssetObjectState {
  objectExists: boolean;
  /** The body, metadata, and immutable receipt agree for this exact object. */
  objectVerified?: boolean;
  receipt?: SharedAssetStorageReceipt;
}

/**
 * Decides cleanup from the complete two-key state. A present object without a
 * receipt is ambiguous and is never deleted by a stale outbox job.
 */
export function decideSharedAssetCleanup(
  state: SharedAssetObjectState,
  expectedStorageRevision: string,
): 'delete' | 'deleted' | 'preserve' | 'unknown' {
  if (!state.objectExists && !state.receipt) return 'deleted';
  if (!state.receipt) return 'unknown';
  if (!state.objectExists) {
    return state.receipt.storageRevision === expectedStorageRevision
      ? 'delete'
      : 'unknown';
  }
  if (state.objectVerified !== true) return 'unknown';
  if (state.receipt.storageRevision !== expectedStorageRevision) return 'preserve';
  return 'delete';
}

export async function inspectSharedAsset(
  bucket: R2BucketInterface,
  objectKey: string,
): Promise<SharedAssetObjectState> {
  const [object, receipt] = await Promise.all([
    bucket.head(objectKey),
    readSharedAssetReceiptForObject(bucket, objectKey),
  ]);
  if (!object || !receipt) {
    return { objectExists: Boolean(object), ...(receipt ? { receipt } : {}) };
  }
  const stored = await bucket.get(objectKey);
  if (!stored?.body) {
    return { objectExists: true, objectVerified: false, receipt };
  }
  const bytes = new Uint8Array(await new Response(stored.body).arrayBuffer());
  const objectVerified =
    stored.httpMetadata?.contentType === receipt.contentType &&
    bytes.byteLength === receipt.sizeBytes &&
    (await sha256Hex(bytes)) === receipt.sha256;
  return { objectExists: true, objectVerified, receipt };
}

export async function readSharedAssetReceiptForObject(
  bucket: R2BucketInterface,
  objectKey: string,
): Promise<SharedAssetStorageReceipt | undefined> {
  const receipt = await readSharedAssetReceipt(
    bucket,
    await sharedAssetReceiptKeyForObject(objectKey),
  );
  if (receipt && receipt.objectKey !== objectKey) {
    throw new Error('Shared asset receipt does not match its object key.');
  }
  return receipt;
}

function assertStoredSharedAsset(
  stored: {
    size?: number;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  },
  input: {
    bytes: Uint8Array;
    contentType: string;
    sha256: string;
  }
) {
  if (
    stored.size !== input.bytes.byteLength ||
    stored.httpMetadata?.contentType !== input.contentType ||
    stored.customMetadata?.sha256 !== input.sha256
  ) {
    throw new Error(
      'Shared asset write could not be verified before receipt registration.'
    );
  }
}

async function readSharedAssetReceipt(
  bucket: R2BucketInterface,
  key: string
): Promise<SharedAssetStorageReceipt | undefined> {
  const object = await bucket.get(key);
  if (!object) return undefined;
  if (object.httpMetadata?.contentType !== 'application/json' || !object.body) {
    throw new Error('Shared asset receipt is not valid JSON.');
  }
  let value: unknown;
  try {
    value = JSON.parse(await new Response(object.body).text());
  } catch {
    throw new Error('Shared asset receipt is not valid JSON.');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    typeof Reflect.get(value, 'contentType') !== 'string' ||
    typeof Reflect.get(value, 'createdAt') !== 'string' ||
    typeof Reflect.get(value, 'objectKey') !== 'string' ||
    typeof Reflect.get(value, 'sha256') !== 'string' ||
    typeof Reflect.get(value, 'sizeBytes') !== 'number' ||
    typeof Reflect.get(value, 'storageRevision') !== 'string'
  ) {
    throw new Error('Shared asset receipt is not valid JSON.');
  }
  const receipt = value as SharedAssetStorageReceipt;
  if (
    !Number.isSafeInteger(receipt.sizeBytes) ||
    receipt.sizeBytes < 0 ||
    !/^[a-f0-9]{64}$/u.test(receipt.sha256) ||
    !Number.isFinite(Date.parse(receipt.createdAt)) ||
    !receipt.storageRevision
  ) {
    throw new Error('Shared asset receipt is not valid JSON.');
  }
  return receipt;
}

function assertSameReceipt(
  receipt: SharedAssetStorageReceipt,
  input: {
    bytes: Uint8Array;
    contentType: string;
    objectKey: string;
    sha256: string;
  }
) {
  if (
    receipt.contentType !== input.contentType ||
    receipt.objectKey !== input.objectKey ||
    receipt.sha256 !== input.sha256 ||
    receipt.sizeBytes !== input.bytes.byteLength
  ) {
    throw new Error('Shared asset receipt conflicts with immutable bytes.');
  }
  return receipt;
}
