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
