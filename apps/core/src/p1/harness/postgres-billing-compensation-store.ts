import type { Pool } from 'pg';

import { settlementIdempotencyKey } from '../execution-spine/billing-identity.js';
import {
  HarnessBillingCompensationConflictError,
  type HarnessBillingCompensationStore,
  type HarnessBillingCompensationTask,
} from './billing-compensation.js';

/**
 * Keep SQL orphan recovery on the same idempotency-key contract as the
 * TypeScript settlement boundary. Package carriers add the frozen contract
 * hash and their allocation id; omitting those fields lets recovery collide
 * two carrier units that happen to share the legacy coordinates.
 */
function billingUnitSettlementKeySql(identityExpression: string): string {
  const identity = `(${identityExpression})`;
  const field = (name: string) => `${identity}->>'${name}'`;
  const encode = (value: string) =>
    `replace(encode(convert_to(${value}, 'UTF8'), 'base64'), E'\\n', '')`;
  const allocationId =
    `(SELECT allocation->>'allocationId'
        FROM jsonb_array_elements(${identity}->'packageBilling'->'allocations') AS allocation
       WHERE allocation->>'carrierUnitId' = ${field('carrierUnitId')}
       LIMIT 1)`;
  const packageSuffix = `CASE
    WHEN COALESCE(jsonb_typeof(${identity}->'packageBilling'), 'null') = 'object'
      THEN ':' || ${encode(`${identity}#>>'{packageBilling,contractHash}'`)}
        || ':' || ${encode(allocationId)}
    ELSE ''
  END`;
  return `'billing-unit:' || concat_ws(':',
    ${encode(field('workspaceId'))},
    ${encode(field('workId'))},
    ${encode(`${identity}#>>'{quoteRef,id}'`)},
    ${encode(`${identity}#>>'{quoteRef,revision}'`)},
    ${encode(field('reservationId'))},
    ${encode(field('carrierUnitId'))}
  ) || ${packageSuffix}`;
}

/** A malformed package contract must be archived, never assigned a legacy key. */
function billingIdentityPackageKeyGuardSql(identityExpression: string): string {
  const identity = `(${identityExpression})`;
  return `(
    COALESCE(jsonb_typeof(${identity}->'packageBilling'), 'null') <> 'object'
    OR (
      btrim(COALESCE(${identity}#>>'{packageBilling,contractHash}', '')) <> ''
      AND jsonb_typeof(${identity}#>'{packageBilling,allocations}') = 'array'
      AND (
        SELECT count(*)
          FROM jsonb_array_elements(${identity}#>'{packageBilling,allocations}') AS allocation
         WHERE allocation->>'carrierUnitId' = ${identity}->>'carrierUnitId'
           AND btrim(COALESCE(allocation->>'allocationId', '')) <> ''
      ) = 1
    )
  )`;
}

function settlementKey(input: HarnessBillingCompensationTask): string {
  return settlementIdempotencyKey(input.billingIdentity);
}

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
        billing_task_id text,
        settlement_idempotency_key text,
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

      ALTER TABLE harness_runtime.billing_compensations
        ADD COLUMN IF NOT EXISTS billing_task_id text;
      ALTER TABLE harness_runtime.billing_compensations
        ADD COLUMN IF NOT EXISTS settlement_idempotency_key text;

      UPDATE harness_runtime.billing_compensations
         SET billing_task_id = payload#>>'{billingIdentity,taskId}',
             settlement_idempotency_key = ${billingUnitSettlementKeySql("payload->'billingIdentity'")}
       WHERE settlement_idempotency_key IS NULL
         AND btrim(payload#>>'{billingIdentity,workspaceId}') <> ''
         AND btrim(payload#>>'{billingIdentity,taskId}') <> ''
         AND btrim(payload#>>'{billingIdentity,workId}') <> ''
         AND btrim(payload#>>'{billingIdentity,workflowId}') <> ''
         AND btrim(payload#>>'{billingIdentity,quoteRef,id}') <> ''
         AND btrim(payload#>>'{billingIdentity,quoteRef,revision}') <> ''
         AND btrim(payload#>>'{billingIdentity,reservationId}') <> ''
         AND btrim(payload#>>'{billingIdentity,carrierUnitId}') <> ''
         -- A complete identity is insufficient if the old queue payload names
         -- different routing facts. Such a row cannot be safely repaired: it
         -- must go through the conflict archive below rather than retrying a
         -- settlement against a guessed owner.
         AND payload->>'workspaceId'=payload#>>'{billingIdentity,workspaceId}'
         AND payload->>'taskId'=payload#>>'{billingIdentity,workflowId}'
         AND payload->>'billingTaskId'=payload#>>'{billingIdentity,taskId}'
         AND payload->>'quoteId'=payload#>>'{billingIdentity,quoteRef,id}'
         AND payload->>'quoteRevision'=payload#>>'{billingIdentity,quoteRef,revision}'
         AND task_id=payload->>'taskId'
         AND CASE
           WHEN jsonb_typeof(payload#>'{billingIdentity,carrierUnitIds}')='array'
             THEN jsonb_array_length(payload#>'{billingIdentity,carrierUnitIds}') > 0
               AND payload#>'{billingIdentity,carrierUnitIds}' @>
                   jsonb_build_array(to_jsonb(payload#>>'{billingIdentity,carrierUnitId}'))
               AND jsonb_array_length(payload#>'{billingIdentity,carrierUnitIds}')=(
                 SELECT count(DISTINCT btrim(unit))
                   FROM jsonb_array_elements_text(
                     payload#>'{billingIdentity,carrierUnitIds}'
                   ) AS carrier_units(unit)
               )
               AND NOT EXISTS (
                 SELECT 1
                   FROM jsonb_array_elements(
                     payload#>'{billingIdentity,carrierUnitIds}'
                   ) AS carrier_units(value)
                  WHERE jsonb_typeof(value) <> 'string'
               )
               AND NOT EXISTS (
                 SELECT 1
                   FROM jsonb_array_elements_text(
                     payload#>'{billingIdentity,carrierUnitIds}'
                   ) AS carrier_units(unit)
                  WHERE btrim(unit)=''
               )
           ELSE false
         END
         AND CASE
           WHEN jsonb_typeof(payload#>'{billingIdentity,carrierBillableUnits}')='number'
             AND (payload#>>'{billingIdentity,carrierBillableUnits}') ~ '^[1-9][0-9]*$'
             THEN (payload#>>'{billingIdentity,carrierBillableUnits}')::numeric
                    <= 9007199254740991
           ELSE false
         END
         AND ${billingIdentityPackageKeyGuardSql("payload->'billingIdentity'")};

      CREATE TABLE IF NOT EXISTS
        harness_runtime.billing_compensation_conflicts (
          action text NOT NULL,
          workspace_id text NOT NULL,
          task_id text NOT NULL,
          billing_task_id text,
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

      ALTER TABLE harness_runtime.billing_compensation_conflicts
        ADD COLUMN IF NOT EXISTS billing_task_id text;

      INSERT INTO harness_runtime.billing_compensation_conflicts
        (action, workspace_id, task_id, billing_task_id, payload, status,
         attempts, next_attempt_at, last_error, created_at, updated_at,
         archive_reason)
      SELECT action, workspace_id, task_id, billing_task_id, payload, status,
             attempts, next_attempt_at, last_error, created_at, updated_at,
             'legacy_missing_frozen_billing_identity'
        FROM harness_runtime.billing_compensations
       WHERE settlement_idempotency_key IS NULL
      ON CONFLICT (action, workspace_id, task_id) DO NOTHING;
      DELETE FROM harness_runtime.billing_compensations
       WHERE settlement_idempotency_key IS NULL;

      ALTER TABLE harness_runtime.billing_compensations
        ALTER COLUMN billing_task_id SET NOT NULL;
      ALTER TABLE harness_runtime.billing_compensations
        ALTER COLUMN settlement_idempotency_key SET NOT NULL;
      CREATE INDEX IF NOT EXISTS harness_billing_compensations_ready_idx
        ON harness_runtime.billing_compensations
          (status, next_attempt_at, created_at);

      WITH conflicts AS (
        SELECT workspace_id, settlement_idempotency_key
        FROM harness_runtime.billing_compensations
        GROUP BY workspace_id, settlement_idempotency_key
        HAVING count(DISTINCT action) > 1
      ),
      archived AS (
        INSERT INTO harness_runtime.billing_compensation_conflicts
          (action, workspace_id, task_id, billing_task_id, payload, status,
           attempts, next_attempt_at, last_error, created_at, updated_at,
           archive_reason)
        SELECT tasks.action, tasks.workspace_id, tasks.task_id,
               tasks.billing_task_id, tasks.payload, tasks.status,
               tasks.attempts, tasks.next_attempt_at, tasks.last_error,
               tasks.created_at, tasks.updated_at,
               'opposite_actions_before_task_settlement_fence'
        FROM harness_runtime.billing_compensations tasks
        JOIN conflicts
          ON conflicts.workspace_id=tasks.workspace_id
         AND conflicts.settlement_idempotency_key=tasks.settlement_idempotency_key
        ON CONFLICT (action, workspace_id, task_id) DO NOTHING
        RETURNING workspace_id
      )
      DELETE FROM harness_runtime.billing_compensations tasks
      USING conflicts
      WHERE tasks.workspace_id=conflicts.workspace_id
        AND tasks.settlement_idempotency_key=conflicts.settlement_idempotency_key;

      DROP INDEX IF EXISTS
        harness_runtime.harness_billing_compensations_task_settlement_idx;
      CREATE UNIQUE INDEX
        harness_billing_compensations_task_settlement_idx
        ON harness_runtime.billing_compensations
          (workspace_id, settlement_idempotency_key);
    `);
  }

  async enqueue(input: HarnessBillingCompensationTask) {
    assertCompensationInputIdentity(input);
    const fenceKey = settlementKey(input);
    const result = await this.pool.query<{ action: 'commit' | 'refund' }>(
      `INSERT INTO harness_runtime.billing_compensations
         (action, workspace_id, task_id, billing_task_id, settlement_idempotency_key, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (workspace_id, settlement_idempotency_key) DO UPDATE
         SET action=harness_runtime.billing_compensations.action
       RETURNING action`,
      [
        input.action,
        input.workspaceId,
        input.taskId,
        input.billingTaskId,
        fenceKey,
        JSON.stringify(settlementPayload(input, fenceKey)),
      ],
    );
    if (result.rows[0]?.action !== input.action) {
      throw new HarnessBillingCompensationConflictError(fenceKey);
    }
  }

  /**
   * Recovers only a settlement owner already pinned by a complete durable
   * BillingIdentity. Old rows without that evidence were archived during
   * migration; this worker never reconstructs a billing axis from workflow,
   * source-task, or current ProductUsage fields.
   */
  async recoverOrphans(limit: number) {
    const result = await this.pool.query(
      `WITH terminal AS (
         SELECT usage.workspace_id,
                usage.task_id AS billing_task_id,
                requests.billing_identity->>'workflowId' AS task_id,
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
                  ) THEN true
                  ELSE false
                END AS force_credit_refund,
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
                END AS action,
                -- R-P0-05: recovered settlements carry the explicit frozen
                -- credit-ledger operation. A confirmation hold key or legacy
                -- reservation fingerprint is never guessed as a refund op.
                requests.billing_identity AS billing_identity,
                CASE
                  WHEN btrim(requests.billing_identity->>'creditUsageOperationId') <> ''
                    THEN requests.billing_identity->>'creditUsageOperationId'
                  ELSE NULL
                END AS credit_usage_operation_id
         FROM p1_product_billing_usage usage
         JOIN p1_product_billing_quotes quotes
           ON quotes.workspace_id=usage.workspace_id
          AND quotes.quote_id=usage.quote_id
         JOIN harness_runtime.task_requests requests
           ON requests.request->>'workspaceId'=usage.workspace_id
          AND requests.billing_identity->>'workspaceId'=usage.workspace_id
          AND requests.billing_identity->>'taskId'=usage.task_id
          AND requests.billing_identity#>>'{quoteRef,id}'=usage.quote_id
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
           AND billing_identity IS NOT NULL
           AND billing_identity->>'workflowId'=task_id
           AND billing_identity#>>'{quoteRef,revision}'=quote_revision
           AND billing_identity->>'carrierUnitId' IS NOT NULL
           AND billing_identity->>'carrierUnitId' <> ''
           AND billing_identity ? 'carrierUnitIds'
           AND billing_identity ? 'carrierBillableUnits'
           AND ${billingIdentityPackageKeyGuardSql('billing_identity')}
           AND NOT EXISTS (
             SELECT 1
             FROM harness_runtime.billing_compensations existing
             WHERE existing.workspace_id=terminal.workspace_id
               AND existing.settlement_idempotency_key=
                 ${billingUnitSettlementKeySql('terminal.billing_identity')}
           )
         ORDER BY updated_at, billing_task_id
         LIMIT $1
       ),
       inserted AS (
         INSERT INTO harness_runtime.billing_compensations
           (action, workspace_id, task_id, billing_task_id, settlement_idempotency_key, payload)
         SELECT ready.action,
                ready.workspace_id,
                ready.task_id,
                ready.billing_task_id,
                ${billingUnitSettlementKeySql('ready.billing_identity')},
                 jsonb_build_object(
                   'workspaceId', ready.workspace_id,
                   'taskId', ready.task_id,
                   'billingTaskId', ready.billing_task_id,
                   'quoteId', ready.quote_id,
                   'quoteRevision', ready.quote_revision,
                   'settlementIdempotencyKey',
                     ${billingUnitSettlementKeySql('ready.billing_identity')}
                 ) || CASE
                   WHEN ready.billing_identity IS NOT NULL
                     THEN jsonb_build_object(
                       'billingIdentity', ready.billing_identity
                     )
                   ELSE '{}'::jsonb
                 END || CASE
                   WHEN ready.credit_usage_operation_id IS NOT NULL
                     THEN jsonb_build_object(
                       'creditUsageOperationId',
                       ready.credit_usage_operation_id
                     )
                   ELSE '{}'::jsonb
                 END || CASE
                   WHEN ready.trusted_usage IS NOT NULL
                     THEN jsonb_build_object(
                       'trustedUsage', ready.trusted_usage
                     )
                   ELSE '{}'::jsonb
                 END || CASE
                   WHEN ready.force_credit_refund
                     THEN jsonb_build_object('forceCreditRefund', true)
                   ELSE '{}'::jsonb
                 END
         FROM ready
         ON CONFLICT (workspace_id, settlement_idempotency_key) DO NOTHING
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
         SELECT action, workspace_id, settlement_idempotency_key
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
          AND tasks.settlement_idempotency_key = ready.settlement_idempotency_key
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
        WHERE action = $1 AND workspace_id = $2
          AND settlement_idempotency_key = $3`,
      [input.action, input.workspaceId, settlementKey(input)],
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
        WHERE action = $1 AND workspace_id = $2
          AND settlement_idempotency_key = $3`,
      [
        input.action,
        input.workspaceId,
        settlementKey(input),
        error.slice(0, 2_000),
        retryAt,
      ],
    );
  }
}

/**
 * Queue admission is a billing boundary too: scheduling happens before the
 * synchronous settle/refund call, so a malformed caller payload must not be
 * persisted and retried forever against a different authority.
 */
function assertCompensationInputIdentity(
  input: HarnessBillingCompensationTask,
): void {
  const identity = input.billingIdentity;
  if (
    identity.workspaceId !== input.workspaceId ||
    identity.workflowId !== input.taskId ||
    identity.taskId !== input.billingTaskId ||
    identity.quoteRef.id !== input.quoteId ||
    identity.quoteRef.revision !== input.quoteRevision
  ) {
    throw new Error(
      'Billing compensation input does not match its frozen identity.',
    );
  }
  const suppliedCreditUsageOperationId = input.creditUsageOperationId?.trim();
  if (
    suppliedCreditUsageOperationId &&
    suppliedCreditUsageOperationId !== identity.creditUsageOperationId
  ) {
    throw new Error(
      'Billing compensation credit usage operation does not match its frozen identity.',
    );
  }
}

function settlementPayload(
  input: HarnessBillingCompensationTask,
  key: string,
): Omit<HarnessBillingCompensationTask, 'action' | 'attempts'> {
  return {
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    billingTaskId: input.billingTaskId,
    billingIdentity: input.billingIdentity,
    settlementIdempotencyKey: key,
    quoteId: input.quoteId,
    quoteRevision: input.quoteRevision,
    ...(input.creditUsageOperationId
      ? { creditUsageOperationId: input.creditUsageOperationId }
      : {}),
    ...(input.trustedUsage ? { trustedUsage: input.trustedUsage } : {}),
    ...(input.partialDelivery ? { partialDelivery: input.partialDelivery } : {}),
    ...(input.forceCreditRefund ? { forceCreditRefund: true } : {}),
  };
}
