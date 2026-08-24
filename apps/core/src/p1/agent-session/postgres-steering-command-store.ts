/**
 * PostgreSQL SteeringCommandStore (V31-16).
 *
 * Table p1_make_steering_commands — append-only mid-run steering commands.
 * Memory store is test-only; this is the production writer.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  makeSteeringCommandSchema,
  type MakeSteeringCommand,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import {
  asSteeringTaskProgressRow,
  SteeringCommandStoreError,
  type SteeringCommandStore,
  type SteeringTaskProgressCursor,
  type SteeringTaskProgressRow,
  type StoredSteeringCommand,
} from './steering-command-store.js';

type SteeringRow = {
  command_id: string;
  workspace_id: string;
  thread_id: string;
  task_id: string;
  application_status: string;
  impact_summary: string;
  payload: unknown;
  created_at: Date | string;
};

type Queryable = Pick<Pool, 'query'>;

const SELECT_COLS = `
  command_id, workspace_id, thread_id, task_id,
  application_status, impact_summary, payload, created_at
`;

/**
 * V31-105 §1 (B). The same Make task is keyed two ways — the harness writes its
 * durable workflow id (`<taskId>:plan-r<n>…`), the merchant's command carries the
 * bare browser id — so a lookup from either side must reach the other. Anchored
 * prefixes in both directions, not a LIKE pattern: the id is caller-supplied and
 * `%` / `_` inside a pattern would silently widen the family to other Works
 * (V31-90). `$2` is the caller's id; `task_id` is the stored one.
 */
const TASK_FAMILY_PREDICATE = `(
            task_id = $2
            OR left(task_id, length($2) + 1) = $2 || ':'
            OR left($2, length(task_id) + 1) = task_id || ':'
          )`;

function parseRow(row: SteeringRow): StoredSteeringCommand {
  const command = makeSteeringCommandSchema.parse(row.payload);
  return {
    command,
    workspaceId: row.workspace_id,
    applicationStatus:
      row.application_status as StoredSteeringCommand['applicationStatus'],
    impactSummary: row.impact_summary,
  };
}

export class PostgresSteeringCommandStore
  implements SteeringCommandStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      SELECT pg_advisory_xact_lock(
        hashtext('p1-make-steering-commands-migration-v1')
      );
      CREATE TABLE IF NOT EXISTS p1_make_steering_commands (
        command_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        thread_id text NOT NULL,
        task_id text NOT NULL,
        work_id text NULL,
        source_plan_revision bigint NOT NULL,
        snapshot_hash text NULL,
        queue_mode text NOT NULL CHECK (queue_mode IN ('steer', 'follow_up')),
        application_status text NOT NULL CHECK (
          application_status IN (
            'accepted',
            'queued_steer',
            'queued_follow_up',
            'requires_replan_confirm',
            'rejected_unsafe',
            'disabled',
            'consumer_pending'
          )
        ),
        impact_summary text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_make_steering_commands_task_idx
        ON p1_make_steering_commands (workspace_id, task_id, created_at);
      CREATE INDEX IF NOT EXISTS p1_make_steering_commands_thread_idx
        ON p1_make_steering_commands (workspace_id, thread_id, created_at);
      CREATE INDEX IF NOT EXISTS p1_make_steering_commands_queued_idx
        ON p1_make_steering_commands (workspace_id, task_id, created_at)
        WHERE application_status IN ('queued_steer', 'queued_follow_up');
      CREATE INDEX IF NOT EXISTS p1_make_steering_commands_consumer_pending_idx
        ON p1_make_steering_commands (workspace_id, task_id, created_at)
        WHERE application_status = 'consumer_pending';
      CREATE TABLE IF NOT EXISTS p1_make_steering_task_progress (
        workspace_id text NOT NULL,
        task_id text NOT NULL,
        unit_id text NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'completed')),
        label text,
        page_index integer,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, task_id, unit_id)
      );
      ALTER TABLE p1_make_steering_task_progress
        ADD COLUMN IF NOT EXISTS label text;
      ALTER TABLE p1_make_steering_task_progress
        ADD COLUMN IF NOT EXISTS page_index integer;
      ALTER TABLE p1_make_steering_commands
        DROP CONSTRAINT IF EXISTS p1_make_steering_commands_application_status_check;
      ALTER TABLE p1_make_steering_commands
        ADD CONSTRAINT p1_make_steering_commands_application_status_check CHECK (
          application_status IN (
            'accepted', 'queued_steer', 'queued_follow_up',
            'requires_replan_confirm', 'rejected_unsafe', 'disabled',
            'consumer_pending'
          )
        );
    `);
  }

  async put(row: StoredSteeringCommand): Promise<StoredSteeringCommand> {
    const command = makeSteeringCommandSchema.parse(row.command);
    const inserted = await this.pool.query<SteeringRow>(
      `INSERT INTO p1_make_steering_commands (
         command_id, workspace_id, thread_id, task_id, work_id,
         source_plan_revision, snapshot_hash, queue_mode,
         application_status, impact_summary, payload, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::timestamptz
       )
       ON CONFLICT (command_id) DO NOTHING
       RETURNING ${SELECT_COLS}`,
      [
        command.commandId,
        row.workspaceId,
        command.threadId,
        command.taskId,
        command.workId ?? null,
        command.sourcePlanRevision,
        command.snapshotHash ?? null,
        command.queueMode,
        row.applicationStatus,
        row.impactSummary,
        JSON.stringify(command),
        command.createdAt,
      ],
    );
    if (inserted.rows[0]) {
      return parseRow(inserted.rows[0]);
    }
    const existing = await this.getById(command.commandId);
    if (!existing) {
      throw new SteeringCommandStoreError(
        'INVALID_COMMAND',
        `Steering command ${command.commandId} insert raced and row is missing.`,
      );
    }
    if (
      existing.workspaceId === row.workspaceId &&
      isDeepStrictEqual(existing.command, command)
    ) {
      return existing;
    }
    throw new SteeringCommandStoreError(
      'IDEMPOTENCY_CONFLICT',
      `Steering command ${command.commandId} already exists with a different payload.`,
    );
  }

  async getById(commandId: string): Promise<StoredSteeringCommand | null> {
    const result = await this.pool.query<SteeringRow>(
      `SELECT ${SELECT_COLS}
         FROM p1_make_steering_commands
        WHERE command_id = $1`,
      [commandId],
    );
    return result.rows[0] ? parseRow(result.rows[0]) : null;
  }

  async listByTask(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<StoredSteeringCommand[]> {
    const result = await this.pool.query<SteeringRow>(
      `SELECT ${SELECT_COLS}
         FROM p1_make_steering_commands
        WHERE workspace_id = $1 AND ${TASK_FAMILY_PREDICATE}
        ORDER BY created_at ASC, command_id ASC`,
      [input.workspaceId, input.taskId],
    );
    return result.rows.map(parseRow);
  }

  async listByThread(input: {
    workspaceId: string;
    threadId: string;
  }): Promise<StoredSteeringCommand[]> {
    const result = await this.pool.query<SteeringRow>(
      `SELECT ${SELECT_COLS}
         FROM p1_make_steering_commands
        WHERE workspace_id = $1 AND thread_id = $2
        ORDER BY created_at ASC, command_id ASC`,
      [input.workspaceId, input.threadId],
    );
    return result.rows.map(parseRow);
  }

  async listQueued(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<StoredSteeringCommand[]> {
    const result = await this.pool.query<SteeringRow>(
      `SELECT ${SELECT_COLS}
         FROM p1_make_steering_commands
        WHERE workspace_id = $1
          AND ${TASK_FAMILY_PREDICATE}
          AND (
            application_status IN ('queued_steer', 'queued_follow_up')
            OR (
              application_status = 'consumer_pending'
              AND payload->'classification'->>'kind' = 'derived_revision'
            )
          )
        ORDER BY created_at ASC, command_id ASC`,
      [input.workspaceId, input.taskId],
    );
    return result.rows.map(parseRow);
  }

  async recordTaskProgress(input: {
    workspaceId: string;
    taskId: string;
    cursor: SteeringTaskProgressCursor;
  }): Promise<void> {
    const meta = new Map(
      (input.cursor.units ?? []).map((unit) => [unit.unitId, unit]),
    );
    const entries = [
      ...input.cursor.remainingUnitIds.map((unitId) => ({
        unitId,
        status: 'pending' as const,
      })),
      ...(input.cursor.justCompletedUnitId
        ? [{ unitId: input.cursor.justCompletedUnitId, status: 'completed' as const }]
        : []),
    ];
    for (const entry of entries) {
      const unit = meta.get(entry.unitId);
      await this.pool.query(
        `INSERT INTO p1_make_steering_task_progress
           (workspace_id, task_id, unit_id, status, label, page_index)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, task_id, unit_id) DO UPDATE
           SET status = CASE
             WHEN p1_make_steering_task_progress.status = 'completed'
               THEN 'completed'
             ELSE EXCLUDED.status
           END,
           label = COALESCE(EXCLUDED.label, p1_make_steering_task_progress.label),
           page_index = COALESCE(EXCLUDED.page_index, p1_make_steering_task_progress.page_index),
           updated_at = now()`,
        [
          input.workspaceId,
          input.taskId,
          entry.unitId,
          entry.status,
          unit?.label ?? null,
          typeof unit?.pageIndex === 'number' ? unit.pageIndex : null,
        ],
      );
    }
    if (input.cursor.allUnitsTerminal) {
      await this.pool.query(
        `UPDATE p1_make_steering_task_progress
            SET status = 'completed', updated_at = now()
          WHERE workspace_id = $1 AND task_id = $2`,
        [input.workspaceId, input.taskId],
      );
    }
  }

  async getTaskProgress(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<SteeringTaskProgressRow[]> {
    const result = await this.pool.query<{
      unit_id: string;
      status: 'pending' | 'completed';
      label: string | null;
      page_index: number | null;
    }>(
      `SELECT unit_id,
              CASE WHEN bool_or(status = 'completed') THEN 'completed'
                   ELSE 'pending' END AS status,
              max(label) FILTER (WHERE label IS NOT NULL AND label <> '') AS label,
              min(page_index) FILTER (WHERE page_index IS NOT NULL) AS page_index
         FROM p1_make_steering_task_progress
        WHERE workspace_id = $1 AND ${TASK_FAMILY_PREDICATE}
        GROUP BY unit_id
        ORDER BY unit_id`,
      [input.workspaceId, input.taskId],
    );
    return result.rows.map((row) =>
      asSteeringTaskProgressRow({
        unitId: row.unit_id,
        status: row.status,
        label: row.label ?? undefined,
        pageIndex: row.page_index,
      }),
    );
  }

  async markApplied(input: {
    commandId: string;
    applicationStatus: StoredSteeringCommand['applicationStatus'];
    impactSummary: string;
  }): Promise<StoredSteeringCommand> {
    const existing = await this.getById(input.commandId);
    if (!existing) {
      throw new SteeringCommandStoreError(
        'NOT_FOUND',
        `Steering command ${input.commandId} was not found.`,
      );
    }
    if (
      existing.applicationStatus === input.applicationStatus &&
      existing.impactSummary === input.impactSummary
    ) {
      return existing;
    }
    if (
      existing.applicationStatus === 'accepted' &&
      input.applicationStatus !== 'accepted'
    ) {
      throw new SteeringCommandStoreError(
        'IDEMPOTENCY_CONFLICT',
        `Steering command ${input.commandId} is already accepted.`,
      );
    }
    const result = await this.pool.query<SteeringRow>(
      `UPDATE p1_make_steering_commands
          SET application_status = $2,
              impact_summary = $3
        WHERE command_id = $1
        RETURNING ${SELECT_COLS}`,
      [input.commandId, input.applicationStatus, input.impactSummary],
    );
    if (!result.rows[0]) {
      throw new SteeringCommandStoreError(
        'NOT_FOUND',
        `Steering command ${input.commandId} was not found.`,
      );
    }
    return parseRow(result.rows[0]);
  }
}

/** Test helper: migrate table when TEST_DATABASE_URL is present. */
export async function migrateSteeringCommandStore(pool: Pool): Promise<void> {
  const store = new PostgresSteeringCommandStore(pool);
  await store.migrate();
}
