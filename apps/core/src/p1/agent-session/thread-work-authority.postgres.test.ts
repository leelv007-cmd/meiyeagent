/**
 * V31-105 §2 (option B) — where the Workbench's current/recent Work comes from.
 *
 * The projection used to read a `durability = 'sync'` agent run written by
 * `linkExecutionRun`, and nothing in production ever called it, so
 * `WorkbenchSessionProjection.current` / `.recent` were permanently absent and
 * a tab reopened without `?taskId=` had no Work to bind — `this-run-experience`
 * rendered its empty state for a run that had in fact delivered.
 *
 * The replacement reads the same authority V31-90 already moved steering to:
 * the submission's own `agentBinding.threadId` (written by `persistAgentPlanning`
 * / `persistParkedAgentBinding` in
 * execution-spine/postgres-creation-submission-store.ts), joined to the Work's
 * merchant-visible status. These tests execute the statement production runs.
 *
 * Rows are seeded with SQL rather than through the coordinator (that path needs
 * a live quote, a reservation and a credit ledger), and the binding is typed as
 * `ComposerAgentBinding` so a rename of either key fails to compile here instead
 * of silently un-binding the reader — the same shape
 * steering-authority-binding.postgres.test.ts uses.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';

import {
  PostgresCreationSubmissionStore,
  type CreationSubmissionPersistencePort,
} from '../execution-spine/postgres-creation-submission-store.js';
import {
  asAgentThreadIdentity,
  type ComposerAgentBinding,
} from '../execution-spine/submission-coordinator.js';
import { PostgresHarnessStore } from '../harness/postgres-store.js';
import { PostgresAgentSessionStore } from './postgres-agent-session-store.js';
import { PostgresThreadWorkAuthorityReader } from './thread-work-authority.js';
import { resolveWorkbenchSession } from './workbench-session.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString ? false : 'TEST_DATABASE_URL is not configured';

/** Only `migrate()` is exercised; reserving needs billing this test has not. */
const unusedPersistence: CreationSubmissionPersistencePort = {
  async reserve(_client: PoolClient) {
    throw new Error('This fixture only migrates the submission schema.');
  },
};

type SeededWork = {
  taskId: string;
  workId: string;
};

async function createFixture() {
  const pool = new Pool({ connectionString });
  const sessions = new PostgresAgentSessionStore(pool);
  await sessions.migrate();
  await new PostgresCreationSubmissionStore(pool, unusedPersistence).migrate();
  await new PostgresHarnessStore(pool).applySchema();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS p1_creative_works (
       workspace_id text NOT NULL,
       id text NOT NULL,
       payload jsonb NOT NULL,
       updated_at timestamptz NOT NULL,
       PRIMARY KEY (workspace_id, id)
     )`,
  );
  const workspaceId = `ws-v31-105-${randomUUID()}`;
  const threadId = `thread:composer:${randomUUID()}`;
  await sessions.createThread({
    resourceId: workspaceId,
    threadId,
    title: '当前/最近 Work 投影',
    now: '2026-08-23T01:00:00.000Z',
  });
  let turn = 0;

  /**
   * One merchant turn: an exit run plus the submission that turn started.
   * `createdAt` orders the Works on the Thread, which is what "recent" means.
   */
  async function seedWork(input: {
    createdAt: string;
    workStatus?: 'draft' | 'running' | 'completed' | 'failed';
    /**
     * The harness audit trail for this Work. Delivery writes
     * `package_delivered` here; the Work row itself only reaches `completed`
     * when the merchant adopts an asset (operations/harness-copy-work-asset.ts).
     */
    auditEventTypes?: readonly string[];
  }): Promise<SeededWork> {
    const suffix = randomUUID();
    const runId = `run:composer:${suffix}`;
    const taskId = `composer-task:${suffix}`;
    const workId = `work-${suffix}`;
    await sessions.startWriteTurn({
      resourceId: workspaceId,
      threadId,
      expectedSessionRevision: turn,
      runId,
      trigger: 'merchant_turn',
      harnessReleaseId: 'release-v31-105',
      now: input.createdAt,
    });
    await sessions.updateRunStatus({
      resourceId: workspaceId,
      runId,
      status: 'completed',
      finishedAt: input.createdAt,
    });
    turn += 1;
    const agentBinding: ComposerAgentBinding = {
      threadId: asAgentThreadIdentity(threadId),
      runId,
    };
    await pool.query(
      `INSERT INTO execution_spine.creation_submissions (
         id, workspace_id, idempotency_key, payload_hash, submission,
         harness_state, task_id, work_id, snapshot_revision, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'started', $6, $7, 1, $8::timestamptz)`,
      [
        `submission-${suffix}`,
        workspaceId,
        `idem-${suffix}`,
        `hash-${suffix}`,
        JSON.stringify({ agentBinding }),
        taskId,
        workId,
        input.createdAt,
      ],
    );
    if (input.auditEventTypes?.length) {
      // Two hops, exactly as production writes them: the browser-facing
      // `composer-task:<hash>` is `task_requests.workflow_id`, while the audit
      // rows key off the internal `task_requests.task_id`.
      const harnessTaskId = `harness.v1:${suffix}`;
      await pool.query(
        `INSERT INTO harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request, created_at)
         VALUES ($1, $2, 'runtime-v31-105', $3, $4::jsonb, $5::timestamptz)`,
        [
          harnessTaskId,
          taskId,
          `fingerprint-${suffix}`,
          JSON.stringify({ workspaceId }),
          input.createdAt,
        ],
      );
      for (const [index, eventType] of input.auditEventTypes.entries()) {
        await pool.query(
          `INSERT INTO harness_runtime.audit_events
             (id, workflow_id, stage, event_type, payload, created_at)
           VALUES ($1, $2, 'delivery', $3, '{}'::jsonb, $4::timestamptz)`,
          [`audit-${suffix}-${index}`, harnessTaskId, eventType, input.createdAt],
        );
      }
    }
    if (input.workStatus) {
      await pool.query(
        `INSERT INTO p1_creative_works (workspace_id, id, payload, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz)`,
        [
          workspaceId,
          workId,
          JSON.stringify({ id: workId, status: input.workStatus }),
          input.createdAt,
        ],
      );
    }
    return { taskId, workId };
  }

  return {
    pool,
    sessions,
    workspaceId,
    threadId,
    seedWork,
    resolve: () =>
      resolveWorkbenchSession(sessions, {
        resourceId: workspaceId,
        explicitThreadId: threadId,
        workAuthority: new PostgresThreadWorkAuthorityReader(pool),
      }),
    async cleanup() {
      await pool.query(
        `DELETE FROM harness_runtime.audit_events
          WHERE workflow_id IN (
            SELECT task_id FROM harness_runtime.task_requests
             WHERE request->>'workspaceId' = $1
          )`,
        [workspaceId],
      );
      await pool.query(
        `DELETE FROM harness_runtime.task_requests
          WHERE request->>'workspaceId' = $1`,
        [workspaceId],
      );
      // p1_creative_works is retention-guarded once the harness schema is
      // installed (deleting one raises "p1_creative_works are retained"), and
      // production never deletes them either. Each fixture owns a fresh
      // workspace id, so the rows it leaves cannot reach another test.
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
  'V31-105 §2: a reopened Thread projects its delivered Work as recent, with no current',
  { skip },
  async () => {
    const fixture = await createFixture();
    try {
      const delivered = await fixture.seedWork({
        createdAt: '2026-08-23T01:10:00.000Z',
        workStatus: 'completed',
      });

      const resolved = await fixture.resolve();

      assert.equal(resolved.resolveSource, 'explicit_thread');
      assert.equal(resolved.session?.recent?.taskId, delivered.taskId);
      assert.equal(resolved.session?.recent?.workId, delivered.workId);
      // The Work finished, so nothing is in flight on this Thread.
      assert.equal(resolved.session?.current, undefined);
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'V31-105 §2: an unfinished Work is both current and recent',
  { skip },
  async () => {
    const fixture = await createFixture();
    try {
      const running = await fixture.seedWork({
        createdAt: '2026-08-23T01:10:00.000Z',
      });

      const resolved = await fixture.resolve();

      assert.equal(resolved.session?.current?.taskId, running.taskId);
      assert.equal(resolved.session?.current?.workId, running.workId);
      assert.equal(resolved.session?.recent?.taskId, running.taskId);
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'V31-105 §2: the newest Work wins recent; current stays on the one still running',
  { skip },
  async () => {
    const fixture = await createFixture();
    try {
      const running = await fixture.seedWork({
        createdAt: '2026-08-23T01:10:00.000Z',
      });
      const newerDelivered = await fixture.seedWork({
        createdAt: '2026-08-23T01:20:00.000Z',
        workStatus: 'completed',
      });

      const resolved = await fixture.resolve();

      assert.equal(resolved.session?.recent?.taskId, newerDelivered.taskId);
      assert.equal(resolved.session?.current?.taskId, running.taskId);
      assert.notEqual(resolved.session?.current?.taskId, newerDelivered.taskId);
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'V31-105 §2: a failed Work is recent but never current',
  { skip },
  async () => {
    const fixture = await createFixture();
    try {
      const failed = await fixture.seedWork({
        createdAt: '2026-08-23T01:10:00.000Z',
        workStatus: 'failed',
      });

      const resolved = await fixture.resolve();

      assert.equal(resolved.session?.recent?.taskId, failed.taskId);
      assert.equal(resolved.session?.current, undefined);
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  "V31-105 §2: another workspace's identical thread id projects nothing",
  { skip },
  async () => {
    const fixture = await createFixture();
    try {
      await fixture.seedWork({ createdAt: '2026-08-23T01:10:00.000Z' });

      const rows = await new PostgresThreadWorkAuthorityReader(
        fixture.pool,
      ).readThreadWork({
        resourceId: `${fixture.workspaceId}-other`,
        threadId: fixture.threadId,
      });

      assert.deepEqual(rows, []);
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'V31-105 §2: a Thread with no submission projects honest empty authority',
  { skip },
  async () => {
    const fixture = await createFixture();
    try {
      const resolved = await fixture.resolve();

      assert.equal(resolved.session?.threadId, fixture.threadId);
      assert.equal(resolved.session?.current, undefined);
      assert.equal(resolved.session?.recent, undefined);
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'V31-105 §2: a delivered Work is no longer current, even before it is adopted',
  { skip },
  async () => {
    const fixture = await createFixture();
    try {
      // Day-0 §37.4-A: the merchant has the delivery and has not adopted
      // anything, so nothing has copied an asset and the Work row is still
      // `running` (operations/harness-copy-work-asset.ts:112-128 is the only
      // writer that moves it to `completed`). The delivery itself is recorded
      // as a harness audit event, which is the same signal `listActiveTasks`
      // treats as "no longer in flight" (harness/postgres-store.ts:938-941).
      const delivered = await fixture.seedWork({
        createdAt: '2026-08-23T01:10:00.000Z',
        workStatus: 'running',
        auditEventTypes: ['package_delivered'],
      });

      const resolved = await fixture.resolve();

      assert.equal(resolved.session?.recent?.taskId, delivered.taskId);
      assert.equal(
        resolved.session?.current,
        undefined,
        'a delivered Work must not stay current until someone adopts it',
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'V31-105 §2: a Work still running with no delivery audit stays current',
  { skip },
  async () => {
    const fixture = await createFixture();
    try {
      // Reverse control for the test above: same `running` Work row, same
      // task request, only the delivery event is missing. If the audit
      // exclusion were widened into "any harness row ends the Work", this
      // case would go undefined too and the projection would lose every
      // in-flight Work.
      const running = await fixture.seedWork({
        createdAt: '2026-08-23T01:10:00.000Z',
        workStatus: 'running',
        auditEventTypes: ['stage_started'],
      });

      const resolved = await fixture.resolve();

      assert.equal(resolved.session?.current?.taskId, running.taskId);
      assert.equal(resolved.session?.recent?.taskId, running.taskId);
    } finally {
      await fixture.cleanup();
    }
  },
);
