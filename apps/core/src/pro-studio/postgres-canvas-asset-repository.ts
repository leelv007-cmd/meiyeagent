import type { Pool, QueryResultRow } from 'pg';
import type {
  CanvasAssetDeletionOutboxRecord,
  CanvasAssetRepository,
  CanvasAssetSource,
  CanvasOwnedAsset,
} from './canvas-asset-facade.js';

interface AssetRow extends QueryResultRow {
  contentType: CanvasOwnedAsset['contentType'];
  createdAt: string;
  fileName: string;
  id: string;
  legacyStorageKey: string | null;
  objectKey: string;
  sha256: string;
  sizeBytes: string | number;
  source: CanvasAssetSource;
  workspaceId: string;
}

export class PostgresCanvasAssetRepository implements CanvasAssetRepository {
  constructor(private readonly pool: Pool) {}

  async insert(asset: CanvasOwnedAsset) {
    await this.pool.query(
      `INSERT INTO pro_studio_owned_assets
       (workspace_id,id,object_key,legacy_storage_key,sha256,size_bytes,
        content_type,file_name,source,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)`,
      [
        asset.workspaceId,
        asset.id,
        asset.objectKey,
        asset.legacyStorageKey ?? null,
        asset.sha256,
        asset.sizeBytes,
        asset.contentType,
        asset.fileName,
        JSON.stringify(asset.source),
        asset.createdAt,
      ]
    );
  }

  async tombstoneAndEnqueueDeletion(
    workspaceId: string,
    assetId: string,
    createdAt: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const asset = await client.query<{ object_key: string }>(
        `UPDATE pro_studio_owned_assets
            SET tombstoned_at = COALESCE(tombstoned_at, $3::timestamptz)
          WHERE workspace_id = $1 AND id = $2
        RETURNING object_key`,
        [workspaceId, assetId, createdAt],
      );
      const objectKey = asset.rows[0]?.object_key;
      if (!objectKey) {
        await client.query('ROLLBACK');
        return null;
      }
      const id = `canvas-asset-delete:${workspaceId}:${assetId}`;
      const deletion = await client.query<DeletionRow>(
        `INSERT INTO pro_studio_asset_deletion_outbox
           (id, workspace_id, asset_id, object_key, reason, status, created_at)
         VALUES ($1, $2, $3, $4, 'asset_delete', 'pending', $5::timestamptz)
         ON CONFLICT (workspace_id, asset_id) DO UPDATE
           SET object_key = EXCLUDED.object_key
       RETURNING *`,
        [id, workspaceId, assetId, objectKey, createdAt],
      );
      await client.query('COMMIT');
      return mapDeletion(deletion.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async enqueueOrphanDeletion(input: {
    assetId: string;
    createdAt: string;
    objectKey: string;
    workspaceId: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE pro_studio_owned_assets
            SET tombstoned_at = COALESCE(tombstoned_at, $4::timestamptz)
          WHERE workspace_id = $1 AND id = $2 AND object_key = $3`,
        [
          input.workspaceId,
          input.assetId,
          input.objectKey,
          input.createdAt,
        ],
      );
      const id = `canvas-asset-delete:${input.workspaceId}:${input.assetId}`;
      const deletion = await client.query<DeletionRow>(
        `INSERT INTO pro_studio_asset_deletion_outbox
           (id, workspace_id, asset_id, object_key, reason, status, created_at)
         VALUES ($1, $2, $3, $4, 'orphan_compensation', 'pending', $5::timestamptz)
         ON CONFLICT (workspace_id, asset_id) DO UPDATE
           SET object_key = EXCLUDED.object_key,
               reason = 'orphan_compensation',
               status = CASE
                 WHEN pro_studio_asset_deletion_outbox.status = 'completed'
                   THEN 'pending'
                 ELSE pro_studio_asset_deletion_outbox.status
               END,
               claim_token = CASE
                 WHEN pro_studio_asset_deletion_outbox.status = 'completed'
                   THEN NULL
                 ELSE pro_studio_asset_deletion_outbox.claim_token
               END,
               lease_expires_at = CASE
                 WHEN pro_studio_asset_deletion_outbox.status = 'completed'
                   THEN NULL
                 ELSE pro_studio_asset_deletion_outbox.lease_expires_at
               END,
               completed_at = CASE
                 WHEN pro_studio_asset_deletion_outbox.status = 'completed'
                   THEN NULL
                 ELSE pro_studio_asset_deletion_outbox.completed_at
               END
         RETURNING *`,
        [
          id,
          input.workspaceId,
          input.assetId,
          input.objectKey,
          input.createdAt,
        ],
      );
      await client.query('COMMIT');
      return mapDeletion(deletion.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimDeletion(input: {
    claimToken: string;
    leaseExpiresAt: string;
    now: string;
  }) {
    const result = await this.pool.query<DeletionRow>(
      `WITH candidate AS (
         SELECT id FROM pro_studio_asset_deletion_outbox
          WHERE status = 'pending'
             OR (status = 'claimed' AND lease_expires_at <= $1::timestamptz)
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE pro_studio_asset_deletion_outbox AS outbox
          SET status = 'claimed', claim_token = $2,
              lease_expires_at = $3::timestamptz
         FROM candidate WHERE outbox.id = candidate.id
       RETURNING outbox.*`,
      [input.now, input.claimToken, input.leaseExpiresAt],
    );
    return result.rows[0] ? mapDeletion(result.rows[0]) : null;
  }

  async completeDeletion(input: { claimToken: string; id: string }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const completed = await client.query<{
        asset_id: string;
        workspace_id: string;
      }>(
        `UPDATE pro_studio_asset_deletion_outbox
            SET status = 'completed', claim_token = NULL,
                lease_expires_at = NULL, completed_at = now()
          WHERE id = $1 AND status = 'claimed' AND claim_token = $2
        RETURNING workspace_id, asset_id`,
        [input.id, input.claimToken],
      );
      const row = completed.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `DELETE FROM pro_studio_owned_assets
          WHERE workspace_id = $1 AND id = $2 AND tombstoned_at IS NOT NULL`,
        [row.workspace_id, row.asset_id],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseDeletion(input: { claimToken: string; id: string }) {
    const result = await this.pool.query(
      `UPDATE pro_studio_asset_deletion_outbox
          SET status = 'pending', claim_token = NULL, lease_expires_at = NULL
        WHERE id = $1 AND status = 'claimed' AND claim_token = $2
      RETURNING id`,
      [input.id, input.claimToken],
    );
    return result.rowCount === 1;
  }

  async list(workspaceId: string) {
    const result = await this.pool.query<AssetRow>(
      `${combinedAssetSelect()} ORDER BY "createdAt", id`,
      [workspaceId]
    );
    return result.rows.map(mapAsset);
  }

  async get(workspaceId: string, assetId: string) {
    const result = await this.pool.query<AssetRow>(
      `${combinedAssetSelect()} AND id = $2 ORDER BY priority LIMIT 1`,
      [workspaceId, assetId]
    );
    return result.rows[0] ? mapAsset(result.rows[0]) : null;
  }

  async findByLegacyStorageKey(workspaceId: string, storageKey: string) {
    const result = await this.pool.query<AssetRow>(
      `${combinedAssetSelect()} AND "legacyStorageKey" = $2 ORDER BY priority LIMIT 1`,
      [workspaceId, storageKey]
    );
    return result.rows[0] ? mapAsset(result.rows[0]) : null;
  }
}

function combinedAssetSelect() {
  return `SELECT id, "workspaceId", "objectKey", "legacyStorageKey", sha256,
                 "sizeBytes", "contentType", "fileName", source, "createdAt",
                 priority
            FROM (
              SELECT DISTINCT ON (id)
                     id, "workspaceId", "objectKey", "legacyStorageKey", sha256,
                     "sizeBytes", "contentType", "fileName", source, "createdAt",
                     priority
                FROM (
                  SELECT id, workspace_id AS "workspaceId", object_key AS "objectKey",
                         legacy_storage_key AS "legacyStorageKey", sha256,
                         size_bytes AS "sizeBytes", content_type AS "contentType",
                         file_name AS "fileName", source,
                         created_at::text AS "createdAt", 0 AS priority
                  FROM pro_studio_owned_assets
                   WHERE workspace_id = $1 AND tombstoned_at IS NULL
                  UNION ALL
                  SELECT id, workspace_id AS "workspaceId", object_key AS "objectKey",
                         object_key AS "legacyStorageKey", sha256,
                         size_bytes AS "sizeBytes", media_type AS "contentType",
                         id AS "fileName",
                         jsonb_build_object('kind', 'product_asset', 'sourceAssetId', id) AS source,
                         created_at::text AS "createdAt", 1 AS priority
                    FROM p1_owned_assets
                   WHERE workspace_id = $1
                     AND media_type IN (
                       'image/jpeg', 'image/png', 'image/webp',
                       'video/mp4', 'audio/mpeg', 'audio/wav'
                     )
                ) AS merged_assets
               ORDER BY id, priority
            ) AS canvas_assets
           WHERE true`;
}

interface DeletionRow extends QueryResultRow {
  asset_id: string;
  claim_token: string | null;
  created_at: Date;
  id: string;
  lease_expires_at: Date | null;
  object_key: string;
  reason: CanvasAssetDeletionOutboxRecord['reason'];
  status: CanvasAssetDeletionOutboxRecord['status'];
  workspace_id: string;
}

function mapDeletion(row: DeletionRow): CanvasAssetDeletionOutboxRecord {
  return {
    assetId: row.asset_id,
    ...(row.claim_token ? { claimToken: row.claim_token } : {}),
    createdAt: row.created_at.toISOString(),
    id: row.id,
    ...(row.lease_expires_at
      ? { leaseExpiresAt: row.lease_expires_at.toISOString() }
      : {}),
    objectKey: row.object_key,
    reason: row.reason,
    status: row.status,
    workspaceId: row.workspace_id,
  };
}

function mapAsset(row: AssetRow): CanvasOwnedAsset {
  return {
    contentType: row.contentType,
    createdAt: row.createdAt,
    fileName: row.fileName,
    id: row.id,
    ...(row.legacyStorageKey ? { legacyStorageKey: row.legacyStorageKey } : {}),
    objectKey: row.objectKey,
    sha256: row.sha256,
    sizeBytes: Number(row.sizeBytes),
    source: row.source,
    workspaceId: row.workspaceId,
  };
}
