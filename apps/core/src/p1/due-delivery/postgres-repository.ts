import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  DEFAULT_DUE_DELIVERY_RETENTION_DAYS,
  DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY,
  dueDeliveryRetentionDaysConfigSchema,
  type AdminConfigRepository,
} from '../admin-config/foundation-module.js';
import type {
  DueDeliveryClaim,
  DueDeliveryClaimIdentity,
  DueDeliveryPayload,
  DueDeliveryRepository,
  DueDeliverySuppressionReason,
  DueDeliveryType,
  NextDailyRecommendationDue,
} from './worker.js';

export interface EnqueueDueDeliveryInput {
  businessDate?: string;
  dueAt: string;
  payload: DueDeliveryPayload;
  taskId: string;
  type: DueDeliveryType;
  workspaceId: string;
}

interface DueDeliveryRow {
  attempt_count: number;
  business_date: Date | string | null;
  claim_token: string | null;
  due_at: Date | string;
  id: string;
  payload: unknown;
  task_id: string;
  type: DueDeliveryType;
  workspace_id: string;
}

interface EnqueuedRow extends DueDeliveryRow {
  fingerprint: string;
}

export interface LatestDeliveredDue {
  businessDate: string | null;
  completedAt: string;
  output: Record<string, unknown>;
  runId: string;
  taskId: string;
}

export class DueDeliveryIdempotencyConflictError extends Error {
  readonly code = 'DUE_DELIVERY_IDEMPOTENCY_CONFLICT';

  constructor(readonly taskId: string) {
    super(`Due delivery task ${taskId} was reused with different input.`);
    this.name = 'DueDeliveryIdempotencyConflictError';
  }
}

export class PostgresDueDeliveryRepository
  implements DueDeliveryRepository
{
  constructor(
    private readonly pool: Pool,
    private readonly config?: Pick<AdminConfigRepository, 'get'>,
  ) {}

  async ensureDailyRecommendationDue(
    workspaceId: string,
    businessDate: string,
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)) {
      throw new Error('Daily recommendation businessDate must be a date.');
    }
    return this.enqueue({
      businessDate,
      dueAt: `${businessDate}T00:00:00.000Z`,
      payload: {
        businessDate,
        schemaVersion: 'daily-recommendation/v1',
      },
      taskId: `daily-rec_${workspaceId}_${businessDate}`,
      type: 'daily_recommendation',
      workspaceId,
    });
  }

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_due_delivery_items (
        workspace_id text NOT NULL,
        id text NOT NULL,
        task_id text NOT NULL,
        type text NOT NULL CHECK (
          type IN ('daily_recommendation', 'task_recall')
        ),
        due_at timestamptz NOT NULL,
        business_date date,
        payload jsonb NOT NULL,
        fingerprint text NOT NULL,
        status text NOT NULL DEFAULT 'pending' CHECK (
          status IN (
            'pending',
            'claimed',
            'retry',
            'delivered',
            'suppressed',
            'dead_letter'
          )
        ),
        attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        next_attempt_at timestamptz NOT NULL,
        claimed_by text,
        claim_token text,
        lease_expires_at timestamptz,
        delivery_run_id text,
        last_error text,
        completed_at timestamptz,
        retain_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, id),
        UNIQUE (workspace_id, task_id)
      );
      CREATE INDEX IF NOT EXISTS p1_due_delivery_items_claim_idx
        ON p1_due_delivery_items (
          next_attempt_at,
          due_at,
          workspace_id,
          id
        )
        WHERE status IN ('pending', 'claimed', 'retry');

      CREATE TABLE IF NOT EXISTS p1_due_delivery_runs (
        workspace_id text NOT NULL,
        id text NOT NULL,
        due_id text NOT NULL,
        task_id text NOT NULL,
        type text NOT NULL CHECK (
          type IN ('daily_recommendation', 'task_recall')
        ),
        actor_id text NOT NULL CHECK (actor_id = 'system:due-scanner'),
        status text NOT NULL CHECK (
          status IN ('started', 'retry', 'delivered', 'dead_letter')
        ),
        attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
        output jsonb,
        last_error text,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        retain_until timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, id),
        UNIQUE (workspace_id, due_id),
        UNIQUE (workspace_id, task_id),
        FOREIGN KEY (workspace_id, due_id)
          REFERENCES p1_due_delivery_items (workspace_id, id)
          ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS p1_due_delivery_runs_retention_idx
        ON p1_due_delivery_runs (retain_until, workspace_id, id)
        WHERE retain_until IS NOT NULL;
    `);
  }

  async enqueue(input: EnqueueDueDeliveryInput) {
    validateEnqueueInput(input);
    const id = dueDeliveryId(input.workspaceId, input.taskId);
    const fingerprint = dueDeliveryFingerprint(input);
    const inserted = await this.pool.query<EnqueuedRow>(
      `INSERT INTO p1_due_delivery_items (
         workspace_id,
         id,
         task_id,
         type,
         due_at,
         business_date,
         payload,
         fingerprint,
         next_attempt_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $5)
       ON CONFLICT (workspace_id, task_id) DO NOTHING
       RETURNING *`,
      [
        input.workspaceId,
        id,
        input.taskId,
        input.type,
        input.dueAt,
        input.businessDate ?? null,
        input.payload,
        fingerprint,
      ],
    );
    const row =
      inserted.rows[0] ??
      (
        await this.pool.query<EnqueuedRow>(
          `SELECT *
             FROM p1_due_delivery_items
            WHERE workspace_id = $1 AND task_id = $2`,
          [input.workspaceId, input.taskId],
        )
      ).rows[0];
    if (!row || row.fingerprint !== fingerprint) {
      throw new DueDeliveryIdempotencyConflictError(input.taskId);
    }
    return dueDeliveryClaim(row);
  }

  async claimBatch(input: {
    claimToken: string;
    leaseMs: number;
    limit: number;
    now: Date;
    workerId: string;
  }) {
    const result = await this.pool.query<DueDeliveryRow>(
      `WITH candidates AS (
         SELECT workspace_id, id
           FROM p1_due_delivery_items
          WHERE (
                  status IN ('pending', 'retry')
                  AND due_at <= $1
                  AND next_attempt_at <= $1
                )
             OR (
                  status = 'claimed'
                  AND lease_expires_at <= $1
                )
          ORDER BY next_attempt_at, due_at, workspace_id, id
          FOR UPDATE SKIP LOCKED
          LIMIT $5
       )
       UPDATE p1_due_delivery_items item
          SET status = 'claimed',
              attempt_count = attempt_count + 1,
              claimed_by = $2,
              claim_token = $3,
              lease_expires_at =
                $1 + ($4::bigint * interval '1 millisecond'),
              updated_at = $1
         FROM candidates
        WHERE item.workspace_id = candidates.workspace_id
          AND item.id = candidates.id
       RETURNING item.*`,
      [
        input.now,
        input.workerId,
        input.claimToken,
        input.leaseMs,
        input.limit,
      ],
    );
    return result.rows.map(dueDeliveryClaim);
  }

  async readLatestDelivered(
    workspaceId: string,
    type: DueDeliveryType,
  ): Promise<LatestDeliveredDue | null> {
    const result = await this.pool.query<{
      business_date: Date | string | null;
      completed_at: Date | string;
      output: unknown;
      run_id: string;
      task_id: string;
    }>(
      `SELECT item.task_id,
              item.business_date,
              run.id AS run_id,
              run.output,
              run.completed_at
         FROM p1_due_delivery_items item
         JOIN p1_due_delivery_runs run
           ON run.workspace_id = item.workspace_id
          AND run.due_id = item.id
        WHERE item.workspace_id = $1
          AND item.type = $2
          AND item.status = 'delivered'
          AND run.status = 'delivered'
        ORDER BY run.completed_at DESC, run.id DESC
        LIMIT 1`,
      [workspaceId, type],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    if (!row.output || typeof row.output !== 'object' || Array.isArray(row.output)) {
      throw new Error('Delivered due output must be an object.');
    }
    return {
      businessDate: row.business_date ? dateOnly(row.business_date) : null,
      completedAt: timestamp(row.completed_at),
      output: row.output as Record<string, unknown>,
      runId: row.run_id,
      taskId: row.task_id,
    };
  }

  async beginDelivery(input: {
    identity: DueDeliveryClaimIdentity;
    taskId: string;
    type: DueDeliveryType;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{
        attempt_count: number;
        task_id: string;
        type: DueDeliveryType;
      }>(
        `SELECT attempt_count, task_id, type
           FROM p1_due_delivery_items
          WHERE workspace_id = $1
            AND id = $2
            AND status = 'claimed'
            AND claim_token = $3
            AND lease_expires_at > now()
          FOR UPDATE`,
        [
          input.identity.workspaceId,
          input.identity.dueId,
          input.identity.claimToken,
        ],
      );
      const due = current.rows[0];
      if (
        !due ||
        due.task_id !== input.taskId ||
        due.type !== input.type
      ) {
        await client.query('ROLLBACK');
        return null;
      }
      const runId = `delivery-run:${due.task_id}`;
      await client.query(
        `INSERT INTO p1_due_delivery_runs (
           workspace_id,
           id,
           due_id,
           task_id,
           type,
           actor_id,
           status,
           attempt_count
         ) VALUES ($1, $2, $3, $4, $5, 'system:due-scanner', 'started', $6)
         ON CONFLICT (workspace_id, due_id) DO UPDATE
           SET status = CASE
                 WHEN p1_due_delivery_runs.status = 'delivered'
                   THEN p1_due_delivery_runs.status
                 ELSE 'started'
               END,
               attempt_count = GREATEST(
                 p1_due_delivery_runs.attempt_count,
                 EXCLUDED.attempt_count
               ),
               updated_at = now()
         RETURNING id`,
        [
          input.identity.workspaceId,
          runId,
          input.identity.dueId,
          due.task_id,
          due.type,
          due.attempt_count,
        ],
      );
      await client.query('COMMIT');
      return { runId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async settleDelivered(input: {
    identity: DueDeliveryClaimIdentity;
    nextDue?: NextDailyRecommendationDue;
    output: Record<string, unknown>;
    runId: string;
  }) {
    const retentionDays = await this.readTerminalRetentionDays();
    return this.withClaimSettlement(input.identity, async (client) => {
      await client.query(
        `UPDATE p1_due_delivery_items
            SET status = 'delivered',
                delivery_run_id = $4,
                claimed_by = NULL,
                claim_token = NULL,
                lease_expires_at = NULL,
                last_error = NULL,
                completed_at = now(),
                retain_until =
                  now() + ($5::integer * interval '1 day'),
                updated_at = now()
          WHERE workspace_id = $1 AND id = $2 AND claim_token = $3`,
        [
          input.identity.workspaceId,
          input.identity.dueId,
          input.identity.claimToken,
          input.runId,
          retentionDays,
        ],
      );
      const run = await client.query(
        `UPDATE p1_due_delivery_runs
            SET status = 'delivered',
                output = $4::jsonb,
                last_error = NULL,
                completed_at = now(),
                retain_until =
                  now() + ($5::integer * interval '1 day'),
                updated_at = now()
          WHERE workspace_id = $1 AND due_id = $2 AND id = $3
          RETURNING id`,
        [
          input.identity.workspaceId,
          input.identity.dueId,
          input.runId,
          input.output,
          retentionDays,
        ],
      );
      if (run.rowCount !== 1) {
        throw new Error('Due delivery run is missing during settlement.');
      }
      if (input.nextDue) {
        await this.enqueueNextDaily(client, input.identity.workspaceId, input.nextDue);
      }
    });
  }

  async settleSuppressed(input: {
    identity: DueDeliveryClaimIdentity;
    nextDue?: NextDailyRecommendationDue;
    reason: DueDeliverySuppressionReason;
    suppressedAt: Date;
  }) {
    const retentionDays = await this.readTerminalRetentionDays();
    return this.withClaimSettlement(input.identity, async (client) => {
      await client.query(
        `UPDATE p1_due_delivery_items
            SET status = 'suppressed',
                claimed_by = NULL,
                claim_token = NULL,
                lease_expires_at = NULL,
                last_error = $4,
                completed_at = $5::timestamptz,
                retain_until =
                  $5::timestamptz + ($6::integer * interval '1 day'),
                updated_at = $5::timestamptz
          WHERE workspace_id = $1 AND id = $2 AND claim_token = $3`,
        [
          input.identity.workspaceId,
          input.identity.dueId,
          input.identity.claimToken,
          input.reason,
          input.suppressedAt,
          retentionDays,
        ],
      );
      if (input.nextDue) {
        await this.enqueueNextDaily(client, input.identity.workspaceId, input.nextDue);
      }
    });
  }

  async settleFailed(input: {
    deadLetter: boolean;
    error: string;
    failedAt: Date;
    identity: DueDeliveryClaimIdentity;
    retryAt: Date;
    runId?: string;
  }) {
    const retentionDays = input.deadLetter
      ? await this.readTerminalRetentionDays()
      : DEFAULT_DUE_DELIVERY_RETENTION_DAYS;
    return this.withClaimSettlement(input.identity, async (client) => {
      await client.query(
        `UPDATE p1_due_delivery_items
            SET status = $4,
                next_attempt_at = $5,
                claimed_by = NULL,
                claim_token = NULL,
                lease_expires_at = NULL,
                last_error = $6,
                completed_at = CASE
                  WHEN $4 = 'dead_letter' THEN $7::timestamptz
                  ELSE NULL
                END,
                retain_until = CASE
                  WHEN $4 = 'dead_letter'
                    THEN $7::timestamptz + ($8::integer * interval '1 day')
                  ELSE NULL
                END,
                updated_at = $7::timestamptz
          WHERE workspace_id = $1 AND id = $2 AND claim_token = $3`,
        [
          input.identity.workspaceId,
          input.identity.dueId,
          input.identity.claimToken,
          input.deadLetter ? 'dead_letter' : 'retry',
          input.retryAt,
          input.error,
          input.failedAt,
          retentionDays,
        ],
      );
      if (input.runId) {
        await client.query(
          `UPDATE p1_due_delivery_runs
              SET status = $4,
                  last_error = $5,
                  completed_at = CASE
                    WHEN $4 = 'dead_letter' THEN $6::timestamptz
                    ELSE NULL
                  END,
                  retain_until = CASE
                    WHEN $4 = 'dead_letter'
                      THEN $6::timestamptz + ($7::integer * interval '1 day')
                    ELSE NULL
                  END,
                  updated_at = $6::timestamptz
            WHERE workspace_id = $1 AND due_id = $2 AND id = $3`,
          [
            input.identity.workspaceId,
            input.identity.dueId,
            input.runId,
            input.deadLetter ? 'dead_letter' : 'retry',
            input.error,
            input.failedAt,
            retentionDays,
          ],
        );
      }
    });
  }

  async purgeExpired(now: Date, limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Due delivery purge limit must be a positive integer.');
    }
    if (Number.isNaN(now.getTime())) {
      throw new Error('Due delivery purge time must be valid.');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const candidates = await client.query<{
        id: string;
        workspace_id: string;
      }>(
        `SELECT workspace_id, id
           FROM p1_due_delivery_items
          WHERE status IN ('delivered', 'suppressed', 'dead_letter')
            AND retain_until <= $1
          ORDER BY retain_until, workspace_id, id
          FOR UPDATE SKIP LOCKED
          LIMIT $2`,
        [now, limit],
      );
      if (candidates.rowCount === 0) {
        await client.query('COMMIT');
        return { deletedItems: 0, deletedRuns: 0 };
      }
      const workspaceIds = candidates.rows.map((row) => row.workspace_id);
      const dueIds = candidates.rows.map((row) => row.id);
      const runs = await client.query(
        `DELETE FROM p1_due_delivery_runs run
          USING unnest($1::text[], $2::text[]) AS target(workspace_id, due_id)
          WHERE run.workspace_id = target.workspace_id
            AND run.due_id = target.due_id
          RETURNING run.id`,
        [workspaceIds, dueIds],
      );
      const items = await client.query(
        `DELETE FROM p1_due_delivery_items item
          USING unnest($1::text[], $2::text[]) AS target(workspace_id, due_id)
          WHERE item.workspace_id = target.workspace_id
            AND item.id = target.due_id
            AND item.status IN ('delivered', 'suppressed', 'dead_letter')
            AND item.retain_until <= $3
          RETURNING item.id`,
        [workspaceIds, dueIds, now],
      );
      await client.query('COMMIT');
      return {
        deletedItems: items.rowCount ?? 0,
        deletedRuns: runs.rowCount ?? 0,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async withClaimSettlement(
    identity: DueDeliveryClaimIdentity,
    action: (client: PoolClient) => Promise<void>,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT 1
           FROM p1_due_delivery_items
          WHERE workspace_id = $1
            AND id = $2
            AND status = 'claimed'
            AND claim_token = $3
            AND lease_expires_at > now()
          FOR UPDATE`,
        [identity.workspaceId, identity.dueId, identity.claimToken],
      );
      if (locked.rowCount !== 1) {
        await client.query('ROLLBACK');
        return false;
      }
      await action(client);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async readTerminalRetentionDays() {
    const configured = (
      await this.config?.get(
        'global',
        '__global__',
        DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY,
      )
    )?.value;
    return configured === undefined
      ? DEFAULT_DUE_DELIVERY_RETENTION_DAYS
      : dueDeliveryRetentionDaysConfigSchema.parse(configured);
  }

  private async enqueueNextDaily(
    client: PoolClient,
    workspaceId: string,
    nextDue: NextDailyRecommendationDue,
  ) {
    const input: EnqueueDueDeliveryInput = {
      businessDate: nextDue.businessDate,
      dueAt: nextDue.dueAt,
      payload: nextDue.payload,
      taskId: nextDue.taskId,
      type: 'daily_recommendation',
      workspaceId,
    };
    validateEnqueueInput(input);
    const fingerprint = dueDeliveryFingerprint(input);
    const id = dueDeliveryId(workspaceId, nextDue.taskId);
    await client.query(
      `INSERT INTO p1_due_delivery_items (
         workspace_id,
         id,
         task_id,
         type,
         due_at,
         business_date,
         payload,
         fingerprint,
         next_attempt_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $5)
       ON CONFLICT (workspace_id, task_id) DO NOTHING`,
      [
        workspaceId,
        id,
        nextDue.taskId,
        input.type,
        nextDue.dueAt,
        nextDue.businessDate,
        nextDue.payload,
        fingerprint,
      ],
    );
    const existing = await client.query<{ fingerprint: string }>(
      `SELECT fingerprint
         FROM p1_due_delivery_items
        WHERE workspace_id = $1 AND task_id = $2`,
      [workspaceId, nextDue.taskId],
    );
    if (existing.rows[0]?.fingerprint !== fingerprint) {
      throw new DueDeliveryIdempotencyConflictError(nextDue.taskId);
    }
  }
}

function dueDeliveryClaim(row: DueDeliveryRow): DueDeliveryClaim {
  const payload = parsePayload(row.payload);
  return {
    attemptCount: row.attempt_count,
    ...(row.business_date
      ? { businessDate: dateOnly(row.business_date) }
      : {}),
    claimToken: row.claim_token ?? '',
    dueAt: timestamp(row.due_at),
    id: row.id,
    payload,
    taskId: row.task_id,
    type: row.type,
    workspaceId: row.workspace_id,
  };
}

function parsePayload(value: unknown): DueDeliveryPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Due delivery payload must be an object.');
  }
  const payload = value as Record<string, unknown>;
  if (
    payload.schemaVersion === 'daily-recommendation/v1' &&
    typeof payload.businessDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(payload.businessDate)
  ) {
    return {
      businessDate: payload.businessDate,
      schemaVersion: payload.schemaVersion,
    };
  }
  if (
    payload.schemaVersion === 'task-recall/v1' &&
    typeof payload.taskId === 'string' &&
    payload.taskId.trim() &&
    typeof payload.title === 'string' &&
    payload.title.trim() &&
    (payload.nextStep === undefined ||
      (typeof payload.nextStep === 'string' &&
        payload.nextStep.trim().length > 0))
  ) {
    return {
      ...(typeof payload.nextStep === 'string'
        ? { nextStep: payload.nextStep }
        : {}),
      schemaVersion: payload.schemaVersion,
      taskId: payload.taskId,
      title: payload.title,
    };
  }
  throw new Error('Due delivery payload schema is invalid.');
}

function validateEnqueueInput(input: EnqueueDueDeliveryInput) {
  if (!input.workspaceId.trim() || !input.taskId.trim()) {
    throw new Error('Due delivery workspaceId and taskId are required.');
  }
  const dueAt = Date.parse(input.dueAt);
  if (!Number.isFinite(dueAt)) {
    throw new Error('Due delivery dueAt must be an ISO timestamp.');
  }
  const payload = parsePayload(input.payload);
  if (input.type === 'daily_recommendation') {
    if (
      payload.schemaVersion !== 'daily-recommendation/v1' ||
      !input.businessDate ||
      payload.businessDate !== input.businessDate
    ) {
      throw new Error('Daily recommendation due input is inconsistent.');
    }
  } else if (payload.schemaVersion !== 'task-recall/v1') {
    throw new Error('Task recall due input is inconsistent.');
  }
}

function dueDeliveryFingerprint(input: EnqueueDueDeliveryInput) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        businessDate: input.businessDate ?? null,
        dueAt: new Date(input.dueAt).toISOString(),
        payload: parsePayload(input.payload),
        taskId: input.taskId,
        type: input.type,
        workspaceId: input.workspaceId,
      }),
    )
    .digest('hex');
}

function dueDeliveryId(workspaceId: string, taskId: string) {
  return `due:${createHash('sha256')
    .update(`${workspaceId}\0${taskId}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function dateOnly(value: Date | string) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function timestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
