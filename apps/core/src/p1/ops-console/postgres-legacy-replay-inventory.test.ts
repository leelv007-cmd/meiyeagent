import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresHarnessStore } from '../harness/postgres-store.js';
import { PostgresExecutionPlanSnapshotStore } from '../harness/postgres-execution-plan-admission-store.js';
import { LEGACY_REPLAY_ADMISSION_LOCK } from '../harness/legacy-replay-admission-lock.js';
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
         select $1 || '-runtime-new-' || series::text,
                $1 || '-logical-new-' || series::text,
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
                $1 || '-logical-new-' || series::text,
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
         values ($2, $1, $2, 'fixture', '{}'::jsonb, '1900-01-02T00:00:00.000Z')`,
        [legacyTaskId, `${prefix}-runtime-legacy`],
      );

      const snapshot = await new PostgresLegacyReplayInventory(pool).snapshot();
      assert.ok(snapshot.activePendingCount >= 1);
      assert.ok(snapshot.sampleTaskIds.includes(legacyTaskId));
    } finally {
      await pool.query(
        `delete from p1_execution_plan_snapshots where workflow_id like $1`,
        [`${prefix}-logical-%`],
      );
      await pool.query(
        `delete from harness_runtime.task_requests where workflow_id like $1`,
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

/**
 * V31-26a / P0-B: the ledger migration serializes against task admission but must
 * NOT close it.
 *
 * This test previously asserted the racing claim was rejected with "Legacy replay
 * admission is closed". That encoded the defect: api-runtime calls
 * migrateInstallationLedger() on every API boot, so asserting rejection here
 * asserted that booting the API kills the legacy branch every paid note/media
 * Make still runs on. The ledger is archive evidence; only the explicitly
 * recorded seal closes admission, which the second half of this test proves.
 *
 * Note on how the old assertion survived: on a long-lived test database the
 * zero-history guard below skipped the whole test, so it never ran at all.
 */
test(
  'legacy replay installation and task admission serialize without closing the live branch',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const suffix = randomUUID();
    const control = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const migrationPool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      application_name: `legacy-ledger-migration-${suffix}`,
    });
    const admissionPool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      application_name: `legacy-task-admission-${suffix}`,
    });
    const taskId = `legacy-ledger-race-${suffix}`;
    const blocker = await control.connect();
    try {
      await new PostgresHarnessStore(control).applySchema();
      await new PostgresExecutionPlanSnapshotStore(control).migrate();
      await control.query('drop table if exists p1_legacy_replay_installation_ledger cascade');
      await control.query('drop function if exists p1_reject_legacy_replay_ledger_mutation()');
      const before = await new PostgresLegacyReplayInventory(control).snapshot();
      if (before.activePendingCount !== 0 || before.lastLegacyTerminalAt !== null) {
        t.skip('shared Postgres fixture contains pre-existing legacy history');
        return;
      }

      await blocker.query('begin');
      await blocker.query('select pg_advisory_xact_lock(hashtext($1))', [
        LEGACY_REPLAY_ADMISSION_LOCK,
      ]);
      const migration = new PostgresLegacyReplayInventory(
        migrationPool,
      ).migrateInstallationLedger();
      await waitForAdvisoryLock(control, `legacy-ledger-migration-${suffix}`);

      const admission = new PostgresHarnessStore(admissionPool).claim({
        taskId,
        fingerprint: `fingerprint-${suffix}`,
        request: {
          actorId: 'owner-ledger-race',
          workspaceId: `workspace-ledger-race-${suffix}`,
          packageId: `package-ledger-race-${suffix}`,
          expectedRevision: 0,
          workflowRevision: 1,
          creationMode: 'customized',
          rawInput: '旧链并发准入',
          intent: {
            context: {
              workId: `work-ledger-race-${suffix}`,
              intent: '旧链并发准入',
              sourceSummaries: [],
            },
            assetReferences: [],
          },
        },
      });
      await waitForAdvisoryLock(control, `legacy-task-admission-${suffix}`);
      await blocker.query('commit');

      await migration;
      // Both took the same advisory lock, so they serialized; and the migration
      // did not close admission — the claim landed.
      const claimed = await admission;
      assert.equal(claimed.kind, 'created');
      const rows = await control.query<{ count: string }>(
        `select count(*)::text as count
           from harness_runtime.task_requests
          where workflow_id=$1`,
        [taskId],
      );
      assert.equal(rows.rows[0]?.count, '1');
      assert.match(
        (await new PostgresLegacyReplayInventory(control).installationEvidence()) ?? '',
        /migrationChecksum/,
      );

      // The recorded seal is what closes it. Same shape of claim, now refused.
      const auditId = `seal-proof-${suffix}`;
      await control.query(
        `insert into harness_runtime.audit_events
           (id, workflow_id, stage, event_type, payload)
         values ($1, $2, 'assembly_delivery', 'legacy_replay_admission_seal',
                 '{"verified":true}'::jsonb)`,
        [auditId, `seal-${suffix}`],
      );
      await new PostgresLegacyReplayInventory(control).sealLegacyReplayAdmission({
        evidenceAuditId: auditId,
      });
      await assert.rejects(
        new PostgresHarnessStore(admissionPool).claim({
          taskId: `${taskId}-sealed`,
          fingerprint: `fingerprint-sealed-${suffix}`,
          request: {
            actorId: 'owner-ledger-race',
            workspaceId: `workspace-ledger-race-${suffix}`,
            packageId: `package-ledger-race-${suffix}`,
            expectedRevision: 0,
            workflowRevision: 1,
            creationMode: 'customized',
            rawInput: '旧链并发准入',
            intent: {
              context: {
                workId: `work-ledger-race-${suffix}`,
                intent: '旧链并发准入',
                sourceSummaries: [],
              },
              assetReferences: [],
            },
          },
        }),
        /Legacy replay admission is closed by the recorded installation seal\./,
      );
    } finally {
      await blocker.query('rollback').catch(() => undefined);
      blocker.release();
      // The seal must not outlive this test: a leftover seal row closes legacy
      // admission for every later claim() against the same database. Truncate
      // does not fire the append-only row trigger.
      await control
        .query('truncate table harness_runtime.legacy_replay_admission_seal')
        .catch(() => undefined);
      await control.query(
        `delete from harness_runtime.audit_events where id=$1`,
        [`seal-proof-${suffix}`],
      );
      await control.query(
        'delete from harness_runtime.task_requests where workflow_id like $1',
        [`${taskId}%`],
      );
      await control.query('drop table if exists p1_legacy_replay_installation_ledger cascade');
      await control.query('drop function if exists p1_reject_legacy_replay_ledger_mutation()');
      await Promise.all([
        control.end(),
        migrationPool.end(),
        admissionPool.end(),
      ]);
    }
  },
);

async function waitForAdvisoryLock(pool: Pool, applicationName: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query<{ waiting: boolean }>(
      `select exists (
         select 1 from pg_stat_activity
          where application_name=$1
            and wait_event_type='Lock'
            and wait_event='advisory'
       ) as waiting`,
      [applicationName],
    );
    if (waiting.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${applicationName} did not wait for the admission lock.`);
}
