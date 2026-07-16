export function canvasOwnedAssetVersionUnionSql(
  workspacePlaceholder: '$1' | '$2' | '$7',
) {
  return `SELECT DISTINCT ON (id) id, source_kind, sha256
            FROM (
              SELECT id, 'pro_studio'::text AS source_kind, sha256, 0 AS priority
                FROM pro_studio_owned_assets
               WHERE workspace_id = ${workspacePlaceholder}
              UNION ALL
              SELECT id, 'product'::text AS source_kind, sha256, 1 AS priority
                FROM p1_owned_assets
               WHERE workspace_id = ${workspacePlaceholder}
            ) AS candidates
           ORDER BY id, priority`;
}
