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

test('Langfuse outbox schema has terminal dead-letter states and claim cap', async () => {
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

  await store.claimLangfuseBatch(5, 300, 3);
  assert.equal(statements.length, 2);
  assert.match(statements[1] ?? '', /attempts < \$3/u);
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
