import {
  assetDraftSchema,
  parsedDocumentSchema,
  parseOwnedAssetSchema,
  parseTaskSchema,
  type AssetDraft,
  type ParsedDocument,
  type ParseOwnedAsset,
  type ParseTask,
} from '@meiye/contracts';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';

import {
  ParseServiceError,
  type ParseRepository,
} from './parse-service.js';

interface PayloadRow {
  payload: unknown;
}

export class PostgresParseRepository implements ParseRepository {
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_parse_owned_assets (
        workspace_id text NOT NULL,
        asset_id text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, asset_id)
      );
      CREATE TABLE IF NOT EXISTS p1_parsed_documents (
        workspace_id text NOT NULL,
        parsed_document_id text NOT NULL,
        source_asset_id text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, parsed_document_id),
        UNIQUE (workspace_id, parsed_document_id, source_asset_id),
        FOREIGN KEY (workspace_id, source_asset_id)
          REFERENCES p1_parse_owned_assets (workspace_id, asset_id)
      );
      CREATE TABLE IF NOT EXISTS p1_asset_draft_sources (
        workspace_id text NOT NULL,
        source_asset_id text NOT NULL,
        draft_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, source_asset_id),
        UNIQUE (workspace_id, draft_id),
        FOREIGN KEY (workspace_id, source_asset_id)
          REFERENCES p1_parse_owned_assets (workspace_id, asset_id)
      );
      CREATE TABLE IF NOT EXISTS p1_asset_draft_revisions (
        workspace_id text NOT NULL,
        draft_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        source_asset_id text NOT NULL,
        parsed_document_id text,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, draft_id, revision),
        FOREIGN KEY (workspace_id, draft_id)
          REFERENCES p1_asset_draft_sources (workspace_id, draft_id),
        FOREIGN KEY (workspace_id, parsed_document_id, source_asset_id)
          REFERENCES p1_parsed_documents (
            workspace_id,
            parsed_document_id,
            source_asset_id
          )
      );
      CREATE TABLE IF NOT EXISTS p1_parse_tasks (
        workspace_id text NOT NULL,
        task_id text NOT NULL,
        mode text NOT NULL,
        source_asset_ids jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, task_id)
      );
      CREATE OR REPLACE FUNCTION p1_reject_parse_layer_update()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Parse source, document and draft layers are immutable';
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS p1_parse_owned_asset_immutable
        ON p1_parse_owned_assets;
      CREATE TRIGGER p1_parse_owned_asset_immutable
        BEFORE UPDATE ON p1_parse_owned_assets
        FOR EACH ROW EXECUTE FUNCTION p1_reject_parse_layer_update();
      DROP TRIGGER IF EXISTS p1_parsed_document_immutable
        ON p1_parsed_documents;
      CREATE TRIGGER p1_parsed_document_immutable
        BEFORE UPDATE ON p1_parsed_documents
        FOR EACH ROW EXECUTE FUNCTION p1_reject_parse_layer_update();
      DROP TRIGGER IF EXISTS p1_asset_draft_source_immutable
        ON p1_asset_draft_sources;
      CREATE TRIGGER p1_asset_draft_source_immutable
        BEFORE UPDATE ON p1_asset_draft_sources
        FOR EACH ROW EXECUTE FUNCTION p1_reject_parse_layer_update();
      DROP TRIGGER IF EXISTS p1_asset_draft_revision_immutable
        ON p1_asset_draft_revisions;
      CREATE TRIGGER p1_asset_draft_revision_immutable
        BEFORE UPDATE ON p1_asset_draft_revisions
        FOR EACH ROW EXECUTE FUNCTION p1_reject_parse_layer_update();
    `);
  }

  async recordSource(value: ParseOwnedAsset) {
    const source = parseOwnedAssetSchema.parse(value);
    return this.insertImmutable(
      `INSERT INTO p1_parse_owned_assets (
         workspace_id, asset_id, payload, created_at
       ) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (workspace_id, asset_id) DO NOTHING
       RETURNING payload`,
      [source.workspaceId, source.assetId, source, source.createdAt],
      `SELECT payload FROM p1_parse_owned_assets
        WHERE workspace_id = $1 AND asset_id = $2`,
      [source.workspaceId, source.assetId],
      source,
      parseOwnedAssetSchema,
      'SOURCE_CONFLICT',
      `Source asset ${source.assetId} already has another receipt.`,
    );
  }

  async getSource(workspaceId: string, assetId: string) {
    return this.read(
      `SELECT payload FROM p1_parse_owned_assets
        WHERE workspace_id = $1 AND asset_id = $2`,
      [workspaceId, assetId],
      parseOwnedAssetSchema,
    );
  }

  async recordDocument(value: ParsedDocument) {
    const document = parsedDocumentSchema.parse(value);
    return this.insertImmutable(
      `INSERT INTO p1_parsed_documents (
         workspace_id, parsed_document_id, source_asset_id, payload, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (workspace_id, parsed_document_id) DO NOTHING
       RETURNING payload`,
      [
        document.workspaceId,
        document.parsedDocumentId,
        document.sourceAssetId,
        document,
        document.createdAt,
      ],
      `SELECT payload FROM p1_parsed_documents
        WHERE workspace_id = $1 AND parsed_document_id = $2`,
      [document.workspaceId, document.parsedDocumentId],
      document,
      parsedDocumentSchema,
      'SOURCE_CONFLICT',
      `Parsed document ${document.parsedDocumentId} already has another payload.`,
    );
  }

  async getDocument(workspaceId: string, parsedDocumentId: string) {
    return this.read(
      `SELECT payload FROM p1_parsed_documents
        WHERE workspace_id = $1 AND parsed_document_id = $2`,
      [workspaceId, parsedDocumentId],
      parsedDocumentSchema,
    );
  }

  async appendDraft(value: AssetDraft) {
    const draft = assetDraftSchema.parse(value);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${draft.workspaceId}:parse-draft:${draft.sourceAssetId}`,
      ]);
      const binding = await client.query<{ draft_id: string }>(
        `INSERT INTO p1_asset_draft_sources (
           workspace_id, source_asset_id, draft_id
         ) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, source_asset_id) DO NOTHING
         RETURNING draft_id`,
        [draft.workspaceId, draft.sourceAssetId, draft.draftId],
      );
      const boundDraftId =
        binding.rows[0]?.draft_id ??
        (
          await client.query<{ draft_id: string }>(
            `SELECT draft_id FROM p1_asset_draft_sources
              WHERE workspace_id = $1 AND source_asset_id = $2`,
            [draft.workspaceId, draft.sourceAssetId],
          )
        ).rows[0]?.draft_id;
      if (boundDraftId !== draft.draftId) {
        throw new ParseServiceError(
          'DRAFT_CONFLICT',
          `Source asset ${draft.sourceAssetId} is already bound to another draft.`,
        );
      }
      const current = await this.getDraftWithClient(
        client,
        draft.workspaceId,
        draft.draftId,
      );
      if (current?.revision === draft.revision) {
        if (!isDeepStrictEqual(current, draft)) {
          throw new ParseServiceError(
            'DRAFT_CONFLICT',
            `Draft ${draft.draftId} revision ${draft.revision} already has another payload.`,
          );
        }
        await client.query('COMMIT');
        return current;
      }
      if (draft.revision !== (current?.revision ?? 0) + 1) {
        throw new ParseServiceError(
          'DRAFT_CONFLICT',
          `Draft ${draft.draftId} revision is not append-only.`,
        );
      }
      await client.query(
        `INSERT INTO p1_asset_draft_revisions (
           workspace_id, draft_id, revision, source_asset_id,
           parsed_document_id, payload, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          draft.workspaceId,
          draft.draftId,
          draft.revision,
          draft.sourceAssetId,
          draft.parsedDocumentId,
          draft,
          draft.createdAt,
        ],
      );
      await client.query('COMMIT');
      return draft;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getDraft(workspaceId: string, draftId: string, revision?: number) {
    return this.getDraftWithClient(
      this.pool,
      workspaceId,
      draftId,
      revision,
    );
  }

  async latestDraftForSource(workspaceId: string, sourceAssetId: string) {
    const result = await this.pool.query<{ draft_id: string }>(
      `SELECT draft_id FROM p1_asset_draft_sources
        WHERE workspace_id = $1 AND source_asset_id = $2`,
      [workspaceId, sourceAssetId],
    );
    const draftId = result.rows[0]?.draft_id;
    return draftId ? this.getDraft(workspaceId, draftId) : null;
  }

  async recordTask(value: ParseTask) {
    const task = parseTaskSchema.parse(value);
    return this.insertImmutable(
      `INSERT INTO p1_parse_tasks (
         workspace_id, task_id, mode, source_asset_ids,
         created_at, payload, updated_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)
       ON CONFLICT (workspace_id, task_id) DO NOTHING
       RETURNING payload`,
      [
        task.workspaceId,
        task.taskId,
        task.mode,
        JSON.stringify(task.sourceAssetIds),
        task.createdAt,
        task,
        task.updatedAt,
      ],
      `SELECT payload FROM p1_parse_tasks
        WHERE workspace_id = $1 AND task_id = $2`,
      [task.workspaceId, task.taskId],
      task,
      parseTaskSchema,
      'TASK_CONFLICT',
      `Parse task ${task.taskId} already has another payload.`,
    );
  }

  async updateTask(value: ParseTask) {
    const task = parseTaskSchema.parse(value);
    const result = await this.pool.query<PayloadRow>(
      `UPDATE p1_parse_tasks
          SET payload = $3::jsonb, updated_at = $4
        WHERE workspace_id = $1
          AND task_id = $2
          AND mode = $5
          AND source_asset_ids = $6::jsonb
          AND created_at = $7
        RETURNING payload`,
      [
        task.workspaceId,
        task.taskId,
        task,
        task.updatedAt,
        task.mode,
        JSON.stringify(task.sourceAssetIds),
        task.createdAt,
      ],
    );
    const updated = result.rows[0]?.payload;
    if (updated) return parseTaskSchema.parse(updated);
    const current = await this.getTask(task.workspaceId, task.taskId);
    throw new ParseServiceError(
      current ? 'TASK_CONFLICT' : 'TASK_NOT_FOUND',
      current
        ? `Parse task ${task.taskId} identity fields cannot change.`
        : `Parse task ${task.taskId} was not found.`,
    );
  }

  async getTask(workspaceId: string, taskId: string) {
    return this.read(
      `SELECT payload FROM p1_parse_tasks
        WHERE workspace_id = $1 AND task_id = $2`,
      [workspaceId, taskId],
      parseTaskSchema,
    );
  }

  async deleteWorkspaceForTest(workspaceId: string) {
    for (const table of [
      'p1_asset_draft_revisions',
      'p1_asset_draft_sources',
      'p1_parsed_documents',
      'p1_parse_tasks',
      'p1_parse_owned_assets',
    ]) {
      await this.pool.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [
        workspaceId,
      ]);
    }
  }

  private async getDraftWithClient(
    client: Pick<Pool, 'query'> | PoolClient,
    workspaceId: string,
    draftId: string,
    revision?: number,
  ) {
    return this.readWithClient(
      client,
      `SELECT payload FROM p1_asset_draft_revisions
        WHERE workspace_id = $1 AND draft_id = $2
          ${revision === undefined ? '' : 'AND revision = $3'}
        ORDER BY revision DESC LIMIT 1`,
      revision === undefined
        ? [workspaceId, draftId]
        : [workspaceId, draftId, revision],
      assetDraftSchema,
    );
  }

  private async read<T>(
    sql: string,
    values: unknown[],
    schema: { parse(value: unknown): T },
  ) {
    return this.readWithClient(this.pool, sql, values, schema);
  }

  private async readWithClient<T>(
    client: Pick<Pool, 'query'> | PoolClient,
    sql: string,
    values: unknown[],
    schema: { parse(value: unknown): T },
  ) {
    const result = await client.query<PayloadRow>(sql, values);
    return result.rows[0]?.payload
      ? schema.parse(result.rows[0].payload)
      : null;
  }

  private async insertImmutable<T>(
    insertSql: string,
    insertValues: unknown[],
    selectSql: string,
    selectValues: unknown[],
    value: T,
    schema: { parse(value: unknown): T },
    code: 'SOURCE_CONFLICT' | 'TASK_CONFLICT',
    message: string,
  ) {
    const result = await this.pool.query<PayloadRow>(
      insertSql,
      insertValues,
    );
    const stored =
      result.rows[0]?.payload ??
      (await this.pool.query<PayloadRow>(selectSql, selectValues)).rows[0]
        ?.payload;
    const parsed = stored ? schema.parse(stored) : null;
    if (!parsed || !isDeepStrictEqual(parsed, value)) {
      throw new ParseServiceError(code, message);
    }
    return parsed;
  }
}
