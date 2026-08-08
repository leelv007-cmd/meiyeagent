/**
 * PostgreSQL AgentSessionStore: p1_agent_threads + p1_agent_runs (V3.1 §33.1).
 *
 * The two tables are the whole persistence surface — the Work↔Thread edge is
 * derived from `sync` child runs and their execution link, so V3.1 §10's "no
 * separate association table" holds. Payload jsonb is the serialization
 * authority; mirrored columns exist only for constraints, ordering and lookup.
 */

import type { Pool, PoolClient } from 'pg';

import { agentRunSchema, agentThreadSchema } from '@meiye/contracts';
import type { AgentRunRecord, AgentThread } from '@meiye/contracts';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import {
  AgentSessionError,
  assertRunFound,
  assertThreadFound,
  assertWriteTurnAdmissible,
  newAgentThread,
  newExecutionChildRun,
  newWriteTurnRun,
  resolveExecutionRunReplay,
  runWithStatus,
  threadIdTaken,
  threadWithActiveGoalIds,
  threadWithStartedTurn,
  threadWithSummary,
  type AgentSessionStore,
  type AgentWriteTurn,
  type CreateAgentThreadInput,
  type ExecutionRunLink,
  type LegacyWorkThreadOpen,
  type LinkExecutionRunInput,
  type OpenLegacyWorkThreadInput,
  type RecordThreadSummaryInput,
  type SetActiveGoalIdsInput,
  type StartWriteTurnInput,
  type UpdateAgentRunStatusInput,
} from './agent-session-store.js';

type PayloadRow = { payload: unknown };

type Queryable = Pick<Pool, 'query'>;

export class PostgresAgentSessionStore
  implements AgentSessionStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_agent_threads (
        thread_id text PRIMARY KEY,
        resource_id text NOT NULL,
        status text NOT NULL CHECK (status IN ('active', 'archived')),
        session_revision bigint NOT NULL CHECK (session_revision >= 0),
        summary_revision bigint NOT NULL CHECK (summary_revision >= 0),
        legacy_work_id text,
        payload jsonb NOT NULL,
        last_run_at timestamptz,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT p1_agent_threads_legacy_work_key
          UNIQUE (resource_id, legacy_work_id)
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_agent_threads_recent_idx
        ON p1_agent_threads (
          resource_id, COALESCE(last_run_at, created_at) DESC, thread_id
        )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_agent_runs (
        run_id text PRIMARY KEY,
        thread_id text NOT NULL
          REFERENCES p1_agent_threads (thread_id) ON DELETE CASCADE,
        parent_run_id text REFERENCES p1_agent_runs (run_id),
        trigger text NOT NULL CHECK (
          trigger IN (
            'merchant_turn', 'proactive_signal', 'follow_up', 'system_resume'
          )
        ),
        status text NOT NULL CHECK (
          status IN ('running', 'waiting', 'completed', 'failed', 'cancelled')
        ),
        durability text NOT NULL CHECK (durability IN ('exit', 'sync')),
        harness_release_id text NOT NULL,
        workflow_id text,
        snapshot_hash text,
        payload jsonb NOT NULL,
        started_at timestamptz NOT NULL,
        finished_at timestamptz,
        -- durability=sync iff the run carries its immutable execution link.
        CONSTRAINT p1_agent_runs_execution_link_chk CHECK (
          (durability = 'sync') =
          (workflow_id IS NOT NULL AND snapshot_hash IS NOT NULL)
        ),
        CONSTRAINT p1_agent_runs_sync_parent_chk CHECK (
          durability = 'exit' OR parent_run_id IS NOT NULL
        ),
        CONSTRAINT p1_agent_runs_finished_chk CHECK (
          finished_at IS NULL OR finished_at >= started_at
        )
      )
    `);
    // One durable execution per session turn (V3.1 §10): the crash window can
    // replay a handoff, it can never fork a second paid execution.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS p1_agent_runs_sync_parent_idx
        ON p1_agent_runs (parent_run_id) WHERE durability = 'sync'
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS p1_agent_runs_workflow_idx
        ON p1_agent_runs (workflow_id) WHERE workflow_id IS NOT NULL
    `);
    // U6 single active write turn, enforced by the database rather than by the
    // application's read-then-write alone.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS p1_agent_runs_active_turn_idx
        ON p1_agent_runs (thread_id)
        WHERE durability = 'exit' AND status IN ('running', 'waiting')
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_agent_runs_thread_idx
        ON p1_agent_runs (thread_id, started_at, run_id)
    `);
  }

  async createThread(input: CreateAgentThreadInput): Promise<AgentThread> {
    const thread = newAgentThread(input);
    const inserted = await this.pool.query<PayloadRow>(
      INSERT_THREAD_SQL,
      [...threadValues(thread), null],
    );
    if (inserted.rows[0]) return parseThread(inserted.rows[0]);
    const existing = await this.getThread(input);
    if (existing) return existing;
    throw threadIdTaken(input.threadId);
  }

  async openLegacyWorkThread(
    input: OpenLegacyWorkThreadInput,
  ): Promise<LegacyWorkThreadOpen> {
    const thread = newAgentThread(input);
    const inserted = await this.pool.query<PayloadRow>(
      INSERT_THREAD_SQL,
      [...threadValues(thread), input.legacyWorkId],
    );
    if (inserted.rows[0]) {
      return { thread: parseThread(inserted.rows[0]), created: true };
    }
    const opened = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_agent_threads
        WHERE resource_id = $1 AND legacy_work_id = $2`,
      [input.resourceId, input.legacyWorkId],
    );
    if (!opened.rows[0]) throw threadIdTaken(input.threadId);
    return { thread: parseThread(opened.rows[0]), created: false };
  }

  async getThread(input: {
    resourceId: string;
    threadId: string;
  }): Promise<AgentThread | null> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_agent_threads
        WHERE resource_id = $1 AND thread_id = $2`,
      [input.resourceId, input.threadId],
    );
    return result.rows[0] ? parseThread(result.rows[0]) : null;
  }

  async listRecentThreads(input: {
    resourceId: string;
    limit?: number;
  }): Promise<AgentThread[]> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_agent_threads
        WHERE resource_id = $1
        ORDER BY COALESCE(last_run_at, created_at) DESC, thread_id
        LIMIT $2`,
      [input.resourceId, input.limit ?? null],
    );
    return result.rows.map(parseThread);
  }

  async startWriteTurn(input: StartWriteTurnInput): Promise<AgentWriteTurn> {
    return this.inTransaction(async (client) => {
      const locked = await client.query<PayloadRow>(
        `SELECT payload
           FROM p1_agent_threads
          WHERE resource_id = $1 AND thread_id = $2
          FOR UPDATE`,
        [input.resourceId, input.threadId],
      );
      const thread = assertThreadFound(
        locked.rows[0] ? parseThread(locked.rows[0]) : null,
        input.threadId,
      );
      const active = await client.query<PayloadRow>(
        `SELECT payload
           FROM p1_agent_runs
          WHERE thread_id = $1
            AND durability = 'exit'
            AND status IN ('running', 'waiting')
          LIMIT 1`,
        [input.threadId],
      );
      assertWriteTurnAdmissible(
        thread,
        input.expectedSessionRevision,
        active.rows[0] ? parseRun(active.rows[0]) : null,
      );

      const started = threadWithStartedTurn(thread, input.now);
      const updated = await client.query(
        `UPDATE p1_agent_threads
            SET payload = $3::jsonb,
                session_revision = $4,
                last_run_at = $5::timestamptz,
                updated_at = $6::timestamptz
          WHERE thread_id = $1 AND session_revision = $2`,
        [
          started.threadId,
          thread.sessionRevision,
          JSON.stringify(started),
          started.sessionRevision,
          started.lastRunAt ?? null,
          started.updatedAt,
        ],
      );
      if (updated.rowCount !== 1) {
        // The row lock above already settled arbitration; a lost CAS here means
        // the lock was bypassed, so it must surface as a conflict, not silence.
        throw new AgentSessionError(
          'AGENT_SESSION_REVISION_CONFLICT',
          `Agent thread ${input.threadId} changed while starting a write turn.`,
          {
            threadId: input.threadId,
            expectedSessionRevision: input.expectedSessionRevision,
            currentSessionRevision: thread.sessionRevision,
          },
        );
      }
      const run = newWriteTurnRun(input);
      await insertRun(client, run);
      return { thread: started, run };
    });
  }

  async linkExecutionRun(
    input: LinkExecutionRunInput,
  ): Promise<ExecutionRunLink> {
    return this.inTransaction(async (client) => {
      const locked = await client.query<PayloadRow>(
        `SELECT run.payload
           FROM p1_agent_runs run
           JOIN p1_agent_threads thread
             ON thread.thread_id = run.thread_id
            AND thread.resource_id = $1
          WHERE run.run_id = $2
          FOR UPDATE OF run`,
        [input.resourceId, input.parentRunId],
      );
      const parent = assertRunFound(
        locked.rows[0] ? parseRun(locked.rows[0]) : null,
        input.parentRunId,
      );
      const existing = await client.query<PayloadRow>(
        `SELECT payload
           FROM p1_agent_runs
          WHERE parent_run_id = $1 AND durability = 'sync'`,
        [parent.runId],
      );
      if (existing.rows[0]) {
        return resolveExecutionRunReplay(parseRun(existing.rows[0]), input);
      }
      const child = newExecutionChildRun(parent, input);
      await insertRun(client, child);
      return { run: child, replayed: false };
    });
  }

  async updateRunStatus(
    input: UpdateAgentRunStatusInput,
  ): Promise<AgentRunRecord> {
    return this.inTransaction(async (client) => {
      const locked = await client.query<PayloadRow>(
        `SELECT run.payload
           FROM p1_agent_runs run
           JOIN p1_agent_threads thread
             ON thread.thread_id = run.thread_id
            AND thread.resource_id = $1
          WHERE run.run_id = $2
          FOR UPDATE OF run`,
        [input.resourceId, input.runId],
      );
      const run = assertRunFound(
        locked.rows[0] ? parseRun(locked.rows[0]) : null,
        input.runId,
      );
      const updated = runWithStatus(run, input);
      await client.query(
        `UPDATE p1_agent_runs
            SET status = $2,
                finished_at = $3::timestamptz,
                payload = $4::jsonb
          WHERE run_id = $1`,
        [
          updated.runId,
          updated.status,
          updated.finishedAt ?? null,
          JSON.stringify(updated),
        ],
      );
      return updated;
    });
  }

  async getRun(input: {
    resourceId: string;
    runId: string;
  }): Promise<AgentRunRecord | null> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT run.payload
         FROM p1_agent_runs run
         JOIN p1_agent_threads thread
           ON thread.thread_id = run.thread_id
          AND thread.resource_id = $1
        WHERE run.run_id = $2`,
      [input.resourceId, input.runId],
    );
    return result.rows[0] ? parseRun(result.rows[0]) : null;
  }

  async listRuns(input: {
    resourceId: string;
    threadId: string;
  }): Promise<AgentRunRecord[]> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT run.payload
         FROM p1_agent_runs run
         JOIN p1_agent_threads thread
           ON thread.thread_id = run.thread_id
          AND thread.resource_id = $1
        WHERE run.thread_id = $2
        ORDER BY run.started_at, run.run_id`,
      [input.resourceId, input.threadId],
    );
    return result.rows.map(parseRun);
  }

  async recordThreadSummary(
    input: RecordThreadSummaryInput,
  ): Promise<AgentThread> {
    return this.inTransaction(async (client) => {
      const locked = await client.query<PayloadRow>(
        `SELECT payload
           FROM p1_agent_threads
          WHERE resource_id = $1 AND thread_id = $2
          FOR UPDATE`,
        [input.resourceId, input.threadId],
      );
      const thread = assertThreadFound(
        locked.rows[0] ? parseThread(locked.rows[0]) : null,
        input.threadId,
      );
      const summarized = threadWithSummary(thread, input.summary, input.now);
      // session_revision is deliberately untouched: summaries never arbitrate.
      await client.query(
        `UPDATE p1_agent_threads
            SET payload = $2::jsonb,
                summary_revision = $3,
                updated_at = $4::timestamptz
          WHERE thread_id = $1`,
        [
          summarized.threadId,
          JSON.stringify(summarized),
          summarized.summaryRevision,
          summarized.updatedAt,
        ],
      );
      return summarized;
    });
  }

  async setActiveGoalIds(input: SetActiveGoalIdsInput): Promise<AgentThread> {
    return this.inTransaction(async (client) => {
      const locked = await client.query<PayloadRow>(
        `SELECT payload
           FROM p1_agent_threads
          WHERE resource_id = $1 AND thread_id = $2
          FOR UPDATE`,
        [input.resourceId, input.threadId],
      );
      const thread = assertThreadFound(
        locked.rows[0] ? parseThread(locked.rows[0]) : null,
        input.threadId,
      );
      const next = threadWithActiveGoalIds(
        thread,
        input.activeGoalIds,
        input.now,
      );
      // session_revision untouched: goal mount is metadata, not a write turn.
      await client.query(
        `UPDATE p1_agent_threads
            SET payload = $2::jsonb,
                updated_at = $3::timestamptz
          WHERE thread_id = $1`,
        [next.threadId, JSON.stringify(next), next.updatedAt],
      );
      return next;
    });
  }

  private async inTransaction<T>(
    body: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await body(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/** A fresh thread is created once: updated_at starts equal to created_at. */
const INSERT_THREAD_SQL = `INSERT INTO p1_agent_threads
    (thread_id, resource_id, status, session_revision, summary_revision,
     payload, last_run_at, created_at, legacy_work_id, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz,
          $9, $8::timestamptz)
  ON CONFLICT DO NOTHING
  RETURNING payload`;

function threadValues(thread: AgentThread) {
  return [
    thread.threadId,
    thread.resourceId,
    thread.status,
    thread.sessionRevision,
    thread.summaryRevision,
    JSON.stringify(thread),
    thread.lastRunAt ?? null,
    thread.createdAt,
  ];
}

async function insertRun(client: PoolClient, run: AgentRunRecord) {
  await client.query(
    `INSERT INTO p1_agent_runs
       (run_id, thread_id, parent_run_id, trigger, status, durability,
        harness_release_id, workflow_id, snapshot_hash, payload, started_at,
        finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
             $11::timestamptz, $12::timestamptz)`,
    [
      run.runId,
      run.threadId,
      run.parentRunId ?? null,
      run.trigger,
      run.status,
      run.durability,
      run.harnessReleaseId,
      run.executionLink?.workflowId ?? null,
      run.executionLink?.snapshotHash ?? null,
      JSON.stringify(run),
      run.startedAt,
      run.finishedAt ?? null,
    ],
  );
}

function parseThread(row: PayloadRow): AgentThread {
  return agentThreadSchema.parse(row.payload);
}

function parseRun(row: PayloadRow): AgentRunRecord {
  return agentRunSchema.parse(row.payload);
}
