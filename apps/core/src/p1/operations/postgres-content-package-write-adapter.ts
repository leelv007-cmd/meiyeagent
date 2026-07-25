import type { QueryResult, QueryResultRow } from 'pg';
import { validateContentPackageSemanticWrite } from './content-package-semantic-mutation-policy.js';

export interface ContentPackageSqlClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface ContentPackageRowWrite {
  id: string;
  payload: unknown;
  revision: number;
  updatedAt: string;
  workspaceId: string;
}

export async function insertContentPackageRow(
  client: ContentPackageSqlClient,
  row: ContentPackageRowWrite,
) {
  const next = validateContentPackageSemanticWrite({
    next: row.payload,
    persistedRevision: row.revision,
  });
  const result = await client.query(
    `INSERT INTO p1_content_packages
       (workspace_id, id, payload, revision, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)
     ON CONFLICT (workspace_id, id) DO NOTHING`,
    [
      row.workspaceId,
      row.id,
      JSON.stringify(next),
      row.revision,
      row.updatedAt,
    ],
  );
  return result.rowCount === 1;
}

export async function updateContentPackageRow(
  client: ContentPackageSqlClient,
  row: ContentPackageRowWrite & { expectedRevision: number },
) {
  const next = validateContentPackageSemanticWrite({
    expectedRevision: row.expectedRevision,
    next: row.payload,
    persistedRevision: row.revision,
  });
  const result = await client.query(
    `UPDATE p1_content_packages
        SET payload = $4::jsonb,
            revision = $3,
            updated_at = $5::timestamptz
      WHERE workspace_id = $1
        AND id = $2
        AND revision = $6`,
    [
      row.workspaceId,
      row.id,
      row.revision,
      JSON.stringify(next),
      row.updatedAt,
      row.expectedRevision,
    ],
  );
  return result.rowCount === 1;
}

export async function installContentPackageWriteBoundary(
  client: ContentPackageSqlClient,
) {
  await client.query(`
    UPDATE p1_content_packages
       SET payload = jsonb_set(payload, '{revision}', '0'::jsonb, true)
     WHERE payload->'revision' IS NULL;
    UPDATE p1_content_packages
       SET revision = (payload->>'revision')::bigint
     WHERE revision IS NULL;
    REVOKE INSERT, UPDATE, DELETE ON p1_content_packages FROM PUBLIC;
  `);
}
