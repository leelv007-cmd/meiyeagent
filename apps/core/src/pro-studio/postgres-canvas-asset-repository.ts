import type { Pool, QueryResultRow } from 'pg';
import type {
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
                   WHERE workspace_id = $1
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
