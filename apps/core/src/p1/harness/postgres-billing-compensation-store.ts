import type { Pool } from 'pg';

import type {
  HarnessBillingCompensationStore,
  HarnessBillingCompensationTask,
} from './billing-compensation.js';

export class PostgresHarnessBillingCompensationStore
  implements HarnessBillingCompensationStore
{
  constructor(private readonly pool: Pool) {}

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS harness_runtime.billing_compensations (
        action text NOT NULL CHECK (action IN ('commit', 'refund')),
        workspace_id text NOT NULL,
        task_id text NOT NULL,
        payload jsonb NOT NULL,
        status text NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'processing', 'completed')),
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (action, workspace_id, task_id)
      );

      CREATE INDEX IF NOT EXISTS harness_billing_compensations_ready_idx
        ON harness_runtime.billing_compensations
          (status, next_attempt_at, created_at);
    `);
  }

  async enqueue(input: HarnessBillingCompensationTask) {
    await this.pool.query(
      `INSERT INTO harness_runtime.billing_compensations
         (action, workspace_id, task_id, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (action, workspace_id, task_id) DO NOTHING`,
      [
        input.action,
        input.workspaceId,
        input.taskId,
        JSON.stringify(settlementPayload(input)),
      ],
    );
  }

  async claimBatch(limit: number): Promise<HarnessBillingCompensationTask[]> {
    const result = await this.pool.query<{
      action: 'commit' | 'refund';
      attempts: number;
      payload: Omit<HarnessBillingCompensationTask, 'action' | 'attempts'>;
    }>(
      `WITH ready AS (
         SELECT action, workspace_id, task_id
           FROM harness_runtime.billing_compensations
          WHERE (
                  status = 'pending'
                  AND next_attempt_at <= now()
                )
             OR (
                  status = 'processing'
                  AND updated_at < now() - interval '1 minute'
                )
          ORDER BY next_attempt_at, created_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE harness_runtime.billing_compensations tasks
          SET status = 'processing',
              attempts = tasks.attempts + 1,
              updated_at = now()
         FROM ready
        WHERE tasks.action = ready.action
          AND tasks.workspace_id = ready.workspace_id
          AND tasks.task_id = ready.task_id
       RETURNING tasks.action, tasks.attempts, tasks.payload`,
      [limit],
    );
    return result.rows.map((row) => ({
      action: row.action,
      attempts: row.attempts,
      ...row.payload,
    }));
  }

  async markCompleted(input: HarnessBillingCompensationTask) {
    await this.pool.query(
      `UPDATE harness_runtime.billing_compensations
          SET status = 'completed',
              last_error = NULL,
              updated_at = now()
        WHERE action = $1 AND workspace_id = $2 AND task_id = $3`,
      [input.action, input.workspaceId, input.taskId],
    );
  }

  async markFailed(
    input: HarnessBillingCompensationTask,
    error: string,
    retryAt: Date,
  ) {
    await this.pool.query(
      `UPDATE harness_runtime.billing_compensations
          SET status = 'pending',
              last_error = $4,
              next_attempt_at = $5,
              updated_at = now()
        WHERE action = $1 AND workspace_id = $2 AND task_id = $3`,
      [
        input.action,
        input.workspaceId,
        input.taskId,
        error.slice(0, 2_000),
        retryAt,
      ],
    );
  }
}

function settlementPayload(
  input: HarnessBillingCompensationTask,
): Omit<HarnessBillingCompensationTask, 'action' | 'attempts'> {
  return {
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    quoteId: input.quoteId,
    quoteRevision: input.quoteRevision,
    ...(input.trustedUsage ? { trustedUsage: input.trustedUsage } : {}),
  };
}
