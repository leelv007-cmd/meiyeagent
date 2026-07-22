import { readFile } from 'node:fs/promises';
import { modelAssetStorageFromEnv } from './asset-storage-from-env.js';
import {
  backfillTrustedAssetReceipts,
  parseTrustedAssetReceiptBackfillManifest,
  resolveTrustedAssetReceiptBackfillMode,
} from './asset-receipt-backfill.js';
import { S3CompatibleAssetStorage } from './s3-asset-storage.js';

const manifestPath = process.env.P1_ASSET_RECEIPT_BACKFILL_MANIFEST;
if (!manifestPath) {
  throw new Error('P1_ASSET_RECEIPT_BACKFILL_MANIFEST is required.');
}
const storage = modelAssetStorageFromEnv(process.env);
if (!(storage instanceof S3CompatibleAssetStorage)) {
  throw new Error('Trusted receipt backfill requires P1_ASSET_STORAGE_MODE=s3.');
}
const manifest = parseTrustedAssetReceiptBackfillManifest(
  JSON.parse(await readFile(manifestPath, 'utf8')),
);
const summary = await backfillTrustedAssetReceipts(storage, manifest, {
  ...resolveTrustedAssetReceiptBackfillMode(process.env),
});
process.stdout.write(`${JSON.stringify(summary)}\n`);
