import {
  CONTEXT_SOURCE_REVISION_KEYS,
  type ContextSourceRevisions,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

export const MUTABLE_CONTEXT_SOURCE_REVISION_KEYS =
  CONTEXT_SOURCE_REVISION_KEYS.filter((key) => key !== 'facts');
export type MutableContextSourceRevisionKey =
  (typeof MUTABLE_CONTEXT_SOURCE_REVISION_KEYS)[number];

export interface ContextSourceRevisionRepository {
  current(workspaceId: string): Promise<ContextSourceRevisions>;
  advance(input: {
    workspaceId: string;
    key: MutableContextSourceRevisionKey;
    expectedRevision: number;
  }): Promise<number>;
}

export class ContextSourceRevisionConflictError extends Error {
  readonly code = 'CONTEXT_SOURCE_REVISION_CONFLICT';
  readonly status = 409;

  constructor(
    readonly key: MutableContextSourceRevisionKey,
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Context source ${key} expected revision ${expectedRevision}, current revision is ${currentRevision}.`,
    );
    this.name = 'ContextSourceRevisionConflictError';
  }
}

function emptyRevisions(): ContextSourceRevisions {
  return {
    facts: 0,
    assets: 0,
    identity: 0,
    rights: 0,
    preferences: 0,
    recipe: 0,
    platformRules: 0,
    currentSignal: 0,
  };
}

export class MemoryContextSourceRevisionRepository
  implements ContextSourceRevisionRepository
{
  private readonly revisions = new Map<string, ContextSourceRevisions>();

  async current(workspaceId: string) {
    return structuredClone(this.revisions.get(workspaceId) ?? emptyRevisions());
  }

  async advance(input: {
    workspaceId: string;
    key: MutableContextSourceRevisionKey;
    expectedRevision: number;
  }) {
    const revisions = structuredClone(
      this.revisions.get(input.workspaceId) ?? emptyRevisions(),
    );
    const currentRevision = Number(revisions[input.key]);
    if (currentRevision !== input.expectedRevision) {
      throw new ContextSourceRevisionConflictError(
        input.key,
        input.expectedRevision,
        currentRevision,
      );
    }
    const revision = currentRevision + 1;
    revisions[input.key] = revision;
    this.revisions.set(input.workspaceId, revisions);
    return revision;
  }
}

export class PostgresContextSourceRevisionRepository
  implements ContextSourceRevisionRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_context_source_revisions (
        workspace_id text NOT NULL,
        source_key text NOT NULL CHECK (
          source_key IN (
            'assets',
            'identity',
            'rights',
            'preferences',
            'recipe',
            'platformRules',
            'currentSignal'
          )
        ),
        revision bigint NOT NULL CHECK (revision >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, source_key)
      );
    `);
  }

  async current(workspaceId: string) {
    const revisions = emptyRevisions();
    const result = await this.pool.query<{
      source_key: MutableContextSourceRevisionKey;
      revision: string;
    }>(
      `SELECT source_key, revision::text AS revision
         FROM p1_context_source_revisions
        WHERE workspace_id = $1`,
      [workspaceId],
    );
    for (const row of result.rows) revisions[row.source_key] = Number(row.revision);
    return revisions;
  }

  async advance(input: {
    workspaceId: string;
    key: MutableContextSourceRevisionKey;
    expectedRevision: number;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO p1_context_source_revisions (
           workspace_id,
           source_key,
           revision
         ) VALUES ($1, $2, 0)
         ON CONFLICT (workspace_id, source_key) DO NOTHING`,
        [input.workspaceId, input.key],
      );
      const result = await client.query<{ revision: string }>(
        `UPDATE p1_context_source_revisions
            SET revision = revision + 1, updated_at = now()
          WHERE workspace_id = $1
            AND source_key = $2
            AND revision = $3
        RETURNING revision::text AS revision`,
        [input.workspaceId, input.key, input.expectedRevision],
      );
      if (result.rowCount !== 1) {
        const current = await client.query<{ revision: string }>(
          `SELECT revision::text AS revision
             FROM p1_context_source_revisions
            WHERE workspace_id = $1 AND source_key = $2`,
          [input.workspaceId, input.key],
        );
        throw new ContextSourceRevisionConflictError(
          input.key,
          input.expectedRevision,
          Number(current.rows[0]?.revision ?? 0),
        );
      }
      await client.query('COMMIT');
      return Number(result.rows[0]?.revision);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteWorkspaceForTest(workspaceId: string) {
    await this.pool.query(
      `DELETE FROM p1_context_source_revisions WHERE workspace_id = $1`,
      [workspaceId],
    );
  }
}
