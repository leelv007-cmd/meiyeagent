import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';

import { PostgresHarnessStore } from './postgres-store.js';

test('Harness schema migration stays inside the shared advisory-lock transaction', async () => {
  const statements: string[] = [];
  const client = {
    async query(statement: string) {
      statements.push(statement);
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
    async query() {
      throw new Error('schema migration escaped the advisory-lock client');
    },
  } as unknown as Pool;

  await new PostgresHarnessStore(pool).applySchema();

  assert.equal(statements[0], 'BEGIN');
  assert.match(statements[1] ?? '', /pg_advisory_xact_lock/u);
  assert.match(statements[2] ?? '', /create schema if not exists harness_runtime/u);
  assert.equal(statements.at(-1), 'COMMIT');
});

test('Langfuse outbox schema exposes terminal states without silently dropping expired leases', async () => {
  const statements: string[] = [];
  const pool = {
    async query(statement: string) {
      statements.push(statement);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  await store.migrate(pool as unknown as import('pg').PoolClient);
  const schema = statements[0] ?? '';
  assert.match(schema, /'dead_letter'/u);
  assert.match(schema, /'discarded'/u);
  assert.match(schema, /dead_lettered_at/u);
  assert.match(schema, /sent_at/u);
  assert.match(schema, /observability_drop_events/u);
  assert.match(schema, /trace_id/u);
  assert.match(schema, /completed_at/u);

  await store.claimLangfuseBatch(5, 300, 3);
  assert.equal(statements.length, 2);
  assert.doesNotMatch(statements[1] ?? '', /over_limit/u);
  assert.doesNotMatch(statements[1] ?? '', /attempts < \$3/u);
});

test('post-contract claims use the physical trace id and never the latest stage fallback', async () => {
  let calls = 0;
  const pool = {
    async query() {
      calls += 1;
      if (calls === 1) {
        return {
          rows: [
            {
              audit_id: 'audit-1',
              attempts: 1,
              workflow_id: 'workflow-1',
              trace_id: 'trace-required',
              trace_contract_version: null,
              post_contract: true,
              stage: 'execution_selection',
              event_type: 'stage_decision_recorded',
              payload: { traceId: 'legacy-logical-id' },
              created_at: new Date('2026-07-29T09:00:00.000Z'),
            },
          ],
        };
      }
      return {
        rows: [
          {
            id: 'trace-required',
            task_id: 'workflow-1',
            stage: 'execution_selection',
            trace_contract_version: null,
            payload: { winnerCandidateId: 'wrong-version' },
          },
        ],
      };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  assert.deepEqual(await store.claimLangfuseBatch(1), [
    {
      auditId: 'audit-1',
      workflowId: 'workflow-1',
      traceContractVersion: 'observability/v1',
      stage: 'execution_selection',
      eventType: 'stage_decision_recorded',
      occurredAt: '2026-07-29T09:00:00.000Z',
      payload: { traceId: 'legacy-logical-id' },
      attempts: 1,
    },
  ]);
});

test('dead-letter transition and independent drop rows share one SQL statement', async () => {
  const calls: Array<{ statement: string; values?: unknown[] }> = [];
  const pool = {
    async query(statement: string, values?: unknown[]) {
      calls.push({ statement, values });
      return { rows: [{ transitioned_count: 1 }], rowCount: 1 };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  await store.markLangfuseDeadLetter('audit-1', 'invalid credentials', [
    {
      signal: 'trace',
      reason: 'permanent-config',
      count: 2,
      source: 'langfuse_ingestion',
    },
  ]);

  assert.equal(calls.length, 1);
  assert.match(calls[0]?.statement ?? '', /status='dead_letter'/u);
  assert.match(calls[0]?.statement ?? '', /returning audit_id/u);
  assert.match(
    calls[0]?.statement ?? '',
    /insert into harness_runtime\.observability_drop_events/u,
  );
  assert.doesNotMatch(calls[0]?.statement ?? '', /audit_events/u);
  assert.deepEqual(calls[0]?.values, [
    'audit-1',
    'invalid credentials',
    JSON.stringify([
      {
        signal: 'trace',
        reason: 'permanent-config',
        count: 2,
        source: 'langfuse_ingestion',
      },
    ]),
  ]);
});

test('delivery health measures the oldest queued work independent of retry readiness', async () => {
  const calls: string[] = [];
  const pool = {
    async query(statement: string) {
      calls.push(statement);
      return {
        rows: [
          {
            last_success_at: new Date('2026-07-29T09:59:00.000Z'),
            oldest_queued_at: new Date('2026-07-29T09:58:30.000Z'),
          },
        ],
      };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  assert.deepEqual(
    await store.readObservabilityDeliveryHealth({
      now: new Date('2026-07-29T10:00:00.000Z'),
    }),
    {
      lastSuccessAt: new Date('2026-07-29T09:59:00.000Z'),
      oldestQueuedAt: new Date('2026-07-29T09:58:30.000Z'),
      queueAgeMs: 90_000,
    },
  );
  assert.match(calls[0] ?? '', /status in \('queued','failed','sending'\)/u);
  assert.doesNotMatch(calls[0] ?? '', /next_attempt_at\s*<=/u);
});

test('reconciliation cursor resumes from the last persisted window or cutover', async () => {
  const calls: Array<{ statement: string; values?: unknown[] }> = [];
  const cursor = new Date('2026-07-29T09:40:00.000Z');
  const pool = {
    async query(statement: string, values?: unknown[]) {
      calls.push({ statement, values });
      return { rows: [{ cursor_at: cursor }] };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  assert.equal(await store.readObservabilityReconciliationCursor(), cursor);
  assert.match(calls[0]?.statement ?? '', /max\(run\.window_end\)/u);
  assert.match(calls[0]?.statement ?? '', /run\.completed_at is not null/u);
  assert.match(
    calls[0]?.statement ?? '',
    /observability_reconciliation_cutovers/u,
  );
  assert.deepEqual(calls[0]?.values, ['observability/v1']);
});

test('reconciliation boundary and completion use PostgreSQL authority', async () => {
  const calls: Array<{ statement: string; values?: unknown[] }> = [];
  const windowEnd = new Date('2026-07-29T10:05:00.000Z');
  const pool = {
    async query(statement: string, values?: unknown[]) {
      calls.push({ statement, values });
      return calls.length === 1
        ? { rows: [{ window_end: windowEnd }] }
        : { rows: [{ id: 1 }], rowCount: 1 };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  assert.equal(
    await store.readObservabilityReconciliationBoundary({
      intervalMs: 5 * 60_000,
    }),
    windowEnd,
  );
  await store.completeObservabilityReconciliationWindow({
    windowStart: new Date('2026-07-29T09:40:00.000Z'),
    windowEnd,
  });

  assert.match(calls[0]?.statement ?? '', /clock_timestamp\(\)/u);
  assert.deepEqual(calls[0]?.values, [5 * 60_000]);
  assert.match(calls[1]?.statement ?? '', /completed_at=coalesce/u);
  assert.deepEqual(calls[1]?.values, [
    'observability/v1',
    '2026-07-29T09:40:00.000Z',
    '2026-07-29T10:05:00.000Z',
  ]);
});

test('reconciliation includes broken trace-backed events and derives delivery loss from drops', async () => {
  const calls: string[] = [];
  const pool = {
    async query(statement: string) {
      calls.push(statement);
      return {
        rows: [
          {
            action_usage_event_count: 0,
            business_event_count: 1,
            cutover_at: new Date('2026-07-29T09:00:00.000Z'),
            matched_count: 0,
            missing_trace_count: 1,
            orphan_trace_count: 0,
            rating_event_count: 1,
            trace_count: 0,
            undelivered_event_count: 1,
          },
        ],
      };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  await store.reconcileBusinessEventsToTraces({
    windowStart: new Date('2026-07-29T09:00:00.000Z'),
    windowEnd: new Date('2026-07-29T10:00:00.000Z'),
  });

  assert.match(
    calls[0] ?? '',
    /event\.event_type in \([\s\S]*'structured_decision_recorded'[\s\S]*'stage_decision_recorded'[\s\S]*'package_delivered'/u,
  );
  assert.match(calls[0] ?? '', /observability_drop_events/u);
  assert.match(calls[0] ?? '', /langfuse_outbox/u);
  for (const eventType of [
    'delivery_rating.recorded',
    'delivery_rating.withdrawn',
    'action_usage.recorded',
    'bounded_execution.suspended',
    'bounded_execution.resumed',
    'note_page_regenerated',
    'agent_primitive.lifecycle',
  ]) {
    assert.match(calls[0] ?? '', new RegExp(`'${eventType}'`, 'u'));
  }
});

test('drop aggregation is queryable by signal, reason, and source', async () => {
  const calls: string[] = [];
  const pool = {
    async query(statement: string) {
      calls.push(statement);
      return {
        rows: [
          {
            signal: 'score',
            reason: 'transient',
            source: 'langfuse_ingestion',
            count: 3,
          },
        ],
      };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  assert.deepEqual(
    await store.readObservabilityDropSummary({
      windowStart: new Date('2026-07-29T09:00:00.000Z'),
      windowEnd: new Date('2026-07-29T10:00:00.000Z'),
    }),
    [
      {
        signal: 'score',
        reason: 'transient',
        source: 'langfuse_ingestion',
        count: 3,
      },
    ],
  );
  assert.match(calls[0] ?? '', /sum\(count\)::int/u);
  assert.match(calls[0] ?? '', /group by signal, reason, source/u);
});

test('operator replay and discard only move dead-letter rows', async () => {
  const calls: Array<{ statement: string; values?: unknown[] }> = [];
  const pool = {
    async query(statement: string, values?: unknown[]) {
      calls.push({ statement, values });
      return { rows: [{ audit_id: 'audit-1' }], rowCount: 1 };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  assert.equal(await store.replayLangfuseDeadLetter('audit-1'), true);
  assert.equal(await store.discardLangfuseDeadLetter('audit-1'), true);
  assert.match(calls[0]?.statement ?? '', /status='dead_letter'/u);
  assert.match(calls[0]?.statement ?? '', /attempts=0/u);
  assert.match(calls[1]?.statement ?? '', /status='discarded'/u);
  assert.deepEqual(calls.map((call) => call.values), [['audit-1'], ['audit-1']]);
});
