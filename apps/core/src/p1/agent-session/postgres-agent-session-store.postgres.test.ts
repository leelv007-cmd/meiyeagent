import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { migratePostgresSchema } from '../../postgres-schema-migration.js';
import { AgentSessionError } from './agent-session-store.js';
import { runAgentSessionStoreConformance } from './agent-session-store-conformance.js';
import { PostgresAgentSessionStore } from './postgres-agent-session-store.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString ? false : 'TEST_DATABASE_URL is not configured';

runAgentSessionStoreConformance({
  label: 'postgres agent session store',
  skip,
  createFixture: async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresAgentSessionStore(pool);
    await store.migrate();
    const resourceId = `resource-agent-${randomUUID()}`;
    return {
      store,
      resourceId,
      dispose: async () => {
        await deleteResource(pool, resourceId);
        await pool.end();
      },
    };
  },
});

test(
  'Core schema migration creates both agent session tables and re-runs cleanly',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresAgentSessionStore(pool);
    try {
      await migratePostgresSchema(pool, [store]);
      await migratePostgresSchema(pool, [store]);
      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('p1_agent_threads', 'p1_agent_runs')
          ORDER BY table_name`,
      );
      assert.deepEqual(
        tables.rows.map((row) => row.table_name),
        ['p1_agent_runs', 'p1_agent_threads'],
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  'Postgres refuses the second concurrent write turn on the same thread',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresAgentSessionStore(pool);
    const resourceId = `resource-agent-${randomUUID()}`;
    const threadId = `${resourceId}-thread`;
    try {
      await store.migrate();
      await store.createThread({
        resourceId,
        threadId,
        title: '双端同时提交',
        now: '2026-08-08T12:00:00.000Z',
      });

      const submissions = await Promise.allSettled([
        store.startWriteTurn({
          resourceId,
          threadId,
          expectedSessionRevision: 0,
          runId: `${resourceId}-run-desktop`,
          trigger: 'merchant_turn',
          harnessReleaseId: 'harness-release-v1',
          now: '2026-08-08T12:01:00.000Z',
        }),
        store.startWriteTurn({
          resourceId,
          threadId,
          expectedSessionRevision: 0,
          runId: `${resourceId}-run-mobile`,
          trigger: 'merchant_turn',
          harnessReleaseId: 'harness-release-v1',
          now: '2026-08-08T12:01:00.500Z',
        }),
      ]);

      const accepted = submissions.filter(
        (outcome) => outcome.status === 'fulfilled',
      );
      const refused = submissions.filter(
        (outcome) => outcome.status === 'rejected',
      );
      assert.equal(accepted.length, 1);
      assert.equal(refused.length, 1);
      const conflict = (refused[0] as PromiseRejectedResult).reason;
      assert.ok(conflict instanceof AgentSessionError);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.details.currentSessionRevision, 1);

      const thread = await store.getThread({ resourceId, threadId });
      assert.equal(thread?.sessionRevision, 1);
      assert.equal(
        (await store.listRuns({ resourceId, threadId })).length,
        1,
      );
    } finally {
      await deleteResource(pool, resourceId);
      await pool.end();
    }
  },
);

test(
  'Postgres rejects a second active turn row even without the store guard',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresAgentSessionStore(pool);
    const resourceId = `resource-agent-${randomUUID()}`;
    const threadId = `${resourceId}-thread`;
    try {
      await store.migrate();
      await store.createThread({
        resourceId,
        threadId,
        title: '数据库层单活跃轮',
        now: '2026-08-08T14:00:00.000Z',
      });
      const turn = await store.startWriteTurn({
        resourceId,
        threadId,
        expectedSessionRevision: 0,
        runId: `${resourceId}-turn`,
        trigger: 'merchant_turn',
        harnessReleaseId: 'harness-release-v1',
        now: '2026-08-08T14:01:00.000Z',
      });

      await assert.rejects(
        pool.query(
          `INSERT INTO p1_agent_runs
             (run_id, thread_id, trigger, status, durability,
              harness_release_id, payload, started_at)
           VALUES ($1, $2, 'merchant_turn', 'running', 'exit', $3, $4::jsonb,
                   $5::timestamptz)`,
          [
            `${resourceId}-turn-smuggled`,
            threadId,
            turn.run.harnessReleaseId,
            JSON.stringify({ ...turn.run, runId: `${resourceId}-turn-smuggled` }),
            '2026-08-08T14:02:00.000Z',
          ],
        ),
        /p1_agent_runs_active_turn_idx/u,
      );

      await assert.rejects(
        pool.query(
          `UPDATE p1_agent_runs SET durability = 'sync' WHERE run_id = $1`,
          [`${resourceId}-turn`],
        ),
        /p1_agent_runs_execution_link_chk/u,
      );
    } finally {
      await deleteResource(pool, resourceId);
      await pool.end();
    }
  },
);

async function deleteResource(pool: Pool, resourceId: string) {
  await pool
    .query('DELETE FROM p1_agent_threads WHERE resource_id = $1', [resourceId])
    .catch(() => undefined);
}
