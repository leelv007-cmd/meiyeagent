import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import type {
  AdminConfigRepository,
  AdminConfigRevision,
  AdminConfigScope,
  ApplyConfigInput,
  RollbackConfigInput,
  RuntimeEffectiveSnapshot,
} from './foundation-module.js';

interface AdminConfigRow {
  scope: AdminConfigScope;
  workspace_id: string;
  config_key: string;
  value: unknown;
  revision: string | number;
  status: AdminConfigRevision['status'];
  rolled_back_to_revision: string | number | null;
  actor_id: string;
  reason: string;
  correlation_id: string;
  created_at: Date | string;
}

interface RuntimeEffectiveSnapshotRow {
  booted_at: Date | string;
  byok_fallback_reason: string | null;
  byok_mode: string;
  byok_source: RuntimeEffectiveSnapshot['byokSource'];
  execution_mode: string;
  execution_source: RuntimeEffectiveSnapshot['executionSource'];
  fallback_reason: string | null;
  media_mode: string;
  media_source: RuntimeEffectiveSnapshot['mediaSource'];
  process_kind: RuntimeEffectiveSnapshot['processKind'];
  runtime_environment: RuntimeEffectiveSnapshot['runtimeEnvironment'];
}

function effectiveSnapshotFromRow(
  row: RuntimeEffectiveSnapshotRow,
): RuntimeEffectiveSnapshot {
  return {
    bootedAt:
      row.booted_at instanceof Date
        ? row.booted_at.toISOString()
        : new Date(row.booted_at).toISOString(),
    byokFallbackReason: row.byok_fallback_reason,
    byokMode: row.byok_mode,
    byokSource: row.byok_source,
    executionMode: row.execution_mode,
    executionSource: row.execution_source,
    fallbackReason: row.fallback_reason,
    mediaMode: row.media_mode,
    mediaSource: row.media_source,
    processKind: row.process_kind,
    runtimeEnvironment: row.runtime_environment,
  };
}

function revisionFromRow(row: AdminConfigRow): AdminConfigRevision {
  return {
    scope: row.scope,
    workspaceId: row.workspace_id,
    key: row.config_key,
    value: row.value,
    revision: Number(row.revision),
    status: row.status,
    rolledBackToRevision:
      row.rolled_back_to_revision === null
        ? null
        : Number(row.rolled_back_to_revision),
    actorId: row.actor_id,
    reason: row.reason,
    correlationId: row.correlation_id,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  };
}

export class PostgresAdminConfigRepository implements AdminConfigRepository {
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS admin_config_revisions (
        scope text NOT NULL CHECK (scope IN ('global', 'workspace')),
        workspace_id text NOT NULL,
        config_key text NOT NULL,
        value jsonb NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        status text NOT NULL CHECK (status IN ('applied', 'rolled_back')),
        rolled_back_to_revision bigint,
        actor_id text NOT NULL,
        reason text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (scope, workspace_id, config_key, revision)
      );
      CREATE TABLE IF NOT EXISTS admin_config_heads (
        scope text NOT NULL CHECK (scope IN ('global', 'workspace')),
        workspace_id text NOT NULL,
        config_key text NOT NULL,
        revision bigint NOT NULL CHECK (revision >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (scope, workspace_id, config_key)
      );
      CREATE INDEX IF NOT EXISTS admin_config_revisions_history_idx
        ON admin_config_revisions (
          scope,
          workspace_id,
          config_key,
          revision DESC
        );
      CREATE TABLE IF NOT EXISTS admin_config_effective_snapshots (
        process_kind text PRIMARY KEY CHECK (process_kind IN ('http', 'job-worker')),
        execution_mode text NOT NULL,
        media_mode text NOT NULL,
        execution_source jsonb NOT NULL,
        media_source jsonb NOT NULL,
        fallback_reason text,
        booted_at timestamptz NOT NULL,
        runtime_environment jsonb NOT NULL DEFAULT '{"appEnv":"","modelExecutionMode":""}'::jsonb,
        byok_mode text NOT NULL DEFAULT 'recorded',
        byok_source jsonb NOT NULL DEFAULT '{"source":"env_fallback"}'::jsonb,
        byok_fallback_reason text
      );
      ALTER TABLE admin_config_effective_snapshots
        ADD COLUMN IF NOT EXISTS runtime_environment jsonb NOT NULL DEFAULT '{"appEnv":"","modelExecutionMode":""}'::jsonb;
      ALTER TABLE admin_config_effective_snapshots
        ADD COLUMN IF NOT EXISTS byok_mode text NOT NULL DEFAULT 'recorded';
      ALTER TABLE admin_config_effective_snapshots
        ADD COLUMN IF NOT EXISTS byok_source jsonb NOT NULL DEFAULT '{"source":"env_fallback"}'::jsonb;
      ALTER TABLE admin_config_effective_snapshots
        ADD COLUMN IF NOT EXISTS byok_fallback_reason text;
    `);
  }

  async listEffectiveSnapshots() {
    const result = await this.pool.query<RuntimeEffectiveSnapshotRow>(
      `SELECT *
         FROM admin_config_effective_snapshots
        ORDER BY process_kind ASC`,
    );
    return result.rows.map(effectiveSnapshotFromRow);
  }

  async upsertEffectiveSnapshot(snapshot: RuntimeEffectiveSnapshot) {
    const result = await this.pool.query<RuntimeEffectiveSnapshotRow>(
      `INSERT INTO admin_config_effective_snapshots (
         process_kind,
         execution_mode,
         media_mode,
         execution_source,
         media_source,
         fallback_reason,
         booted_at,
         runtime_environment,
         byok_mode,
         byok_source,
         byok_fallback_reason
       ) VALUES (
         $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::jsonb, $9, $10::jsonb, $11
       )
       ON CONFLICT (process_kind) DO UPDATE SET
         execution_mode = EXCLUDED.execution_mode,
         media_mode = EXCLUDED.media_mode,
         execution_source = EXCLUDED.execution_source,
         media_source = EXCLUDED.media_source,
         fallback_reason = EXCLUDED.fallback_reason,
         booted_at = EXCLUDED.booted_at,
         runtime_environment = EXCLUDED.runtime_environment,
         byok_mode = EXCLUDED.byok_mode,
         byok_source = EXCLUDED.byok_source,
         byok_fallback_reason = EXCLUDED.byok_fallback_reason
       RETURNING *`,
      [
        snapshot.processKind,
        snapshot.executionMode,
        snapshot.mediaMode,
        JSON.stringify(snapshot.executionSource),
        JSON.stringify(snapshot.mediaSource),
        snapshot.fallbackReason,
        snapshot.bootedAt,
        JSON.stringify(snapshot.runtimeEnvironment),
        snapshot.byokMode,
        JSON.stringify(snapshot.byokSource),
        snapshot.byokFallbackReason,
      ],
    );
    return effectiveSnapshotFromRow(result.rows[0]!);
  }

  async apply(input: ApplyConfigInput) {
    return this.inTransaction(async (client) => {
      const currentRevision = await this.lockHead(client, input);
      const expected = input.expectedRevision ?? 0;
      if (currentRevision !== expected) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Config head changed before the value could be applied.',
        );
      }
      const current =
        currentRevision === 0
          ? null
          : await this.getWithClient(
              client,
              input.scope,
              input.workspaceId,
              input.key,
              currentRevision,
            );
      if (current && isDeepStrictEqual(current.value, input.value)) {
        return current;
      }
      return this.appendRevision(client, {
        ...input,
        revision: currentRevision + 1,
        status: 'applied',
        rolledBackToRevision: null,
      });
    });
  }

  async rollback(input: RollbackConfigInput) {
    return this.inTransaction(async (client) => {
      const currentRevision = await this.lockHead(client, input);
      if (currentRevision !== input.expectedRevision) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Config head changed before the rollback could be applied.',
        );
      }
      const target = await this.getWithClient(
        client,
        input.scope,
        input.workspaceId,
        input.key,
        input.targetRevision,
      );
      if (!target) {
        throw new P1DomainError('NOT_FOUND', 'Config revision was not found.');
      }
      return this.appendRevision(client, {
        ...input,
        value: target.value,
        revision: currentRevision + 1,
        status: 'rolled_back',
        rolledBackToRevision: target.revision,
      });
    });
  }

  async get(scope: AdminConfigScope, workspaceId: string, key: string) {
    const result = await this.pool.query<AdminConfigRow>(
      `SELECT revisions.*
         FROM admin_config_heads heads
         JOIN admin_config_revisions revisions
           ON revisions.scope = heads.scope
          AND revisions.workspace_id = heads.workspace_id
          AND revisions.config_key = heads.config_key
          AND revisions.revision = heads.revision
        WHERE heads.scope = $1
          AND heads.workspace_id = $2
          AND heads.config_key = $3`,
      [scope, workspaceId, key],
    );
    return result.rows[0] ? revisionFromRow(result.rows[0]) : null;
  }

  async history(scope: AdminConfigScope, workspaceId: string, key: string) {
    const result = await this.pool.query<AdminConfigRow>(
      `SELECT *
         FROM admin_config_revisions
        WHERE scope = $1 AND workspace_id = $2 AND config_key = $3
        ORDER BY revision ASC`,
      [scope, workspaceId, key],
    );
    return result.rows.map(revisionFromRow);
  }

  async deleteScopeForTest(scope: AdminConfigScope, workspaceId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM admin_config_heads WHERE scope = $1 AND workspace_id = $2',
        [scope, workspaceId],
      );
      await client.query(
        'DELETE FROM admin_config_revisions WHERE scope = $1 AND workspace_id = $2',
        [scope, workspaceId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockHead(
    client: PoolClient,
    input: Pick<ApplyConfigInput, 'scope' | 'workspaceId' | 'key'>,
  ) {
    await client.query(
      `INSERT INTO admin_config_heads
         (scope, workspace_id, config_key, revision)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (scope, workspace_id, config_key) DO NOTHING`,
      [input.scope, input.workspaceId, input.key],
    );
    const head = await client.query<{ revision: string | number }>(
      `SELECT revision
         FROM admin_config_heads
        WHERE scope = $1 AND workspace_id = $2 AND config_key = $3
        FOR UPDATE`,
      [input.scope, input.workspaceId, input.key],
    );
    return Number(head.rows[0]?.revision ?? 0);
  }

  private async appendRevision(
    client: PoolClient,
    input: {
      scope: AdminConfigScope;
      workspaceId: string;
      key: string;
      value: unknown;
      revision: number;
      status: AdminConfigRevision['status'];
      rolledBackToRevision: number | null;
      actorId: string;
      reason: string;
      correlationId: string;
    },
  ) {
    const inserted = await client.query<AdminConfigRow>(
      `INSERT INTO admin_config_revisions (
         scope,
         workspace_id,
         config_key,
         value,
         revision,
         status,
         rolled_back_to_revision,
         actor_id,
         reason,
         correlation_id
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.scope,
        input.workspaceId,
        input.key,
        JSON.stringify(input.value),
        input.revision,
        input.status,
        input.rolledBackToRevision,
        input.actorId,
        input.reason,
        input.correlationId,
      ],
    );
    const updated = await client.query(
      `UPDATE admin_config_heads
          SET revision = $4, updated_at = now()
        WHERE scope = $1
          AND workspace_id = $2
          AND config_key = $3
          AND revision = $5`,
      [
        input.scope,
        input.workspaceId,
        input.key,
        input.revision,
        input.revision - 1,
      ],
    );
    if (updated.rowCount !== 1 || !inserted.rows[0]) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Config head changed before the revision could be committed.',
      );
    }
    return revisionFromRow(inserted.rows[0]);
  }

  private async getWithClient(
    client: PoolClient,
    scope: AdminConfigScope,
    workspaceId: string,
    key: string,
    revision: number,
  ) {
    const result = await client.query<AdminConfigRow>(
      `SELECT *
         FROM admin_config_revisions
        WHERE scope = $1
          AND workspace_id = $2
          AND config_key = $3
          AND revision = $4`,
      [scope, workspaceId, key, revision],
    );
    return result.rows[0] ? revisionFromRow(result.rows[0]) : null;
  }

  private async inTransaction<T>(
    action: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await action(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
