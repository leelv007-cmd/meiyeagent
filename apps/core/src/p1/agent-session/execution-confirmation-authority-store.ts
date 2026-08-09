import { isDeepStrictEqual } from 'node:util';

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
    if (existing && Date.parse(existing.frozenAt) > Date.parse(input.frozenAt)) {
      throw new ExecutionConfirmationError(
        'IDEMPOTENCY_CONFLICT',
        `Confirmation authority ${input.workflowId} has a newer frozen plan.`,
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
        snapshot_hash text NOT NULL,
        payload jsonb NOT NULL,
        frozen_at timestamptz NOT NULL
      )
    `);
  }

  async putCurrent(input: PendingConfirmationAuthority) {
    const result = await this.pool.query<AuthorityRow>(
      `INSERT INTO p1_execution_confirmation_authorities (
         workflow_id, workspace_id, snapshot_hash, payload, frozen_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       ON CONFLICT (workflow_id) DO UPDATE
         SET snapshot_hash = EXCLUDED.snapshot_hash,
             payload = EXCLUDED.payload,
             frozen_at = EXCLUDED.frozen_at
       WHERE p1_execution_confirmation_authorities.workspace_id = EXCLUDED.workspace_id
         AND p1_execution_confirmation_authorities.frozen_at <= EXCLUDED.frozen_at
       RETURNING workflow_id, workspace_id, snapshot_hash, payload`,
      [
        input.workflowId,
        input.workspaceId,
        input.snapshotHash,
        JSON.stringify(input),
        input.frozenAt,
      ],
    );
    const stored = result.rows[0]?.payload;
    if (!stored) {
      const existing = await this.getCurrentByWorkflowId(input.workflowId);
      if (existing?.workspaceId === input.workspaceId) {
        throw new ExecutionConfirmationError(
          'IDEMPOTENCY_CONFLICT',
          `Confirmation authority ${input.workflowId} has a newer frozen plan.`,
        );
      }
      throw new ExecutionConfirmationError(
        'NOT_FOUND',
        'Workflow was not found.',
      );
    }
    if (!isDeepStrictEqual(stored, input)) {
      throw new ExecutionConfirmationError(
        'IDEMPOTENCY_CONFLICT',
        `Confirmation authority ${input.workflowId} was not frozen as requested.`,
      );
    }
    return stored;
  }

  async getCurrentByWorkflowId(workflowId: string) {
    const result = await this.pool.query<AuthorityRow>(
      `SELECT workflow_id, workspace_id, snapshot_hash, payload
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
