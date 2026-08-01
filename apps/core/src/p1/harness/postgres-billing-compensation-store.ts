import type { Pool } from 'pg';

import {
  HarnessBillingCompensationConflictError,
  type HarnessBillingCompensationStore,
  type HarnessBillingCompensationTask,
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

      CREATE TABLE IF NOT EXISTS
        harness_runtime.billing_compensation_conflicts (
          action text NOT NULL,
          workspace_id text NOT NULL,
          task_id text NOT NULL,
          payload jsonb NOT NULL,
          status text NOT NULL,
          attempts integer NOT NULL,
          next_attempt_at timestamptz NOT NULL,
          last_error text,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL,
          archived_at timestamptz NOT NULL DEFAULT now(),
          archive_reason text NOT NULL,
          PRIMARY KEY (action, workspace_id, task_id)
        );

      WITH conflicts AS (
        SELECT workspace_id, task_id
        FROM harness_runtime.billing_compensations
        GROUP BY workspace_id, task_id
        HAVING count(DISTINCT action) > 1
      ),
      archived AS (
        INSERT INTO harness_runtime.billing_compensation_conflicts
          (action, workspace_id, task_id, payload, status, attempts,
           next_attempt_at, last_error, created_at, updated_at, archive_reason)
        SELECT tasks.action, tasks.workspace_id, tasks.task_id, tasks.payload,
               tasks.status, tasks.attempts, tasks.next_attempt_at,
               tasks.last_error, tasks.created_at, tasks.updated_at,
               'opposite_actions_before_task_settlement_fence'
        FROM harness_runtime.billing_compensations tasks
        JOIN conflicts
          ON conflicts.workspace_id=tasks.workspace_id
         AND conflicts.task_id=tasks.task_id
        ON CONFLICT (action, workspace_id, task_id) DO NOTHING
        RETURNING workspace_id, task_id
      )
      DELETE FROM harness_runtime.billing_compensations tasks
      USING conflicts
      WHERE tasks.workspace_id=conflicts.workspace_id
        AND tasks.task_id=conflicts.task_id;

      CREATE UNIQUE INDEX IF NOT EXISTS
        harness_billing_compensations_task_settlement_idx
        ON harness_runtime.billing_compensations (workspace_id, task_id);
    `);
  }

  async enqueue(input: HarnessBillingCompensationTask) {
    const result = await this.pool.query<{ action: 'commit' | 'refund' }>(
      `INSERT INTO harness_runtime.billing_compensations
         (action, workspace_id, task_id, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (workspace_id, task_id) DO UPDATE
         SET action=harness_runtime.billing_compensations.action
       RETURNING action`,
      [
        input.action,
        input.workspaceId,
        input.taskId,
        JSON.stringify(settlementPayload(input)),
      ],
    );
    if (result.rows[0]?.action !== input.action) {
      throw new HarnessBillingCompensationConflictError(input.taskId);
    }
  }

  /**
   * Rebuilds a missing settlement owner from canonical terminal facts. This is
   * the final fence when both direct settlement and the first enqueue failed.
   */
  async recoverOrphans(limit: number) {
    const result = await this.pool.query(
      `WITH terminal AS (
         SELECT usage.workspace_id,
                usage.task_id,
                usage.quote_id,
                usage.updated_at,
                quotes.payload->>'revision' AS quote_revision,
                (
                  SELECT deliveries.payload->'billingTrustedUsage'
                  FROM harness_runtime.audit_events deliveries
                  WHERE deliveries.workflow_id=requests.runtime_id
                    AND deliveries.event_type='package_delivered'
                  ORDER BY deliveries.created_at DESC
                  LIMIT 1
                ) AS trusted_usage,
                CASE
                  WHEN submissions.harness_state='failed' THEN 'refund'
                  WHEN EXISTS (
                    SELECT 1
                    FROM harness_runtime.decision_events decisions
                    WHERE decisions.task_id=requests.runtime_id
                      AND decisions.resolution_source='core_hold_expired'
                  ) OR EXISTS (
                    SELECT 1
                    FROM harness_runtime.audit_events failures
                    WHERE failures.workflow_id=requests.runtime_id
                      AND failures.event_type IN (
                        'workflow_failed', 'revision_conflict'
                      )
                  ) THEN 'refund'
                  WHEN EXISTS (
                    SELECT 1
                    FROM harness_runtime.audit_events deliveries
                    WHERE deliveries.workflow_id=requests.runtime_id
                      AND deliveries.event_type='package_delivered'
                      AND deliveries.created_at
                        <= clock_timestamp() - interval '5 minutes'
                  ) THEN 'commit'
                  ELSE NULL
                END AS action
         FROM p1_product_billing_usage usage
         JOIN p1_product_billing_quotes quotes
           ON quotes.workspace_id=usage.workspace_id
          AND quotes.quote_id=usage.quote_id
         LEFT JOIN harness_runtime.task_requests requests
           ON requests.workflow_id=usage.task_id
          AND requests.request->>'workspaceId'=usage.workspace_id
         LEFT JOIN execution_spine.creation_submissions submissions
           ON submissions.workspace_id=usage.workspace_id
          AND submissions.task_id=usage.task_id
         WHERE usage.status='reserved'
       ),
       ready AS (
         SELECT *
         FROM terminal
         WHERE action IS NOT NULL
           AND quote_revision IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM harness_runtime.billing_compensations existing
             WHERE existing.workspace_id=terminal.workspace_id
               AND existing.task_id=terminal.task_id
           )
         ORDER BY updated_at, task_id
         LIMIT $1
       ),
       inserted AS (
         INSERT INTO harness_runtime.billing_compensations
           (action, workspace_id, task_id, payload)
         SELECT ready.action,
                ready.workspace_id,
                ready.task_id,
                jsonb_build_object(
                  'workspaceId', ready.workspace_id,
                  'taskId', ready.task_id,
                  'quoteId', ready.quote_id,
                  'quoteRevision', ready.quote_revision
                ) || CASE
                  WHEN ready.trusted_usage IS NOT NULL
                    THEN jsonb_build_object(
                      'trustedUsage', ready.trusted_usage
                    )
                  ELSE '{}'::jsonb
                END
         FROM ready
         ON CONFLICT (workspace_id, task_id) DO NOTHING
         RETURNING 1
       )
       SELECT count(*)::int AS recovered FROM inserted`,
      [limit],
    );
    return Number(result.rows[0]?.recovered ?? 0);
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
    ...(input.forceCreditRefund ? { forceCreditRefund: true } : {}),
  };
}
