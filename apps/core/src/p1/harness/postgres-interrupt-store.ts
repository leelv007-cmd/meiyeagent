/**
 * PostgreSQL InterruptStore (V31-14 persistence close-out).
 *
 * Table p1_agent_interrupts — pending HITL confirmations survive restart.
 * Resume CAS is DB-enforced: UPDATE ... WHERE status='pending' AND revision=?
 */

import { isDeepStrictEqual } from 'node:util';

import {
  interruptPayloadSchema,
  resumeInterruptCommandSchema,
  type InterruptPayload,
  type ResumeInterruptCommand,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import {
  InterruptProtocolError,
  type InterruptStore,
  type StoredInterrupt,
} from './interrupt-protocol.js';

type InterruptRow = {
  interrupt_id: string;
  workspace_id: string;
  resource_id: string;
  thread_id: string;
  revision: string | number;
  status: string;
  payload: unknown;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolved_fingerprint: string | null;
  resolved_command: unknown | null;
  resume_delivery_status: string;
};

type Queryable = Pick<Pool, 'query'>;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseRow(row: InterruptRow): StoredInterrupt {
  const payload = interruptPayloadSchema.parse(row.payload);
  const resolvedCommand =
    row.resolved_command == null
      ? undefined
      : resumeInterruptCommandSchema.parse(row.resolved_command);
  return {
    payload,
    status: row.status as StoredInterrupt['status'],
    workspaceId: row.workspace_id,
    createdAt: toIso(row.created_at),
    ...(row.resolved_at
      ? { resolvedAt: toIso(row.resolved_at) }
      : {}),
    ...(row.resolved_fingerprint
      ? { resolvedFingerprint: row.resolved_fingerprint }
      : {}),
    ...(resolvedCommand ? { resolvedCommand } : {}),
    resumeDeliveryStatus:
      row.resume_delivery_status as StoredInterrupt['resumeDeliveryStatus'],
  };
}

const SELECT_COLS = `
  interrupt_id, workspace_id, resource_id, thread_id, revision, status,
  payload, created_at, resolved_at, resolved_fingerprint, resolved_command,
  resume_delivery_status
`;

export class PostgresInterruptStore
  implements InterruptStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      SELECT pg_advisory_xact_lock(
        hashtext('p1-agent-interrupts-migration-v1')
      );
      CREATE TABLE IF NOT EXISTS p1_agent_interrupts (
        interrupt_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        resource_id text NOT NULL,
        thread_id text NOT NULL,
        run_id text NOT NULL,
        workflow_id text NOT NULL,
        step text NOT NULL,
        revision bigint NOT NULL,
        status text NOT NULL CHECK (
          status IN ('pending', 'resolved', 'expired')
        ),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        resolved_at timestamptz NULL,
        resolved_fingerprint text NULL,
        resolved_command jsonb NULL,
        resume_delivery_status text NOT NULL DEFAULT 'none'
      );
      ALTER TABLE p1_agent_interrupts
        ADD COLUMN IF NOT EXISTS resume_delivery_status text NOT NULL
          DEFAULT 'none';
      ALTER TABLE p1_agent_interrupts
        ADD COLUMN IF NOT EXISTS resume_delivery_updated_at timestamptz NULL;
      DO $$
      BEGIN
        ALTER TABLE p1_agent_interrupts
          ADD CONSTRAINT p1_agent_interrupts_resume_delivery_status_check
          CHECK (resume_delivery_status IN ('none', 'pending', 'sent'));
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
      CREATE INDEX IF NOT EXISTS p1_agent_interrupts_pending_ws_idx
        ON p1_agent_interrupts (workspace_id, resource_id, created_at)
        WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS p1_agent_interrupts_pending_thread_idx
        ON p1_agent_interrupts (workspace_id, resource_id, thread_id, created_at)
        WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS p1_agent_interrupts_resume_outbox_idx
        ON p1_agent_interrupts (resolved_at, interrupt_id)
        WHERE status = 'resolved' AND resume_delivery_status = 'pending';
    `);
  }

  async putPending(row: StoredInterrupt): Promise<StoredInterrupt> {
    const payload = interruptPayloadSchema.parse(row.payload);
    const stored: StoredInterrupt = {
      ...row,
      payload,
      status: 'pending',
    };

    const inserted = await this.pool.query<InterruptRow>(
      `INSERT INTO p1_agent_interrupts (
         interrupt_id, workspace_id, resource_id, thread_id, run_id,
         workflow_id, step, revision, status, payload, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9::jsonb, $10::timestamptz
       )
       ON CONFLICT (interrupt_id) DO NOTHING
       RETURNING ${SELECT_COLS}`,
      [
        payload.interruptId,
        row.workspaceId,
        payload.resourceId,
        payload.threadId,
        payload.runId,
        payload.workflowId,
        payload.step,
        payload.revision,
        JSON.stringify(payload),
        row.createdAt,
      ],
    );
    if (inserted.rows[0]) {
      return parseRow(inserted.rows[0]);
    }

    const existing = await this.getById(payload.interruptId);
    if (!existing) {
      throw new InterruptProtocolError(
        'INVALID_COMMAND',
        `Interrupt ${payload.interruptId} insert raced and row is missing.`,
      );
    }
    if (
      existing.status === 'pending' &&
      existing.workspaceId === row.workspaceId &&
      isDeepStrictEqual(existing.payload, payload)
    ) {
      return existing;
    }
    if (
      existing.status === 'pending' &&
      existing.workspaceId === row.workspaceId &&
      existing.payload.revision === payload.revision
    ) {
      throw new InterruptProtocolError(
        'IDEMPOTENCY_CONFLICT',
        `Interrupt ${payload.interruptId}@${payload.revision} already pending with different payload.`,
      );
    }
    // Mid-flight fence (and other durable holds) may re-raise the same logical
    // interruptId after the merchant accepted once — e.g. workflow restart after
    // acknowledgeContextFence re-hits the same live-facts diff. Memory store
    // reopens the row; PG must match so production e2e does not die on
    // IDEMPOTENCY_CONFLICT after a legitimate second pause.
    if (
      existing.status === 'resolved' &&
      existing.workspaceId === row.workspaceId
    ) {
      const reopened = await this.pool.query<InterruptRow>(
        `UPDATE p1_agent_interrupts
            SET status = 'pending',
                payload = $1::jsonb,
                revision = $2,
                resolved_at = NULL,
                resolved_fingerprint = NULL,
                resolved_command = NULL,
                resume_delivery_status = 'none',
                resume_delivery_updated_at = NULL
          WHERE interrupt_id = $3
            AND workspace_id = $4
            AND status = 'resolved'
          RETURNING ${SELECT_COLS}`,
        [
          JSON.stringify(payload),
          payload.revision,
          payload.interruptId,
          row.workspaceId,
        ],
      );
      if (reopened.rows[0]) {
        return parseRow(reopened.rows[0]);
      }
      const raced = await this.getById(payload.interruptId);
      if (
        raced?.status === 'pending' &&
        raced.workspaceId === row.workspaceId &&
        isDeepStrictEqual(raced.payload, payload)
      ) {
        return raced;
      }
    }
    throw new InterruptProtocolError(
      'IDEMPOTENCY_CONFLICT',
      `Interrupt ${payload.interruptId} already exists in status=${existing.status}.`,
    );
  }

  async getById(interruptId: string): Promise<StoredInterrupt | null> {
    const result = await this.pool.query<InterruptRow>(
      `SELECT ${SELECT_COLS}
         FROM p1_agent_interrupts
        WHERE interrupt_id = $1`,
      [interruptId],
    );
    return result.rows[0] ? parseRow(result.rows[0]) : null;
  }

  async resolveCas(input: {
    interruptId: string;
    expectedRevision: number;
    command: ResumeInterruptCommand;
    fingerprint: string;
    resolvedAt: string;
  }): Promise<
    | { outcome: 'applied'; row: StoredInterrupt }
    | { outcome: 'replayed'; row: StoredInterrupt }
    | { outcome: 'stale'; row: StoredInterrupt }
    | { outcome: 'conflict'; row: StoredInterrupt }
    | { outcome: 'missing' }
    | { outcome: 'expired'; row: StoredInterrupt }
  > {
    const command = resumeInterruptCommandSchema.parse(input.command);

    // DB-layer CAS: only pending + matching revision can flip to resolved.
    const updated = await this.pool.query<InterruptRow>(
      `UPDATE p1_agent_interrupts
          SET status = 'resolved',
              resolved_at = $1::timestamptz,
              resolved_fingerprint = $2,
              resolved_command = $3::jsonb,
              resume_delivery_status = 'pending',
              resume_delivery_updated_at = $1::timestamptz
        WHERE interrupt_id = $4
          AND status = 'pending'
          AND revision = $5
        RETURNING ${SELECT_COLS}`,
      [
        input.resolvedAt,
        input.fingerprint,
        JSON.stringify(command),
        input.interruptId,
        input.expectedRevision,
      ],
    );
    if (updated.rows[0]) {
      return { outcome: 'applied', row: parseRow(updated.rows[0]) };
    }

    const existing = await this.getById(input.interruptId);
    if (!existing) return { outcome: 'missing' };
    if (existing.status === 'expired') {
      return { outcome: 'expired', row: existing };
    }
    if (existing.status === 'resolved') {
      if (existing.resolvedFingerprint === input.fingerprint) {
        return { outcome: 'replayed', row: existing };
      }
      if (
        existing.resolvedCommand &&
        existing.resolvedCommand.idempotencyKey &&
        command.idempotencyKey &&
        existing.resolvedCommand.idempotencyKey === command.idempotencyKey
      ) {
        if (isDeepStrictEqual(existing.resolvedCommand, command)) {
          return { outcome: 'replayed', row: existing };
        }
        return { outcome: 'conflict', row: existing };
      }
      return { outcome: 'conflict', row: existing };
    }
    // still pending but revision mismatch → stale CAS
    if (existing.payload.revision !== input.expectedRevision) {
      return { outcome: 'stale', row: existing };
    }
    // pending + matching revision but UPDATE missed (race) — re-read after brief
    // another worker may have just applied; treat matching fingerprint as replay.
    const again = await this.getById(input.interruptId);
    if (
      again?.status === 'resolved' &&
      again.resolvedFingerprint === input.fingerprint
    ) {
      return { outcome: 'replayed', row: again };
    }
    if (again?.status === 'resolved') {
      return { outcome: 'conflict', row: again };
    }
    return { outcome: 'stale', row: existing };
  }

  async listPending(input: {
    workspaceId: string;
    resourceId: string;
    threadId?: string;
  }): Promise<StoredInterrupt[]> {
    const result = input.threadId
      ? await this.pool.query<InterruptRow>(
          `SELECT ${SELECT_COLS}
             FROM p1_agent_interrupts
            WHERE workspace_id = $1
              AND resource_id = $2
              AND thread_id = $3
              AND status = 'pending'
            ORDER BY created_at ASC`,
          [input.workspaceId, input.resourceId, input.threadId],
        )
      : await this.pool.query<InterruptRow>(
          `SELECT ${SELECT_COLS}
             FROM p1_agent_interrupts
            WHERE workspace_id = $1
              AND resource_id = $2
              AND status = 'pending'
            ORDER BY created_at ASC`,
          [input.workspaceId, input.resourceId],
        );
    return result.rows.map(parseRow);
  }

  async listUndelivered(limit: number): Promise<StoredInterrupt[]> {
    const result = await this.pool.query<InterruptRow>(
      `SELECT ${SELECT_COLS}
         FROM p1_agent_interrupts
        WHERE status = 'resolved'
          AND resume_delivery_status = 'pending'
          AND resolved_command IS NOT NULL
        ORDER BY resolved_at ASC, interrupt_id ASC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(parseRow);
  }

  async markResumeDelivered(input: {
    interruptId: string;
    fingerprint: string;
    deliveredAt: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE p1_agent_interrupts
          SET resume_delivery_status = 'sent',
              resume_delivery_updated_at = $1::timestamptz
        WHERE interrupt_id = $2
          AND status = 'resolved'
          AND resolved_fingerprint = $3
          AND resume_delivery_status IN ('pending', 'sent')
        RETURNING interrupt_id`,
      [input.deliveredAt, input.interruptId, input.fingerprint],
    );
    return result.rowCount === 1;
  }
}

/** Convenience for assembly: migrate + return store. */
export async function createAndMigratePostgresInterruptStore(
  pool: Pool,
): Promise<PostgresInterruptStore> {
  const store = new PostgresInterruptStore(pool);
  await store.migrate();
  return store;
}

// Keep unused import lint-free for InterruptPayload type consumers of this module.
export type { InterruptPayload };
