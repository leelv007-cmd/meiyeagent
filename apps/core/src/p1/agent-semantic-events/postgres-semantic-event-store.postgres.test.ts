/**
 * PostgreSQL acceptance for p1_agent_semantic_events (V31-03).
 * Skips when TEST_DATABASE_URL is unset (no self-start Postgres).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { migratePostgresSchema } from '../../postgres-schema-migration.js';
import { AgentSemanticEventProjector } from './semantic-event-projector.js';
import { PostgresAgentSemanticEventStore } from './postgres-semantic-event-store.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString ? false : 'TEST_DATABASE_URL is not configured';

test(
  'Core schema migration creates p1_agent_semantic_events and re-runs cleanly',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresAgentSemanticEventStore(pool);
    try {
      await migratePostgresSchema(pool, [store]);
      await migratePostgresSchema(pool, [store]);
      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'p1_agent_semantic_events'`,
      );
      assert.deepEqual(
        tables.rows.map((row) => row.table_name),
        ['p1_agent_semantic_events'],
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  'Postgres projector assigns monotonic offsets, replays, and isolates threads',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresAgentSemanticEventStore(pool);
    const resourceId = `resource-sem-${randomUUID()}`;
    const threadA = `${resourceId}-thread-a`;
    const threadB = `${resourceId}-thread-b`;
    try {
      await store.migrate();
      const projector = new AgentSemanticEventProjector(store);

      const e1 = await projector.project({
        eventId: `${resourceId}-e1`,
        threadId: threadA,
        resourceId,
        contextRole: 'included',
        sourceDomain: 'agent_run',
        sourceEntityId: 'run-1',
        sourceRevision: '1',
        correlationId: 'corr-1',
        eventType: 'run.started',
        payload: { n: 1 },
        occurredAt: '2026-08-08T15:00:00.000Z',
      });
      const e2 = await projector.project({
        eventId: `${resourceId}-e2`,
        threadId: threadA,
        resourceId,
        contextRole: 'excluded',
        sourceDomain: 'workflow.progress',
        sourceEntityId: 'wf-1',
        sourceRevision: '2',
        correlationId: 'corr-1',
        eventType: 'activity.snapshot',
        payload: { n: 2 },
        occurredAt: '2026-08-08T15:00:01.000Z',
      });
      const b1 = await projector.project({
        eventId: `${resourceId}-b1`,
        threadId: threadB,
        resourceId,
        contextRole: 'included',
        sourceDomain: 'agent_run',
        sourceEntityId: 'run-b',
        sourceRevision: '1',
        correlationId: 'corr-b',
        eventType: 'run.started',
        payload: { n: 1 },
        occurredAt: '2026-08-08T15:00:02.000Z',
      });
      const replay = await projector.project({
        eventId: `${resourceId}-e1`,
        threadId: threadA,
        resourceId,
        contextRole: 'included',
        sourceDomain: 'agent_run',
        sourceEntityId: 'run-1',
        sourceRevision: '1',
        correlationId: 'corr-1',
        eventType: 'run.started',
        payload: { n: 1 },
        occurredAt: '2026-08-08T15:00:00.000Z',
      });

      assert.equal(e1.event.streamOffset, 1n);
      assert.equal(e2.event.streamOffset, 2n);
      assert.equal(b1.event.streamOffset, 1n);
      assert.equal(replay.replayed, true);
      assert.equal(replay.event.streamOffset, 1n);
      assert.equal(store.writeCount, 3);

      const after = await store.listByThread({
        resourceId,
        threadId: threadA,
        afterEventId: `${resourceId}-e1`,
      });
      assert.deepEqual(
        after.map((event) => event.eventId),
        [`${resourceId}-e2`],
      );

      const foreign = await store.listByThread({
        resourceId: `${resourceId}-other`,
        threadId: threadA,
      });
      assert.deepEqual(foreign, []);
    } finally {
      await pool
        .query('DELETE FROM p1_agent_semantic_events WHERE resource_id = $1', [
          resourceId,
        ])
        .catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  'Postgres ephemeral path performs zero INSERT on token emit (constructive)',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresAgentSemanticEventStore(pool);
    const resourceId = `resource-tok-${randomUUID()}`;
    const threadId = `${resourceId}-thread`;
    try {
      await store.migrate();
      const projector = new AgentSemanticEventProjector(store);
      const writesBefore = store.writeCount;

      // Intercept pool.query to prove no INSERT while emitting tokens.
      const originalQuery = pool.query.bind(pool);
      let insertCount = 0;
      pool.query = ((...args: Parameters<Pool['query']>) => {
        const text =
          typeof args[0] === 'string'
            ? args[0]
            : typeof args[0] === 'object' &&
                args[0] !== null &&
                'text' in args[0]
              ? String((args[0] as { text: string }).text)
              : '';
        if (/INSERT\s+INTO\s+p1_agent_semantic_events/iu.test(text)) {
          insertCount += 1;
        }
        return originalQuery(...args);
      }) as Pool['query'];

      for (let i = 0; i < 10; i += 1) {
        projector.emitWorkflowToken({
          threadId,
          token: {
            eventId: `${resourceId}-tok-${i}`,
            workflowId: 'wf-tok',
            sequence: i,
            candidateId: 'c01',
            channel: 'copy.body',
            delta: `token-${i}`,
            occurredAt: '2026-08-08T16:00:00.000Z',
          },
        });
      }

      assert.equal(insertCount, 0);
      assert.equal(store.writeCount, writesBefore);

      const count = await originalQuery<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM p1_agent_semantic_events
          WHERE resource_id = $1`,
        [resourceId],
      );
      assert.equal(count.rows[0]?.n, '0');
    } finally {
      await pool
        .query('DELETE FROM p1_agent_semantic_events WHERE resource_id = $1', [
          resourceId,
        ])
        .catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  'a replay carrying different content is refused while a jsonb key reorder is not',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresAgentSemanticEventStore(pool);
    const resourceId = `resource-diverge-${randomUUID()}`;
    const threadId = `${resourceId}-thread`;
    const eventId = `${resourceId}-artifact-r1`;
    // Declaration order that jsonb cannot preserve: it sorts object keys by
    // length then bytes. A byte comparison of the round-trip against this value
    // would call every replay a divergence.
    const payload = {
      revision: 1,
      artifactId: 'note:package-diverge',
      status: 'partial',
      artifactType: 'note',
      schemaVersion: 'artifact-update/v1',
    };
    const candidate = {
      eventId,
      threadId,
      resourceId,
      contextRole: 'excluded' as const,
      sourceDomain: 'make_harness.artifact',
      sourceEntityId: 'note:package-diverge',
      sourceRevision: '1',
      correlationId: 'corr-diverge',
      eventType: 'artifact.revised',
      payload,
      occurredAt: '2026-08-09T09:00:00.000Z',
    };

    try {
      await store.migrate();
      const first = await store.appendProjected(candidate);
      assert.equal(first.replayed, false);

      const stored = await pool.query<{ payload: { payload: unknown } }>(
        `SELECT payload FROM p1_agent_semantic_events WHERE event_id = $1`,
        [eventId],
      );
      const storedPayload = stored.rows[0]?.payload.payload as Record<
        string,
        unknown
      >;
      assert.ok(storedPayload);
      assert.notDeepEqual(Object.keys(storedPayload), Object.keys(payload));

      // The ordinary crash-window replay: same content, no new write.
      const writesBefore = store.writeCount;
      const replay = await store.appendProjected(candidate);
      assert.equal(replay.replayed, true);
      assert.equal(store.writeCount, writesBefore);

      // A re-execution that reached a different revision body under the same
      // eventId. The store used to answer `replayed: true` and keep its own row,
      // so the caller believed its version had landed.
      await assert.rejects(
        store.appendProjected({
          ...candidate,
          payload: { ...payload, status: 'ready' },
        }),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'AGENT_SEMANTIC_EVENT_CONFLICT' &&
          /already projected with different content/u.test(error.message),
      );
      assert.equal(store.writeCount, writesBefore);
    } finally {
      await pool
        .query('DELETE FROM p1_agent_semantic_events WHERE resource_id = $1', [
          resourceId,
        ])
        .catch(() => undefined);
      await pool.end();
    }
  },
);
