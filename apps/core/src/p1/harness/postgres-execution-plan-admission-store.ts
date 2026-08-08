/**
 * PostgreSQL store for ExecutionPlanSnapshot admission (V31-12).
 *
 * Table p1_execution_plan_snapshots — one-shot immutable by snapshot_hash;
 * workflow_id is unique so a task cannot bind two different snapshots.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  executionPlanSnapshotSchema,
  type ExecutionPlanSnapshot,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import {
  ExecutionPlanAdmissionError,
  type AdmittedExecutionPlanSnapshot,
  type ExecutionPlanSnapshotStore,
} from './execution-plan-admission.js';

type SnapshotRow = {
  snapshot_hash: string;
  workflow_id: string;
  workspace_id: string;
  admitted_at: Date | string;
  payload: unknown;
};

type Queryable = Pick<Pool, 'query'>;

function parseRow(row: SnapshotRow): AdmittedExecutionPlanSnapshot {
  return {
    snapshot: executionPlanSnapshotSchema.parse(row.payload),
    workflowId: row.workflow_id,
    workspaceId: row.workspace_id,
    admittedAt:
      row.admitted_at instanceof Date
        ? row.admitted_at.toISOString()
        : new Date(row.admitted_at).toISOString(),
  };
}

export class PostgresExecutionPlanSnapshotStore
  implements ExecutionPlanSnapshotStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      SELECT pg_advisory_xact_lock(
        hashtext('p1-execution-plan-snapshot-migration-v1')
      );
      CREATE TABLE IF NOT EXISTS p1_execution_plan_snapshots (
        snapshot_hash text PRIMARY KEY,
        workflow_id text NOT NULL,
        workspace_id text NOT NULL,
        plan_id text NOT NULL,
        plan_revision bigint NOT NULL,
        approval_basis text NOT NULL CHECK (
          approval_basis IN ('merchant_confirmed', 'policy_exempt_copy')
        ),
        confirmation_decision_ref text NULL,
        payload jsonb NOT NULL,
        admitted_at timestamptz NOT NULL,
        UNIQUE (workflow_id)
      );
      CREATE INDEX IF NOT EXISTS p1_execution_plan_snapshots_ws_idx
        ON p1_execution_plan_snapshots (workspace_id, admitted_at DESC);
    `);
  }

  async putImmutable(
    row: AdmittedExecutionPlanSnapshot,
  ): Promise<AdmittedExecutionPlanSnapshot> {
    const snapshot = executionPlanSnapshotSchema.parse(row.snapshot);
    const inserted = await this.pool.query<SnapshotRow>(
      `INSERT INTO p1_execution_plan_snapshots (
         snapshot_hash, workflow_id, workspace_id, plan_id, plan_revision,
         approval_basis, confirmation_decision_ref, payload, admitted_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz
       )
       ON CONFLICT (snapshot_hash) DO NOTHING
       RETURNING snapshot_hash, workflow_id, workspace_id, admitted_at, payload`,
      [
        snapshot.snapshotHash,
        row.workflowId,
        row.workspaceId,
        snapshot.planId,
        snapshot.planRevision,
        snapshot.approvalBasis,
        snapshot.confirmationDecisionRef ?? null,
        JSON.stringify(snapshot),
        row.admittedAt,
      ],
    );
    if (inserted.rows[0]) {
      return parseRow(inserted.rows[0]);
    }

    const existing = await this.getByHash(snapshot.snapshotHash);
    if (
      existing &&
      existing.workflowId === row.workflowId &&
      existing.workspaceId === row.workspaceId &&
      isDeepStrictEqual(existing.snapshot, snapshot)
    ) {
      return existing;
    }
    throw new ExecutionPlanAdmissionError(
      'IDEMPOTENCY_CONFLICT',
      `ExecutionPlanSnapshot ${snapshot.snapshotHash} is immutable and already bound to a different admission row.`,
    );
  }

  async getByHash(
    snapshotHash: string,
  ): Promise<AdmittedExecutionPlanSnapshot | null> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT snapshot_hash, workflow_id, workspace_id, admitted_at, payload
         FROM p1_execution_plan_snapshots
        WHERE snapshot_hash = $1`,
      [snapshotHash],
    );
    return result.rows[0] ? parseRow(result.rows[0]) : null;
  }

  async getByWorkflowId(
    workflowId: string,
  ): Promise<AdmittedExecutionPlanSnapshot | null> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT snapshot_hash, workflow_id, workspace_id, admitted_at, payload
         FROM p1_execution_plan_snapshots
        WHERE workflow_id = $1`,
      [workflowId],
    );
    return result.rows[0] ? parseRow(result.rows[0]) : null;
  }
}

/** Combined migrator entry for assembly (single PostgresSchemaMigrator). */
export class PostgresExecutionPlanAdmissionMigration
  implements PostgresSchemaMigrator
{
  readonly store: PostgresExecutionPlanSnapshotStore;

  constructor(pool: Pool) {
    this.store = new PostgresExecutionPlanSnapshotStore(pool);
  }

  async migrate(client?: PoolClient): Promise<void> {
    await this.store.migrate(client);
  }
}

export type { ExecutionPlanSnapshot };
