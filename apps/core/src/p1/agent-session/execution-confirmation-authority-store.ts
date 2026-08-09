import type { AgentRevisionRef } from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import { ExecutionConfirmationError } from './execution-confirmation-store.js';

export type PendingConfirmationAuthority = {
  workflowId: string;
  workspaceId: string;
  planId: string;
  planRevision: number;
  snapshotHash: string;
  quoteRef: AgentRevisionRef;
  rightsRevisionRefs: readonly string[];
  factRevisionRefs: readonly string[];
  frozenAt: string;
  executionConfirmationContext?: {
    campaignPlanRef: AgentRevisionRef;
    workOrdinal: number;
    approvalScope: 'single_work';
  };
};

export interface ConfirmationAuthorityStore {
  putCurrent(
    input: PendingConfirmationAuthority,
  ): Promise<PendingConfirmationAuthority>;
  getCurrentByWorkflowId(
    workflowId: string,
  ): Promise<PendingConfirmationAuthority | null>;
  clearCurrent(workflowId: string, snapshotHash: string): Promise<void>;
}

export class MemoryConfirmationAuthorityStore
  implements ConfirmationAuthorityStore
{
  readonly #current = new Map<string, PendingConfirmationAuthority>();

  async putCurrent(input: PendingConfirmationAuthority) {
    const existing = this.#current.get(input.workflowId);
    if (existing && existing.workspaceId !== input.workspaceId) {
      throw new ExecutionConfirmationError(
        'NOT_FOUND',
        'Workflow was not found.',
      );
    }
    if (existing && input.planRevision < existing.planRevision) {
      throw new ExecutionConfirmationError(
        'IDEMPOTENCY_CONFLICT',
        `Confirmation authority ${input.workflowId} has a newer frozen plan.`,
      );
    }
    if (existing && input.planRevision === existing.planRevision) {
      if (input.snapshotHash === existing.snapshotHash) {
        return structuredClone(existing);
      }
      throw new ExecutionConfirmationError(
        'IDEMPOTENCY_CONFLICT',
        `Confirmation authority ${input.workflowId} revision ${input.planRevision} has a different snapshot.`,
      );
    }
    this.#current.set(input.workflowId, structuredClone(input));
    return structuredClone(input);
  }

  async getCurrentByWorkflowId(workflowId: string) {
    const current = this.#current.get(workflowId);
    return current ? structuredClone(current) : null;
  }

  async clearCurrent(workflowId: string, snapshotHash: string) {
    if (this.#current.get(workflowId)?.snapshotHash === snapshotHash) {
      this.#current.delete(workflowId);
    }
  }
}

type AuthorityRow = {
  workflow_id: string;
  workspace_id: string;
  plan_revision: string | number;
  snapshot_hash: string;
  payload: PendingConfirmationAuthority;
};

export class PostgresConfirmationAuthorityStore
  implements ConfirmationAuthorityStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    const db = client ?? this.pool;
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_execution_confirmation_authorities (
        workflow_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        plan_revision bigint NOT NULL,
        snapshot_hash text NOT NULL,
        payload jsonb NOT NULL,
        frozen_at timestamptz NOT NULL
      )
    `);
    await db.query(`
      ALTER TABLE p1_execution_confirmation_authorities
        ADD COLUMN IF NOT EXISTS plan_revision bigint;
      UPDATE p1_execution_confirmation_authorities
         SET plan_revision = (payload->>'planRevision')::bigint
       WHERE plan_revision IS NULL;
      ALTER TABLE p1_execution_confirmation_authorities
        ALTER COLUMN plan_revision SET NOT NULL
    `);
  }

  async putCurrent(input: PendingConfirmationAuthority) {
    const result = await this.pool.query<AuthorityRow>(
      `INSERT INTO p1_execution_confirmation_authorities (
         workflow_id, workspace_id, plan_revision, snapshot_hash, payload, frozen_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
       ON CONFLICT (workflow_id) DO UPDATE
         SET plan_revision = CASE
               WHEN EXCLUDED.plan_revision > p1_execution_confirmation_authorities.plan_revision
                 THEN EXCLUDED.plan_revision
               ELSE p1_execution_confirmation_authorities.plan_revision
             END,
             snapshot_hash = CASE
               WHEN EXCLUDED.plan_revision > p1_execution_confirmation_authorities.plan_revision
                 THEN EXCLUDED.snapshot_hash
               ELSE p1_execution_confirmation_authorities.snapshot_hash
             END,
             payload = CASE
               WHEN EXCLUDED.plan_revision > p1_execution_confirmation_authorities.plan_revision
                 THEN EXCLUDED.payload
               ELSE p1_execution_confirmation_authorities.payload
             END,
             frozen_at = CASE
               WHEN EXCLUDED.plan_revision > p1_execution_confirmation_authorities.plan_revision
                 THEN EXCLUDED.frozen_at
               ELSE p1_execution_confirmation_authorities.frozen_at
             END
       WHERE p1_execution_confirmation_authorities.workspace_id = EXCLUDED.workspace_id
         AND (
           EXCLUDED.plan_revision > p1_execution_confirmation_authorities.plan_revision
           OR (
             EXCLUDED.plan_revision = p1_execution_confirmation_authorities.plan_revision
             AND EXCLUDED.snapshot_hash = p1_execution_confirmation_authorities.snapshot_hash
           )
         )
       RETURNING workflow_id, workspace_id, plan_revision, snapshot_hash, payload`,
      [
        input.workflowId,
        input.workspaceId,
        input.planRevision,
        input.snapshotHash,
        JSON.stringify(input),
        input.frozenAt,
      ],
    );
    const stored = result.rows[0]?.payload;
    if (!stored) {
      const existing = await this.getCurrentByWorkflowId(input.workflowId);
      if (existing?.workspaceId === input.workspaceId) {
        const message =
          existing.planRevision === input.planRevision
            ? `Confirmation authority ${input.workflowId} revision ${input.planRevision} has a different snapshot.`
            : `Confirmation authority ${input.workflowId} has a newer frozen plan.`;
        throw new ExecutionConfirmationError(
          'IDEMPOTENCY_CONFLICT',
          message,
        );
      }
      throw new ExecutionConfirmationError(
        'NOT_FOUND',
        'Workflow was not found.',
      );
    }
    return stored;
  }

  async getCurrentByWorkflowId(workflowId: string) {
    const result = await this.pool.query<AuthorityRow>(
      `SELECT workflow_id, workspace_id, plan_revision, snapshot_hash, payload
         FROM p1_execution_confirmation_authorities
        WHERE workflow_id = $1`,
      [workflowId],
    );
    return result.rows[0]?.payload ?? null;
  }

  async clearCurrent(workflowId: string, snapshotHash: string) {
    await this.pool.query(
      `DELETE FROM p1_execution_confirmation_authorities
        WHERE workflow_id = $1 AND snapshot_hash = $2`,
      [workflowId, snapshotHash],
    );
  }
}
