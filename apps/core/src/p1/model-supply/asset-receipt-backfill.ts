import type { AssetStorageReceipt, S3CompatibleAssetStorage } from './s3-asset-storage.js';

export type TrustedAssetReceiptBackfillSource =
  | 'content_package_export'
  | 'content_package_media'
  | 'product_asset';

export interface TrustedAssetReceiptBackfillRecord extends AssetStorageReceipt {
  source: TrustedAssetReceiptBackfillSource;
  sourceRecordId: string;
  workspaceId: string;
}

export interface TrustedAssetReceiptBackfillManifest {
  records: TrustedAssetReceiptBackfillRecord[];
  version: 1;
}

export interface TrustedAssetReceiptBackfillSummary {
  alreadyPresent: number;
  created: number;
  dryRun: boolean;
  total: number;
  wouldCreate: number;
}

/**
 * The CLI requires an affirmative mode selection so an omitted shell variable
 * cannot turn a verification run into a shared-storage write.
 */
export function resolveTrustedAssetReceiptBackfillMode(env: NodeJS.ProcessEnv): {
  dryRun: boolean;
} {
  const dryRun = env.P1_ASSET_RECEIPT_BACKFILL_DRY_RUN === '1';
  const apply = env.P1_ASSET_RECEIPT_BACKFILL_APPLY === '1';
  if (dryRun === apply) {
    throw new Error(
      'Set exactly one of P1_ASSET_RECEIPT_BACKFILL_DRY_RUN=1 or P1_ASSET_RECEIPT_BACKFILL_APPLY=1.',
    );
  }
  return { dryRun };
}

/**
 * Parses the operator-reviewed DB manifest before any storage call. A record
 * without exact identity, byte proof, and source DB identity is not trusted.
 */
export function parseTrustedAssetReceiptBackfillManifest(
  value: unknown,
): TrustedAssetReceiptBackfillManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('Trusted asset receipt backfill manifest must be an object.');
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.version !== 1 || !Array.isArray(manifest.records)) {
    throw new Error('Trusted asset receipt backfill manifest must have version 1 records.');
  }

  const records = manifest.records.map((record, index) =>
    parseTrustedRecord(record, index),
  );
  const receiptsByObjectKey = new Map<string, TrustedAssetReceiptBackfillRecord>();
  for (const record of records) {
    const previous = receiptsByObjectKey.get(record.objectKey);
    if (previous && !sameObjectProof(previous, record)) {
      throw new Error(
        `Trusted receipt backfill manifest is ambiguous for ${record.objectKey}.`,
      );
    }
    if (!previous) receiptsByObjectKey.set(record.objectKey, record);
  }
  return { records: [...receiptsByObjectKey.values()], version: 1 };
}

export async function backfillTrustedAssetReceipts(
  storage: S3CompatibleAssetStorage,
  manifest: TrustedAssetReceiptBackfillManifest,
  options: { dryRun?: boolean } = { dryRun: true },
): Promise<TrustedAssetReceiptBackfillSummary> {
  const dryRun = options.dryRun !== false;
  const summary: TrustedAssetReceiptBackfillSummary = {
    alreadyPresent: 0,
    created: 0,
    dryRun,
    total: manifest.records.length,
    wouldCreate: 0,
  };
  for (const record of manifest.records) {
    const outcome = await storage.backfillVerifiedReceipt(record, { dryRun });
    if (outcome === 'already_present') summary.alreadyPresent += 1;
    if (outcome === 'created') summary.created += 1;
    if (outcome === 'would_create') summary.wouldCreate += 1;
  }
  return summary;
}

function parseTrustedRecord(
  value: unknown,
  index: number,
): TrustedAssetReceiptBackfillRecord {
  if (!value || typeof value !== 'object') {
    throw new Error(`Trusted receipt backfill record ${index} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const source = record.source;
  if (
    source !== 'content_package_export' &&
    source !== 'content_package_media' &&
    source !== 'product_asset'
  ) {
    throw new Error(`Trusted receipt backfill record ${index} has an invalid source.`);
  }
  const strings = [
    'contentType',
    'createdAt',
    'objectKey',
    'sha256',
    'sourceRecordId',
    'storageRevision',
    'workspaceId',
  ] as const;
  for (const name of strings) {
    if (typeof record[name] !== 'string' || !record[name].trim()) {
      throw new Error(`Trusted receipt backfill record ${index} is missing ${name}.`);
    }
  }
  if (
    typeof record.sizeBytes !== 'number' ||
    !Number.isSafeInteger(record.sizeBytes) ||
    record.sizeBytes < 0
  ) {
    throw new Error(`Trusted receipt backfill record ${index} has an invalid sizeBytes.`);
  }
  if (!/^[a-f0-9]{64}$/u.test(record.sha256 as string)) {
    throw new Error(`Trusted receipt backfill record ${index} has an invalid sha256.`);
  }
  if (!Number.isFinite(Date.parse(record.createdAt as string))) {
    throw new Error(`Trusted receipt backfill record ${index} has an invalid createdAt.`);
  }
  if (!(record.objectKey as string).startsWith(`${record.workspaceId}/`)) {
    throw new Error(`Trusted receipt backfill record ${index} is not workspace-owned.`);
  }
  assertSourceContentType(source, record.contentType as string, index);
  return {
    contentType: record.contentType as string,
    createdAt: record.createdAt as string,
    objectKey: record.objectKey as string,
    sha256: record.sha256 as string,
    sizeBytes: record.sizeBytes,
    source,
    sourceRecordId: record.sourceRecordId as string,
    storageRevision: record.storageRevision as string,
    workspaceId: record.workspaceId as string,
  };
}

function assertSourceContentType(
  source: TrustedAssetReceiptBackfillSource,
  contentType: string,
  index: number,
) {
  if (source === 'content_package_export' && contentType !== 'application/zip') {
    throw new Error(`Trusted receipt backfill record ${index} export must be application/zip.`);
  }
  if (
    source === 'product_asset' &&
    !['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'].includes(
      contentType,
    )
  ) {
    throw new Error(`Trusted receipt backfill record ${index} has an invalid ProductAsset type.`);
  }
  if (
    source === 'content_package_media' &&
    ![
      'audio/mpeg',
      'audio/mp4',
      'audio/ogg',
      'audio/wav',
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
    ].includes(contentType)
  ) {
    throw new Error(`Trusted receipt backfill record ${index} has an invalid ContentPackage media type.`);
  }
}

function sameObjectProof(
  left: TrustedAssetReceiptBackfillRecord,
  right: TrustedAssetReceiptBackfillRecord,
) {
  return (
    left.contentType === right.contentType &&
    left.createdAt === right.createdAt &&
    left.sha256 === right.sha256 &&
    left.sizeBytes === right.sizeBytes &&
    left.source === right.source &&
    left.sourceRecordId === right.sourceRecordId &&
    left.storageRevision === right.storageRevision &&
    left.workspaceId === right.workspaceId
  );
}
