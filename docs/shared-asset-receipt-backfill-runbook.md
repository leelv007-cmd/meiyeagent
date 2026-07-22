# Shared asset receipt backfill

Readers never create receipt sidecars. Historical S3/R2 objects become readable
only through this explicit, reviewed migration.

Prepare a JSON manifest from a frozen, trusted database export. Each record must
include all of the following exact facts: `workspaceId`, `source`,
`sourceRecordId`, `objectKey`, `contentType`, `sizeBytes`, `sha256`,
`createdAt`, and `storageRevision`.

Supported sources are:

- `product_asset` for ProductAsset media rows;
- `content_package_media` for ContentPackage owned media rows; and
- `content_package_export` for ContentPackage ZIP delivery rows.

Missing source facts, duplicate keys with conflicting byte proof, unsupported
content types, cross-workspace keys, and any object that no longer matches its
manifest hash/size/content type fail before a receipt is written. The command
does not scan or infer database records.

First run a dry run against the target S3/R2 bucket:

```sh
P1_ASSET_STORAGE_MODE=s3 \
P1_ASSET_RECEIPT_BACKFILL_MANIFEST=/absolute/path/receipts.json \
P1_ASSET_RECEIPT_BACKFILL_DRY_RUN=1 \
pnpm --filter @meiye/core assets:backfill-receipts
```

After review, rerun with the explicit apply flag:

```sh
P1_ASSET_STORAGE_MODE=s3 \
P1_ASSET_RECEIPT_BACKFILL_MANIFEST=/absolute/path/receipts.json \
P1_ASSET_RECEIPT_BACKFILL_APPLY=1 \
pnpm --filter @meiye/core assets:backfill-receipts
```

The command refuses an omitted mode or both flags. It is idempotent: an
existing sidecar is accepted only when every receipt fact, including creation
time and storage revision, matches the manifest. Keep the reviewed manifest
with the migration evidence; it is the source of truth for any later audit.
