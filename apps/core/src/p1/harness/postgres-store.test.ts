import assert from 'node:assert/strict';
import test from 'node:test';

import type { Pool } from 'pg';

import { PostgresHarnessStore } from './postgres-store.js';

test('today recommendation reads the fact revision through the ledger API', async () => {
  const sql: string[] = [];
  const pool = {
    async query(statement: string) {
      sql.push(statement);
      return { rows: [] };
    },
  } as unknown as Pool;
  const revisionReads: string[] = [];
  const store = new PostgresHarnessStore(pool, {
    async currentRevision(workspaceId: string) {
      revisionReads.push(workspaceId);
      return 7;
    },
  });

  const recommendation = await store.readTodayRecommendation('workspace-1');

  assert.deepEqual(revisionReads, ['workspace-1']);
  assert.equal(recommendation.currentFactsRevision, 7);
  assert.equal(recommendation.recommendation, null);
  assert.equal(
    sql.some((statement) =>
      statement.includes('p1_store_fact_workspace_heads')
    ),
    false
  );
});

test('business audit facts are read from PostgreSQL without Langfuse storage', async () => {
  const sql: string[] = [];
  const pool = {
    async query(statement: string) {
      sql.push(statement);
      if (statement.includes('harness_runtime.task_requests')) {
        return { rows: [{ runtime_id: 'workspace-1:task-1' }] };
      }
      return {
        rows: [
          {
            payload: {
              code: 'HARNESS_COPY_ONLY',
              status: 409,
            },
          },
        ],
      };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  assert.deepEqual(await store.readTerminalFailure('workspace-1', 'task-1'), {
    code: 'HARNESS_COPY_ONLY',
    status: 409,
  });
  assert.equal(sql.length, 2);
  assert.ok(sql.every((statement) => statement.includes('harness_runtime.')));
  assert.ok(
    sql.every(
      (statement) =>
        !statement.toLowerCase().includes('clickhouse') &&
        !statement.includes('langfuse_outbox'),
    ),
  );
});
