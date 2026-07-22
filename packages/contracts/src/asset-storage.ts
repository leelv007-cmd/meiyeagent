export const SHARED_ASSET_RECEIPT_PREFIX = '_meiye-asset-receipts/';
const sharedPublicAssetObjectKeyPattern =
  /^[A-Za-z0-9._-]+\/(?:(?:generated|owned)\/[a-f0-9]{64}\.(?:jpg|png|webp|mp4|m4a|zip|mp3|ogg|wav)|composed\/[a-f0-9]{64}\.(?:png|mp4)|canvas\/assets\/[A-Za-z0-9._-]+\.(?:jpg|png|webp|mp4|mp3|wav))$/;
const sharedProductAssetObjectKeyPattern =
  /^[A-Za-z0-9._-]+\/assets\/[A-Za-z0-9._-]+\/[a-f0-9]{64}\.(?:jpg|png|webp|mp4|webm)$/;
const legacyProductAssetObjectKeyPattern =
  /^[A-Za-z0-9._-]+\/assets\/(?:[A-Za-z0-9._-]+\/)?[^/\\]+\.(?:jpg|jpeg|png|webp|mp4|webm)$/u;

export interface SharedAssetStorageReceipt {
  contentType: string;
  createdAt: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  storageRevision: string;
}

export function sharedAssetReceiptKey(objectKeySha256: string) {
  if (!/^[a-f0-9]{64}$/u.test(objectKeySha256)) {
    throw new Error('Shared asset receipt keys require an object-key SHA-256.');
  }
  return `${SHARED_ASSET_RECEIPT_PREFIX}${objectKeySha256}.json`;
}

/**
 * Canonical PostgreSQL advisory-lock identity for one shared object. The
 * workspace prefix is part of the storage authorization boundary, so reject a
 * cross-workspace key before it can become a lock target.
 */
export function sharedAssetObjectLockKey(workspaceId: string, objectKey: string) {
  if (!workspaceId || !objectKey.startsWith(`${workspaceId}/`)) {
    throw new Error('Shared asset object lock key requires a workspace-owned object.');
  }
  return `meiye-owned-asset:${workspaceId}:${objectKey}`;
}

export function isSharedPublicAssetObjectKey(objectKey: string) {
  return sharedPublicAssetObjectKeyPattern.test(objectKey);
}

/** Public Core/Web allowlist, including the narrow ProductAsset legacy shape. */
export function isSharedWorkspaceAssetObjectKey(objectKey: string) {
  return (
    isSharedPublicAssetObjectKey(objectKey) ||
    sharedProductAssetObjectKeyPattern.test(objectKey) ||
    legacyProductAssetObjectKeyPattern.test(objectKey)
  );
}
