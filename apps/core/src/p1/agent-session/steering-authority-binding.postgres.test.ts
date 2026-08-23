/**
 * V31-90 — who may steer a running Work, executed against the real schema.
 *
 * The mid-run steering journey (§37.4-G) failed for two independent reasons
 * that both looked like one `INVALID_STATE` at the merchant:
 *
 * 1. the admitted snapshot is keyed by the *harness* workflow id
 *    (`${taskId}:plan-r<n>:plan:<revision>:<hash>`), so probing
 *    `getByWorkflowId(taskId)` / `getByWorkflowId(`${taskId}:plan-r1`)` — the
 *    two spellings production used — never matched a row; and
 * 2. the binding lookup demanded a `durability = 'sync'` agent run, and
 *    nothing in production wrote one (`linkExecutionRun`, since removed by
 *    V31-105 §2), so the join could not return a row even when the ids lined
 *    up.
 *
 * These tests pin the replacement contract: the request may spell the task
 * either way, the answer is the submission's own `agentBinding`, and the
 * requesting thread must be that binding's thread — one Work's thread can
 * never steer another's.
 *
 * The submission row is seeded with SQL rather than through the coordinator
 * (that path needs a live quote, a reservation and a credit ledger). What the
 * statement reads — `submission -> 'agentBinding' ->> 'threadId' / 'runId'` —
 * is written by `persistAgentPlanning` / `persistParkedAgentBinding` in
 * execution-spine/postgres-creation-submission-store.ts, and the seed below is
 * typed as `ComposerAgentBinding` so a rename of either key fails to compile
 * here instead of silently un-binding the reader.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';

import {
  STEERING_AUTHORITY_BINDING_SQL,
  type SteeringAuthorityBindingRow,
} from '../../assembly/core-assembly.js';
import {
  PostgresCreationSubmissionStore,
  type CreationSubmissionPersistencePort,
} from '../execution-spine/postgres-creation-submission-store.js';
import {
  asAgentThreadIdentity,
  type ComposerAgentBinding,
} from '../execution-spine/submission-coordinator.js';
import { PostgresAgentSessionStore } from './postgres-agent-session-store.js';
import { canonicalThreadTaskId } from './workbench-session.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString ? false : 'TEST_DATABASE_URL is not configured';

/** Only `migrate()` is exercised; reserving needs billing this test has not. */
const unusedPersistence: CreationSubmissionPersistencePort = {
  async reserve(_client: PoolClient) {
    throw new Error('This fixture only migrates the submission schema.');
  },
};

type SeededWork = {
  workspaceId: string;
  threadId: string;
  runId: string;
  taskId: string;
  workId: string;
};

async function seedWork(
  pool: Pool,
  sessions: PostgresAgentSessionStore,
  workspaceId: string,
  label: string,
): Promise<SeededWork> {
  const suffix = randomUUID();
  const threadId = `thread:composer:${suffix}`;
  const runId = `run:composer:${suffix}`;
  const taskId = `composer-task:${suffix}`;
  const workId = `work-${suffix}`;
  await sessions.createThread({
    resourceId: workspaceId,
    threadId,
    title: label,
    now: '2026-08-23T01:00:00.000Z',
  });
  await sessions.startWriteTurn({
    resourceId: workspaceId,
    threadId,
    expectedSessionRevision: 0,
    runId,
    trigger: 'merchant_turn',
    harnessReleaseId: 'release-v31-90',
    now: '2026-08-23T01:00:01.000Z',
  });
  const agentBinding: ComposerAgentBinding = {
    threadId: asAgentThreadIdentity(threadId),
    runId,
  };
  await pool.query(
    `INSERT INTO execution_spine.creation_submissions (
       id, workspace_id, idempotency_key, payload_hash, submission,
       harness_state, task_id, work_id, snapshot_revision, created_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, 'reserved', $6, $7, 1, now())`,
    [
      `submission-${suffix}`,
      workspaceId,
      `idem-${suffix}`,
      `hash-${suffix}`,
      JSON.stringify({ agentBinding }),
      taskId,
      workId,
    ],
  );
  return { workspaceId, threadId, runId, taskId, workId };
}

async function resolveBinding(
  pool: Pool,
  input: { workspaceId: string; taskId: string; threadId: string },
): Promise<SteeringAuthorityBindingRow | undefined> {
  const result = await pool.query<SteeringAuthorityBindingRow>(
    STEERING_AUTHORITY_BINDING_SQL,
    [
      input.workspaceId,
      input.taskId,
      canonicalThreadTaskId(input.taskId),
      input.threadId,
    ],
  );
  return result.rows[0];
}

async function createFixture() {
  const pool = new Pool({ connectionString });
  const sessions = new PostgresAgentSessionStore(pool);
  await sessions.migrate();
  await new PostgresCreationSubmissionStore(pool, unusedPersistence).migrate();
  const workspaceId = `ws-v31-90-${randomUUID()}`;
  return {
    pool,
    sessions,
    workspaceId,
    async cleanup() {
      await pool.query(
        'DELETE FROM execution_spine.creation_submissions WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        `DELETE FROM p1_agent_runs
          WHERE thread_id IN (
            SELECT thread_id FROM p1_agent_threads WHERE resource_id = $1
          )`,
        [workspaceId],
      );
      await pool.query('DELETE FROM p1_agent_threads WHERE resource_id = $1', [
        workspaceId,
      ]);
      await pool.end();
    },
  };
}

test(
  'steering authority resolves the same Work from the bare task id and from its prepared attempt id',
  { skip },
  async () => {
    const fixture = await createFixture();
    try {
      const work = await seedWork(
        fixture.pool,
        fixture.sessions,
        fixture.workspaceId,
        '中途指令 · 基线',
      );

      const bare = await resolveBinding(fixture.pool, {
        workspaceId: work.workspaceId,
        taskId: work.taskId,
        threadId: work.threadId,
      });
      assert.ok(bare, 'the bare task id the 202 handed back must resolve');
      assert.equal(bare.thread_id, work.threadId);
      assert.equal(bare.work_id, work.workId);

      // `composerPreparedAttemptId` spells the same Work this way once the
      // merchant confirms the plan; both spellings are one Work.
      const prepared = await resolveBinding(fixture.pool, {
        workspaceId: work.workspaceId,
        taskId: `${work.taskId}:plan-r1`,
        threadId: work.threadId,
      });
      assert.ok(prepared, 'the prepared attempt id must resolve the same Work');
      assert.equal(prepared.thread_id, work.threadId);
      assert.equal(prepared.work_id, work.workId);
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'steering authority refuses a thread that does not own the Work (Work 1 / Work 2 stay independent)',
  { skip },
  async () => {
    const fixture = await createFixture();
    try {
      const first = await seedWork(
        fixture.pool,
        fixture.sessions,
        fixture.workspaceId,
        'Work 1',
      );
      const second = await seedWork(
        fixture.pool,
        fixture.sessions,
        fixture.workspaceId,
        'Work 2',
      );

      assert.equal(
        await resolveBinding(fixture.pool, {
          workspaceId: fixture.workspaceId,
          taskId: first.taskId,
          threadId: second.threadId,
        }),
        undefined,
        "Work 2's thread must not resolve Work 1's authority",
      );
      assert.equal(
        await resolveBinding(fixture.pool, {
          workspaceId: fixture.workspaceId,
          taskId: second.taskId,
          threadId: first.threadId,
        }),
        undefined,
        "Work 1's thread must not resolve Work 2's authority",
      );

      // Each Work still resolves through its own thread, so the refusal above
      // is isolation rather than a lookup that stopped working.
      assert.equal(
        (
          await resolveBinding(fixture.pool, {
            workspaceId: fixture.workspaceId,
            taskId: first.taskId,
            threadId: first.threadId,
          })
        )?.work_id,
        first.workId,
      );
      assert.equal(
        (
          await resolveBinding(fixture.pool, {
            workspaceId: fixture.workspaceId,
            taskId: second.taskId,
            threadId: second.threadId,
          })
        )?.work_id,
        second.workId,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'steering authority refuses another workspace holding the same thread and task ids',
  { skip },
  async () => {
    const fixture = await createFixture();
    try {
      const work = await seedWork(
        fixture.pool,
        fixture.sessions,
        fixture.workspaceId,
        '跨工作区',
      );
      assert.equal(
        await resolveBinding(fixture.pool, {
          workspaceId: `${fixture.workspaceId}-other`,
          taskId: work.taskId,
          threadId: work.threadId,
        }),
        undefined,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);
