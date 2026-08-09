import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresHarnessStore } from '../harness/postgres-store.js';
import { PostgresExecutionPlanSnapshotStore } from '../harness/postgres-execution-plan-admission-store.js';
import { PostgresLegacyReplayInventory } from './postgres-legacy-replay-inventory.js';

test('legacy inventory filters and counts in SQL without a pre-filter LIMIT', async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('with active_legacy')) {
        return {
          rows: [{
            active_count: '601',
            oldest_created_at: '2026-01-01T00:00:00.000Z',
            sample_task_ids: ['legacy-1'],
          }],
        };
      }
      return { rows: [{ terminal_at: null }] };
    },
  } as unknown as Pool;

  const snapshot = await new PostgresLegacyReplayInventory(pool).snapshot();
  assert.equal(snapshot.activePendingCount, 601);
  assert.deepEqual(snapshot.sampleTaskIds, ['legacy-1']);
  const activeSql = queries[0]!.toLowerCase();
  assert.match(activeSql, /executionplansnapshot/);
  assert.match(activeSql, /count\(\*\)/);
  assert.doesNotMatch(
    activeSql.slice(0, activeSql.indexOf('select count(*)')),
    /limit\s+\d+/,
  );
});

test(
  'Postgres legacy inventory sees a legacy row beyond 500 non-legacy rows',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const prefix = `legacy-inventory-${randomUUID()}`;
    try {
      await new PostgresHarnessStore(pool).applySchema();
      await new PostgresExecutionPlanSnapshotStore(pool).migrate();
      await pool.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request, created_at)
         select $1 || '-new-' || series::text,
                $1 || '-new-' || series::text,
                $1 || '-runtime-new-' || series::text,
                'fixture',
                jsonb_build_object(
                  'executionPlanSnapshot',
                  jsonb_build_object('snapshotHash', $1 || '-snapshot-' || series::text)
                ),
                '1900-01-01T00:00:00.000Z'::timestamptz + series * interval '1 second'
         from generate_series(1, 501) series`,
        [prefix],
      );
      await pool.query(
        `insert into p1_execution_plan_snapshots (
           snapshot_hash, workflow_id, workspace_id, plan_id, plan_revision,
           approval_basis, confirmation_decision_ref, payload, admitted_at
         )
         select $1 || '-snapshot-' || series::text,
                $1 || '-new-' || series::text,
                'fixture-workspace',
                $1 || '-plan-' || series::text,
                1,
                'merchant_confirmed',
                null,
                jsonb_build_object('snapshotHash', $1 || '-snapshot-' || series::text),
                '1900-01-01T00:00:00.000Z'::timestamptz + series * interval '1 second'
         from generate_series(1, 501) series`,
        [prefix],
      );
      const legacyTaskId = `${prefix}-legacy`;
      await pool.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request, created_at)
         values ($1, $1, $2, 'fixture', '{}'::jsonb, '1900-01-02T00:00:00.000Z')`,
        [legacyTaskId, `${prefix}-runtime-legacy`],
      );

      const snapshot = await new PostgresLegacyReplayInventory(pool).snapshot();
      assert.ok(snapshot.activePendingCount >= 1);
      assert.ok(snapshot.sampleTaskIds.includes(legacyTaskId));
    } finally {
      await pool.query(
        `delete from p1_execution_plan_snapshots where workflow_id like $1`,
        [`${prefix}%`],
      );
      await pool.query(
        `delete from harness_runtime.task_requests where task_id like $1`,
        [`${prefix}%`],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres legacy inventory treats malformed and unadmitted snapshots as blockers',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const prefix = `legacy-malformed-${randomUUID()}`;
    try {
      await new PostgresHarnessStore(pool).applySchema();
      await new PostgresExecutionPlanSnapshotStore(pool).migrate();
      await pool.query(
        `insert into harness_runtime.task_requests
          (task_id, workflow_id, runtime_id, fingerprint, request)
         values
          ($1, $1, $2, 'fixture', '{"executionPlanSnapshot":{"schemaVersion":"unknown"}}'::jsonb),
          ($3, $3, $4, 'fixture', '{"executionPlanSnapshot":"corrupt"}'::jsonb)`,
        [`${prefix}-unknown`, `${prefix}-runtime-unknown`, `${prefix}-corrupt`, `${prefix}-runtime-corrupt`],
      );
      const snapshot = await new PostgresLegacyReplayInventory(pool).snapshot();
      assert.ok(snapshot.sampleTaskIds.includes(`${prefix}-unknown`));
      assert.ok(snapshot.sampleTaskIds.includes(`${prefix}-corrupt`));
    } finally {
      await pool.query('delete from harness_runtime.task_requests where task_id like $1', [`${prefix}%`]);
      await pool.end();
    }
  },
);

test(
  'legacy replay installation ledger rejects tampering in Postgres',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      await new PostgresHarnessStore(pool).applySchema();
      await new PostgresExecutionPlanSnapshotStore(pool).migrate();
      const inventory = new PostgresLegacyReplayInventory(pool);
      await inventory.migrateInstallationLedger();
      await pool.query(
        `insert into p1_legacy_replay_installation_ledger
           (singleton, deployment_id, migration_checksum, initial_legacy_count)
         values (true, $1, $2, 0)
         on conflict (singleton) do nothing`,
        [
          'v31-26a-legacy-replay-ledger-v1',
          createHash('sha256')
            .update('v31-26a-legacy-replay-ledger-v1')
            .digest('hex'),
        ],
      );
      await assert.rejects(
        () =>
          pool.query(
            `update p1_legacy_replay_installation_ledger
                set initial_legacy_count=1
              where singleton=true`,
          ),
        /immutable/,
      );
      assert.match((await inventory.installationEvidence()) ?? '', /migrationChecksum/);
    } finally {
      await pool.query('drop table if exists p1_legacy_replay_installation_ledger');
      await pool.query('drop function if exists p1_reject_legacy_replay_ledger_mutation()');
      await pool.end();
    }
  },
);
