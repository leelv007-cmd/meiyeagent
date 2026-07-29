import { isDeepStrictEqual } from 'node:util';

import type { Pool, PoolClient } from 'pg';

import { P1DomainError } from '../foundation/domain.js';
import { lockSkillReferenceTarget } from '../skills/reference-lock.js';
import type { SkillReferenceEdge } from '../skills/types.js';
import type { CreationExperienceCatalogRepository } from './memory-repository.js';
import type {
  CatalogSessionFreeze,
  CatalogSessionId,
  RecipeId,
  RecipeRevisionId,
  ServerRecipeRecord,
  ServerSurfaceRecord,
  SurfaceId,
  SurfaceRevisionId,
} from './types.js';
import { parseRecipeRevisionId } from './types.js';

type RevisionRow<T> = {
  payload: T;
  revision: string | number;
};

function parseSurfaceRevisionId(
  revisionId: SurfaceRevisionId,
): { surfaceId: SurfaceId; revision: number } | null {
  const at = revisionId.lastIndexOf('@');
  if (at <= 0) return null;
  const surfaceId = revisionId.slice(0, at);
  const revision = Number(revisionId.slice(at + 1));
  if (!surfaceId || !Number.isInteger(revision) || revision < 1) return null;
  return { surfaceId, revision };
}

function cloneRow<T>(row: RevisionRow<T> | undefined): T | null {
  return row ? structuredClone(row.payload) : null;
}

export class PostgresCreationExperienceCatalogRepository
  implements CreationExperienceCatalogRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_creation_recipe_revisions (
        recipe_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        status text NOT NULL CHECK (status IN ('draft', 'preview', 'published', 'retired')),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (recipe_id, revision)
      );
      CREATE TABLE IF NOT EXISTS p1_creation_recipe_heads (
        recipe_id text PRIMARY KEY,
        revision bigint NOT NULL CHECK (revision >= 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS p1_creation_recipe_published_idx
        ON p1_creation_recipe_revisions (recipe_id, revision DESC)
        WHERE status = 'published';

      CREATE TABLE IF NOT EXISTS p1_creation_surface_revisions (
        surface_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        status text NOT NULL CHECK (status IN ('draft', 'preview', 'published', 'retired')),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (surface_id, revision)
      );
      CREATE TABLE IF NOT EXISTS p1_creation_surface_heads (
        surface_id text PRIMARY KEY,
        revision bigint NOT NULL CHECK (revision >= 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS p1_creation_surface_published_idx
        ON p1_creation_surface_revisions (surface_id, revision DESC)
        WHERE status = 'published';

      CREATE TABLE IF NOT EXISTS p1_creation_session_freezes (
        workspace_id text NOT NULL,
        session_id text NOT NULL,
        surface_revision_id text NOT NULL,
        payload jsonb NOT NULL,
        frozen_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, session_id)
      );
      ALTER TABLE p1_creation_session_freezes
        ADD COLUMN IF NOT EXISTS workspace_id text;
      UPDATE p1_creation_session_freezes
         SET workspace_id = '__legacy_unscoped__'
       WHERE workspace_id IS NULL;
      ALTER TABLE p1_creation_session_freezes
        ALTER COLUMN workspace_id SET NOT NULL;
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid = 'p1_creation_session_freezes'::regclass
             AND contype = 'p'
             AND pg_get_constraintdef(oid) NOT LIKE '%workspace_id%'
        ) THEN
          ALTER TABLE p1_creation_session_freezes
            DROP CONSTRAINT p1_creation_session_freezes_pkey;
        END IF;
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid = 'p1_creation_session_freezes'::regclass
             AND contype = 'p'
        ) THEN
          ALTER TABLE p1_creation_session_freezes
            ADD CONSTRAINT p1_creation_session_freezes_pkey
            PRIMARY KEY (workspace_id, session_id);
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS p1_creation_session_workspace_surface_idx
        ON p1_creation_session_freezes (workspace_id, surface_revision_id);
    `);
  }

  appendRecipe(
    record: ServerRecipeRecord,
    expectedRevision: number | null,
  ): Promise<ServerRecipeRecord> {
    return this.appendRevision({
      expectedRevision,
      headIdColumn: 'recipe_id',
      headTable: 'p1_creation_recipe_heads',
      id: record.recipeId,
      kind: 'recipe',
      record,
      revisionTable: 'p1_creation_recipe_revisions',
    });
  }

  async getRecipeHead(recipeId: RecipeId) {
    return this.getHead<ServerRecipeRecord>(
      'p1_creation_recipe_heads',
      'p1_creation_recipe_revisions',
      'recipe_id',
      recipeId,
    );
  }

  async getRecipeRevision(recipeId: RecipeId, revision: number) {
    return this.getRevision<ServerRecipeRecord>(
      'p1_creation_recipe_revisions',
      'recipe_id',
      recipeId,
      revision,
    );
  }

  async getRecipeByRevisionId(revisionId: RecipeRevisionId) {
    const parsed = parseRecipeRevisionId(revisionId);
    return parsed
      ? this.getRecipeRevision(parsed.recipeId, parsed.revision)
      : null;
  }

  async listRecipeHistory(recipeId: RecipeId) {
    return this.listHistory<ServerRecipeRecord>(
      'p1_creation_recipe_revisions',
      'recipe_id',
      recipeId,
    );
  }

  async latestPublishedRecipe(recipeId: RecipeId) {
    return this.latestPublished<ServerRecipeRecord>(
      'p1_creation_recipe_revisions',
      'recipe_id',
      recipeId,
    );
  }

  appendSurface(
    record: ServerSurfaceRecord,
    expectedRevision: number | null,
  ): Promise<ServerSurfaceRecord> {
    return this.appendRevision({
      expectedRevision,
      headIdColumn: 'surface_id',
      headTable: 'p1_creation_surface_heads',
      id: record.surfaceId,
      kind: 'surface',
      record,
      revisionTable: 'p1_creation_surface_revisions',
    });
  }

  async getSurfaceHead(surfaceId: SurfaceId) {
    return this.getHead<ServerSurfaceRecord>(
      'p1_creation_surface_heads',
      'p1_creation_surface_revisions',
      'surface_id',
      surfaceId,
    );
  }

  async getSurfaceRevision(surfaceId: SurfaceId, revision: number) {
    return this.getRevision<ServerSurfaceRecord>(
      'p1_creation_surface_revisions',
      'surface_id',
      surfaceId,
      revision,
    );
  }

  async getSurfaceByRevisionId(revisionId: SurfaceRevisionId) {
    const parsed = parseSurfaceRevisionId(revisionId);
    return parsed
      ? this.getSurfaceRevision(parsed.surfaceId, parsed.revision)
      : null;
  }

  async listSurfaceHistory(surfaceId: SurfaceId) {
    return this.listHistory<ServerSurfaceRecord>(
      'p1_creation_surface_revisions',
      'surface_id',
      surfaceId,
    );
  }

  async latestPublishedSurface(surfaceId: SurfaceId) {
    return this.latestPublished<ServerSurfaceRecord>(
      'p1_creation_surface_revisions',
      'surface_id',
      surfaceId,
    );
  }

  async putSessionFreeze(
    freeze: CatalogSessionFreeze,
  ): Promise<CatalogSessionFreeze> {
    const inserted = await this.pool.query<RevisionRow<CatalogSessionFreeze>>(
      `INSERT INTO p1_creation_session_freezes
         (workspace_id, session_id, surface_revision_id, payload, frozen_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       ON CONFLICT (workspace_id, session_id) DO NOTHING
       RETURNING payload, 1 AS revision`,
      [
        freeze.workspaceId,
        freeze.sessionId,
        freeze.surfaceRevisionId,
        JSON.stringify(freeze),
        freeze.frozenAt,
      ],
    );
    if (inserted.rows[0]) return structuredClone(inserted.rows[0].payload);
    const existing = await this.getSessionFreeze(
      freeze.workspaceId,
      freeze.sessionId,
    );
    if (existing && isDeepStrictEqual(existing, freeze)) return existing;
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Creation session is already frozen to a different catalog snapshot.',
    );
  }

  async getSessionFreeze(
    workspaceId: string,
    sessionId: CatalogSessionId,
  ): Promise<CatalogSessionFreeze | null> {
    const result = await this.pool.query<{ payload: CatalogSessionFreeze }>(
      `SELECT payload
         FROM p1_creation_session_freezes
        WHERE workspace_id = $1 AND session_id = $2`,
      [workspaceId, sessionId],
    );
    return result.rows[0] ? structuredClone(result.rows[0].payload) : null;
  }

  private async appendRevision<T extends { revision: number; status: string; createdAt: string }>(
    input: {
      expectedRevision: number | null;
      headIdColumn: 'recipe_id' | 'surface_id';
      headTable: 'p1_creation_recipe_heads' | 'p1_creation_surface_heads';
      id: string;
      kind: 'recipe' | 'surface';
      record: T;
      revisionTable:
        | 'p1_creation_recipe_revisions'
        | 'p1_creation_surface_revisions';
    },
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ${input.headTable} (${input.headIdColumn}, revision)
         VALUES ($1, 0)
         ON CONFLICT (${input.headIdColumn}) DO NOTHING`,
        [input.id],
      );
      const head = await client.query<{ revision: string }>(
        `SELECT revision::text AS revision
           FROM ${input.headTable}
          WHERE ${input.headIdColumn} = $1
          FOR UPDATE`,
        [input.id],
      );
      const currentRevision = Number(head.rows[0]?.revision ?? 0);
      const expected = input.expectedRevision ?? 0;
      if (currentRevision !== expected) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          `Creation ${input.kind} head changed before the write could be applied.`,
        );
      }
      if (input.record.revision !== currentRevision + 1) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Creation ${input.kind} revision must advance by exactly one.`,
        );
      }
      await client.query(
        `INSERT INTO ${input.revisionTable}
           (${input.headIdColumn}, revision, status, payload, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)`,
        [
          input.id,
          input.record.revision,
          input.record.status,
          JSON.stringify(input.record),
          input.record.createdAt,
        ],
      );
      if (input.kind === 'recipe') {
        await this.indexRecipeSkillReferences(
          client,
          input.record as unknown as ServerRecipeRecord,
        );
      }
      await client.query(
        `UPDATE ${input.headTable}
            SET revision = $2, updated_at = now()
          WHERE ${input.headIdColumn} = $1`,
        [input.id, input.record.revision],
      );
      await client.query('COMMIT');
      return structuredClone(input.record);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async indexRecipeSkillReferences(
    client: PoolClient,
    recipe: ServerRecipeRecord,
  ) {
    const relation = await client.query<{ relation: string | null }>(
      `SELECT to_regclass('p1_skill_reference_edges')::text AS relation`,
    );
    if (!relation.rows[0]?.relation) return;
    for (const targetSkillRevisionRef of [
      ...new Set(recipe.skillRevisionRefs),
    ].sort()) {
      await lockSkillReferenceTarget(client, targetSkillRevisionRef);
      const target = await client.query<{ status: string }>(
        `SELECT status
           FROM p1_skill_revisions
          WHERE skill_revision_ref = $1`,
        [targetSkillRevisionRef],
      );
      if (target.rows[0]?.status === 'retired') {
        throw new P1DomainError(
          'INVALID_STATE',
          'Retired Skill revisions cannot acquire new references.',
        );
      }
      const edge: SkillReferenceEdge = {
        edgeId: [
          'skill-reference',
          'recipe_revision',
          recipe.revisionId,
          targetSkillRevisionRef,
        ].join(':'),
        targetSkillRevisionRef,
        consumerKind: 'recipe_revision',
        consumerId: recipe.revisionId,
        consumerLabel: recipe.recipeId,
        scope: { kind: 'global', proof: 'recipe_catalog' },
        createdAt: recipe.createdAt,
      };
      await client.query(
        `INSERT INTO p1_skill_reference_edges
           (edge_id, target_skill_revision_ref, consumer_kind, consumer_id,
            consumer_label, scope_kind, owner_workspace_id, global_proof,
            payload, created_at)
         VALUES ($1, $2, $3, $4, $5, 'global', NULL, 'recipe_catalog',
                 $6::jsonb, $7::timestamptz)
         ON CONFLICT (edge_id) DO NOTHING`,
        [
          edge.edgeId,
          edge.targetSkillRevisionRef,
          edge.consumerKind,
          edge.consumerId,
          edge.consumerLabel,
          JSON.stringify(edge),
          edge.createdAt,
        ],
      );
    }
  }

  private async getHead<T>(
    headTable: string,
    revisionTable: string,
    idColumn: string,
    id: string,
  ): Promise<T | null> {
    const result = await this.pool.query<RevisionRow<T>>(
      `SELECT revisions.payload, revisions.revision
         FROM ${headTable} heads
         JOIN ${revisionTable} revisions
           ON revisions.${idColumn} = heads.${idColumn}
          AND revisions.revision = heads.revision
        WHERE heads.${idColumn} = $1`,
      [id],
    );
    return cloneRow(result.rows[0]);
  }

  private async getRevision<T>(
    table: string,
    idColumn: string,
    id: string,
    revision: number,
  ): Promise<T | null> {
    const result = await this.pool.query<RevisionRow<T>>(
      `SELECT payload, revision
         FROM ${table}
        WHERE ${idColumn} = $1 AND revision = $2`,
      [id, revision],
    );
    return cloneRow(result.rows[0]);
  }

  private async listHistory<T>(
    table: string,
    idColumn: string,
    id: string,
  ): Promise<T[]> {
    const result = await this.pool.query<RevisionRow<T>>(
      `SELECT payload, revision
         FROM ${table}
        WHERE ${idColumn} = $1
        ORDER BY revision ASC`,
      [id],
    );
    return result.rows.map((row) => structuredClone(row.payload));
  }

  private async latestPublished<T>(
    table: string,
    idColumn: string,
    id: string,
  ): Promise<T | null> {
    const result = await this.pool.query<RevisionRow<T>>(
      `SELECT payload, revision
         FROM ${table}
        WHERE ${idColumn} = $1 AND status = 'published'
        ORDER BY revision DESC
        LIMIT 1`,
      [id],
    );
    return cloneRow(result.rows[0]);
  }
}
