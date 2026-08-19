import type { Pool, PoolClient } from 'pg';

export type ContentPackageWriteOwner = 'legacy' | 'frozen' | 'contentpackage';

export interface ContentPackageWriteOwnershipPort {
  get(workspaceId: string): Promise<ContentPackageWriteOwner | null>;
  set(workspaceId: string, owner: ContentPackageWriteOwner): Promise<void>;
}

export class MemoryContentPackageWriteOwnership
  implements ContentPackageWriteOwnershipPort
{
  private readonly owners = new Map<string, ContentPackageWriteOwner>();

  async get(workspaceId: string) {
    return this.owners.get(workspaceId) ?? null;
  }

  async set(workspaceId: string, owner: ContentPackageWriteOwner) {
    this.owners.set(workspaceId, owner);
  }
}

export class PostgresContentPackageWriteOwnership
  implements ContentPackageWriteOwnershipPort
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      SELECT pg_advisory_xact_lock(5570743275655394900);
      CREATE TABLE IF NOT EXISTS content_package_write_ownership (
        workspace_id text PRIMARY KEY,
        owner text NOT NULL CHECK (owner IN ('legacy', 'frozen', 'contentpackage')),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS content_package_write_ownership_migrations (
        id text PRIMARY KEY,
        completed_at timestamptz NOT NULL DEFAULT now()
      );
      WITH claimed_baseline AS (
        INSERT INTO content_package_write_ownership_migrations (id)
        VALUES ('legacy-baseline-v1')
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      INSERT INTO content_package_write_ownership (workspace_id, owner)
      SELECT workspaces.id, 'legacy'
      FROM workspaces
      CROSS JOIN claimed_baseline
      ON CONFLICT (workspace_id) DO NOTHING;
    `);
  }

  async get(workspaceId: string) {
    const result = await this.pool.query<{ owner: ContentPackageWriteOwner }>(
      'SELECT owner FROM content_package_write_ownership WHERE workspace_id = $1',
      [workspaceId]
    );
    return result.rows[0]?.owner ?? null;
  }

  async set(workspaceId: string, owner: ContentPackageWriteOwner) {
    await this.pool.query(
      `INSERT INTO content_package_write_ownership (workspace_id, owner)
       VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO UPDATE
         SET owner = EXCLUDED.owner, updated_at = now()`,
      [workspaceId, owner]
    );
  }
}
