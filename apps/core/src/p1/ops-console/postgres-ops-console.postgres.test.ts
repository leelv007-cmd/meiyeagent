/**
 * Postgres durability contract for ops-console state (V31-22).
 * Skips when TEST_DATABASE_URL is unset — do not self-provision PG.
 *
 * Asserts: audit append-only + restart-readable + tool policy revision
 * monotonicity (immutable put-once).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresAgentSessionStore } from '../agent-session/postgres-agent-session-store.js';
import type { HarnessReleaseService } from '../harness/harness-release.js';
import { resolveWorkspaceHarnessRelease } from './ops-console-service.js';
import { PostgresOpsConsoleStore } from './postgres-ops-console.js';
import { AGENT_TOOL_POLICY_SCHEMA_VERSION } from './tool-policy.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres ops-console: audit append-only, restart-readable, tool policy revision monotonic',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresOpsConsoleStore(pool);
    await store.migrate();

    const auditId1 = `audit-${randomUUID()}`;
    const auditId2 = `audit-${randomUUID()}`;
    const toolName = `tool-${randomUUID().slice(0, 8)}`;
    const ts1 = '2026-08-08T22:00:00.000Z';
    const ts2 = '2026-08-08T22:01:00.000Z';

    try {
      const first = await store.append({
        id: auditId1,
        action: 'publish_release',
        operatorId: 'ops-pg',
        reason: 'ship candidate',
        evidence: null,
        target: 'rel-pg-1',
        detail: { version: 1 },
        createdAt: ts1,
        correlationId: 'corr-1',
      });
      assert.equal(first.id, auditId1);

      const second = await store.append({
        id: auditId2,
        action: 'rollback_production',
        operatorId: 'ops-pg',
        reason: 'incident',
        evidence: 'ticket-1',
        target: 'rel-pg-0',
        detail: {},
        createdAt: ts2,
        correlationId: 'corr-2',
      });
      assert.equal(second.evidence, 'ticket-1');

      // Append-only: primary key conflict on duplicate id (no overwrite path).
      await assert.rejects(
        store.append({
          id: auditId1,
          action: 'set_kill_switch',
          operatorId: 'ops-pg',
          reason: 'overwrite attempt',
          evidence: null,
          target: 'disable_memory_write',
          detail: {},
          createdAt: ts2,
          correlationId: 'corr-x',
        }),
        (error: unknown) =>
          error instanceof Error &&
          (/duplicate key|unique/i.test(error.message) ||
            ('code' in error &&
              String((error as { code?: string }).code) === '23505')),
      );

      const listed = await store.list(10);
      const ids = listed.map((entry) => entry.id);
      assert.ok(ids.includes(auditId1));
      assert.ok(ids.includes(auditId2));
      // Newest first.
      const idx1 = ids.indexOf(auditId1);
      const idx2 = ids.indexOf(auditId2);
      assert.ok(idx2 < idx1);

      const policyV1 = await store.putRevisionImmutable({
        schemaVersion: AGENT_TOOL_POLICY_SCHEMA_VERSION,
        toolName,
        revision: 'rev-1',
        description: 'first',
        sideEffect: 'none',
        riskClass: 'read',
        approval: 'never',
        allowedPhases: ['intent'],
        dataClasses: [],
        maxCallsPerRun: 2,
        timeoutMs: 1000,
        recentDenialReasons: [],
        createdAt: ts1,
        createdBy: 'ops-pg',
      });
      assert.equal(policyV1.revision, 'rev-1');

      // Same revision cannot be mutated / re-inserted (monotonic revisions).
      await assert.rejects(
        store.putRevisionImmutable({
          ...policyV1,
          description: 'tamper',
          createdAt: ts2,
        }),
        (error: unknown) =>
          error instanceof Error && error.message.includes('immutable'),
      );

      const policyV2 = await store.putRevisionImmutable({
        schemaVersion: AGENT_TOOL_POLICY_SCHEMA_VERSION,
        toolName,
        revision: 'rev-2',
        description: 'second',
        sideEffect: 'none',
        riskClass: 'read',
        approval: 'never',
        allowedPhases: ['intent', 'plan'],
        dataClasses: [],
        maxCallsPerRun: 4,
        timeoutMs: 2000,
        recentDenialReasons: [],
        createdAt: ts2,
        createdBy: 'ops-pg',
      });
      assert.equal(policyV2.revision, 'rev-2');

      // Restart-readable: new store instance on same pool sees prior rows.
      const restarted = new PostgresOpsConsoleStore(pool);
      const auditsAfterRestart = await restarted.list(50);
      assert.ok(auditsAfterRestart.some((entry) => entry.id === auditId1));
      assert.ok(auditsAfterRestart.some((entry) => entry.id === auditId2));

      const tools = await restarted.listTools();
      assert.ok(tools.includes(toolName));
      const revisions = await restarted.listByTool(toolName);
      assert.equal(revisions.length, 2);
      assert.deepEqual(revisions.map((item) => item.revision).sort(), [
        'rev-1',
        'rev-2',
      ]);
      const exact = await restarted.getRevision(toolName, 'rev-1');
      assert.equal(exact?.description, 'first');

      // Kill switch / trial / drill also survive restart (spot-check).
      await store.putKillSwitch({
        switchId: 'disable_memory_write',
        enabled: false,
        updatedAt: ts2,
        updatedBy: 'ops-pg',
        reason: 'confirm off',
      });
      await store.putCandidateTrial({
        workspaceId: `ws-${randomUUID().slice(0, 8)}`,
        candidateReleaseId: 'rel-cand',
        operatorId: 'ops-pg',
        reason: 'trial',
        updatedAt: ts2,
        expiresAt: '2026-08-09T01:00:00.000Z',
        consumedByRunId: null,
        consumedAt: null,
      });
      const drillId = `drill-${randomUUID()}`;
      await store.appendRollbackDrill({
        id: drillId,
        releaseId: 'rel-pg-1',
        operatorId: 'ops-pg',
        reason: 'pre-publish drill',
        evidence: 'run-1',
        result: 'passed',
        notes: null,
        createdAt: ts2,
      });

      const killed = await restarted.getKillSwitch('disable_memory_write');
      assert.equal(killed?.reason, 'confirm off');
      const drills = await restarted.listRollbackDrills(10);
      assert.ok(drills.some((item) => item.id === drillId));
      const trials = await restarted.listCandidateTrials();
      assert.ok(trials.some((item) => item.candidateReleaseId === 'rel-cand'));

      const rollbackOperationId = `rollback-op-crash-${randomUUID()}`;
      await store.beginRollbackOperation({
        id: rollbackOperationId,
        toReleaseId: 'rel-pg-0',
        createdAt: ts2,
        audit: {
          id: rollbackOperationId,
          action: 'rollback_production',
          operatorId: 'ops-pg',
          reason: 'recover crash',
          evidence: 'incident-1',
          target: 'rel-pg-0',
          detail: {},
          createdAt: ts2,
          correlationId: 'corr-recover',
        },
      });
      assert.equal((await restarted.listPendingRollbackOperations()).length, 1);
      assert.ok((await restarted.listCandidateTrials()).length > 0);
      await pool.query(`
        CREATE OR REPLACE FUNCTION p1_test_fail_rollback_audit()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.id LIKE 'rollback-op-crash-%' THEN
            RAISE EXCEPTION 'simulated audit crash';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER p1_test_fail_rollback_audit_trigger
        BEFORE INSERT ON p1_ops_console_audit
        FOR EACH ROW EXECUTE FUNCTION p1_test_fail_rollback_audit();
      `);
      await assert.rejects(
        restarted.completeRollbackOperation(rollbackOperationId),
        /simulated audit crash/,
      );
      assert.equal((await restarted.listPendingRollbackOperations()).length, 1);
      assert.ok((await restarted.listCandidateTrials()).length > 0);
      assert.equal(
        (await restarted.list(50)).some(
          (entry) => entry.id === rollbackOperationId,
        ),
        false,
      );
      await pool.query(`
        DROP TRIGGER p1_test_fail_rollback_audit_trigger ON p1_ops_console_audit;
        DROP FUNCTION p1_test_fail_rollback_audit();
      `);
      await restarted.completeRollbackOperation(rollbackOperationId);
      assert.equal((await restarted.listPendingRollbackOperations()).length, 0);
      assert.equal((await restarted.listCandidateTrials()).length, 0);
      assert.ok(
        (await restarted.list(50)).some(
          (entry) => entry.id === rollbackOperationId,
        ),
      );

      const concurrentOperationId = `rollback-op-concurrent-${randomUUID()}`;
      await restarted.putCandidateTrial({
        workspaceId: `ws-${randomUUID()}`,
        candidateReleaseId: 'rel-cand',
        operatorId: 'ops-pg',
        reason: 'must be cleared by recovery',
        updatedAt: ts2,
        expiresAt: '2026-08-09T01:00:00.000Z',
        consumedByRunId: null,
        consumedAt: null,
      });
      await restarted.beginRollbackOperation({
        id: concurrentOperationId,
        toReleaseId: 'rel-pg-0',
        createdAt: ts2,
        audit: {
          id: concurrentOperationId,
          action: 'rollback_production',
          operatorId: 'ops-pg',
          reason: 'concurrent recovery',
          evidence: 'incident-concurrent',
          target: 'rel-pg-0',
          detail: {},
          createdAt: ts2,
          correlationId: 'corr-concurrent',
        },
      });
      let pendingListCalls = 0;
      let releaseListBarrier!: () => void;
      const bothListed = new Promise<void>((resolve) => {
        releaseListBarrier = resolve;
      });
      const rollbackOperations = {
        beginRollbackOperation: (
          operation: Parameters<
            typeof restarted.beginRollbackOperation
          >[0],
        ) => restarted.beginRollbackOperation(operation),
        async listPendingRollbackOperations() {
          const operations = await restarted.listPendingRollbackOperations();
          pendingListCalls += 1;
          if (pendingListCalls === 2) releaseListBarrier();
          await bothListed;
          return operations;
        },
        completeRollbackOperation: (operationId: string) =>
          restarted.completeRollbackOperation(operationId),
      };
      const releases = {
        async rollbackProduction() {
          return {};
        },
        async resolveForRun() {
          return { releaseId: 'rel-pg-0' };
        },
      } as unknown as HarnessReleaseService;
      const recovered = await Promise.all([
        resolveWorkspaceHarnessRelease({
          workspaceId: 'ws-concurrent-a',
          runId: 'run-concurrent-a',
          releases,
          trials: restarted,
          rollbackOperations,
        }),
        resolveWorkspaceHarnessRelease({
          workspaceId: 'ws-concurrent-b',
          runId: 'run-concurrent-b',
          releases,
          trials: restarted,
          rollbackOperations,
        }),
      ]);
      assert.deepEqual(
        recovered.map((item) => item.releaseId),
        ['rel-pg-0', 'rel-pg-0'],
      );
      assert.equal((await restarted.listPendingRollbackOperations()).length, 0);
      assert.equal((await restarted.listCandidateTrials()).length, 0);
      assert.equal(
        (await restarted.list(50)).filter(
          (entry) => entry.id === concurrentOperationId,
        ).length,
        1,
      );
    } finally {
      await pool.query(
        'DROP TRIGGER IF EXISTS p1_test_fail_rollback_audit_trigger ON p1_ops_console_audit',
      );
      await pool.query('DROP FUNCTION IF EXISTS p1_test_fail_rollback_audit()');
      await pool.query(
        `DELETE FROM p1_ops_console_audit WHERE id = ANY($1::text[])`,
        [[auditId1, auditId2]],
      );
      await pool.query(
        `DELETE FROM p1_ops_console_audit WHERE id LIKE 'rollback-op-%'`,
      );
      await pool.query(
        `DELETE FROM p1_ops_console_rollback_operations WHERE id LIKE 'rollback-op-%'`,
      );
      await pool.query(
        `DELETE FROM p1_ops_console_tool_policies WHERE tool_name = $1`,
        [toolName],
      );
      await pool.query(
        `DELETE FROM p1_ops_console_kill_switches WHERE switch_id = $1`,
        ['disable_memory_write'],
      );
      await pool.query(
        `DELETE FROM p1_ops_console_candidate_trials WHERE candidate_release_id = $1`,
        ['rel-cand'],
      );
      await pool.query(
        `DELETE FROM p1_ops_console_rollback_drills WHERE id LIKE 'drill-%'`,
      );
      await pool.end();
    }
  },
);

test(
  'Postgres migration expires legacy trials and malformed reads fail closed',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresOpsConsoleStore(pool);
    await store.migrate();
    const legacyWorkspace = `legacy-${randomUUID()}`;
    const malformedWorkspace = `malformed-${randomUUID()}`;
    try {
      for (const workspaceId of [legacyWorkspace, malformedWorkspace]) {
        const payload = {
          workspaceId,
          candidateReleaseId: 'rel-legacy',
          operatorId: 'ops',
          reason: 'legacy',
          updatedAt: '2026-08-08T00:00:00.000Z',
        };
        await pool.query(
          `INSERT INTO p1_ops_console_candidate_trials
           (workspace_id, candidate_release_id, operator_id, reason, updated_at, payload)
           VALUES ($1, 'rel-legacy', 'ops', 'legacy', NOW(), $2::jsonb)`,
          [workspaceId, JSON.stringify(payload)],
        );
      }
      await store.migrate();
      assert.equal(await store.getCandidateTrial(legacyWorkspace), null);

      await pool.query(
        `INSERT INTO p1_ops_console_candidate_trials
         (workspace_id, candidate_release_id, operator_id, reason, updated_at, payload)
         VALUES ($1, 'rel-bad', 'ops', 'bad', NOW(), $2::jsonb)`,
        [
          malformedWorkspace,
          JSON.stringify({
            workspaceId: malformedWorkspace,
            candidateReleaseId: 'rel-bad',
            operatorId: 'ops',
            reason: 'bad',
            updatedAt: 'bad-date',
            expiresAt: 'also-bad',
            consumedByRunId: null,
            consumedAt: null,
          }),
        ],
      );
      await assert.rejects(
        store.getCandidateTrial(malformedWorkspace),
        /timestamps are invalid/,
      );
    } finally {
      await pool.query(
        'DELETE FROM p1_ops_console_candidate_trials WHERE workspace_id = ANY($1::text[])',
        [[legacyWorkspace, malformedWorkspace]],
      );
      await pool.end();
    }
  },
);

test(
  'V31-105 §5: run pins scoped by releaseId survive a recent window filled by other releases',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresOpsConsoleStore(pool);
    const sessions = new PostgresAgentSessionStore(pool);
    await store.migrate();
    await sessions.migrate();
    // listRecentRunPins unions the harness pending-question projection; a bare
    // business DB may not carry that schema yet.
    await pool.query(`
      create schema if not exists harness_runtime;
      create table if not exists harness_runtime.task_requests (
        task_id text primary key,
        workflow_id text not null,
        runtime_id text not null,
        fingerprint text not null,
        request jsonb not null,
        created_at timestamptz not null default now()
      );
      create table if not exists harness_runtime.pending_questions (
        task_id text primary key,
        question_id text not null,
        workflow_revision bigint not null,
        payload jsonb not null,
        status text not null check (status in ('pending', 'resolved')),
        updated_at timestamptz not null default now()
      );
    `);

    const suffix = randomUUID();
    const workspaceId = `workspace-pins-${suffix}`;
    const threadId = `thread-pins-${suffix}`;
    const releaseA = `rel-pins-a-${suffix}`;
    const noiseRelease = `rel-pins-noise-${suffix}`;
    // Far-future timestamps keep the window deterministic on a shared test DB:
    // the noise runs are strictly the newest rows in p1_agent_runs.
    const releaseARunIds = ['a-1', 'a-2'].map(
      (name) => `run-pins-${name}-${suffix}`,
    );
    const noiseRunIds = Array.from(
      { length: 25 },
      (_unused, index) => `run-pins-noise-${index}-${suffix}`,
    );

    try {
      await pool.query(
        `INSERT INTO p1_agent_threads
           (thread_id, resource_id, status, session_revision, summary_revision,
            payload, created_at, updated_at)
         VALUES ($1, $2, 'active', 0, 0, '{}'::jsonb, NOW(), NOW())`,
        [threadId, workspaceId],
      );
      const insertRun = async (
        runId: string,
        releaseId: string,
        startedAt: string,
      ) => {
        await pool.query(
          `INSERT INTO p1_agent_runs
             (run_id, thread_id, trigger, status, durability,
              harness_release_id, payload, started_at)
           VALUES ($1, $2, 'merchant_turn', 'completed', 'exit', $3,
                   '{}'::jsonb, $4::timestamptz)`,
          [runId, threadId, releaseId, startedAt],
        );
      };
      for (const [index, runId] of releaseARunIds.entries()) {
        await insertRun(
          runId,
          releaseA,
          `2098-01-01T00:0${index}:00.000Z`,
        );
      }
      for (const [index, runId] of noiseRunIds.entries()) {
        await insertRun(
          runId,
          noiseRelease,
          `2099-01-01T00:${String(index).padStart(2, '0')}:00.000Z`,
        );
      }

      const recent = await store.listRecentRunPins(20);
      const recentIds = new Set(recent.map((pin) => pin.runId));
      assert.equal(
        releaseARunIds.some((runId) => recentIds.has(runId)),
        false,
        'other releases fill the recent window and evict release A',
      );

      const scoped = await store.listRecentRunPins(20, releaseA);
      assert.deepEqual(
        scoped.map((pin) => pin.runId).sort(),
        [...releaseARunIds].sort(),
      );
      assert.deepEqual(
        [...new Set(scoped.map((pin) => pin.harnessReleaseId))],
        [releaseA],
      );
      assert.equal(scoped[0]?.workspaceId, workspaceId);
    } finally {
      await pool.query('DELETE FROM p1_agent_runs WHERE run_id = ANY($1::text[])', [
        [...releaseARunIds, ...noiseRunIds],
      ]);
      await pool.query('DELETE FROM p1_agent_threads WHERE thread_id = $1', [
        threadId,
      ]);
      await pool.end();
    }
  },
);
