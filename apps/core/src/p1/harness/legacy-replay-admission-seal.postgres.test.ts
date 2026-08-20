/**
 * V31-26a operator seal + U14 RET-06 archive.
 *
 * Snapshot-less durable replay is code-sealed fail-closed. The installation
 * ledger still must not be the gate; the operator row remains extra evidence.
 * Paid snapshot / pending-confirmation claims stay admissible.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresLegacyReplayInventory } from '../ops-console/postgres-legacy-replay-inventory.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { makeRestartRequest } from './dbos-make-restart.fixture.js';
import { ExecutionPlanAdmissionService } from './execution-plan-admission.js';
import {
  isLegacyReplayAdmissionSealed,
  LEGACY_REPLAY_ADMISSION_SEAL_TABLE,
} from './legacy-replay-admission-seal.js';
import { PostgresExecutionPlanSnapshotStore } from './postgres-execution-plan-admission-store.js';
import { PostgresHarnessStore } from './postgres-store.js';
import {
  executionPlanAdmissionWorkflowId,
  HarnessTaskAdmissionService,
  type HarnessWorkflowInput,
} from './task-admission.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString
  ? false
  : 'TEST_DATABASE_URL is not configured';

function legacyBranchRequest(workspaceId: string): HarnessWorkflowInput {
  // The one ratified legacy population: a task admitted before the compile
  // freeze existed, so it carries neither executionPlanSnapshot nor freeze and
  // replays on legacy five-stage. Every other paid precondition already fails
  // closed in admission, so this is the only shape the seal has to govern.
  return {
    workspaceId,
    merchantInput: '帮我做一条门店探店视频',
    executionSnapshot: {
      lens: 'video',
      sources: { assets: [], facts: [] },
    },
  } as unknown as HarnessWorkflowInput;
}

async function resetSeal(pool: Pool): Promise<void> {
  // The seal row is append-only via trigger, and the table now lives in the
  // harness schema, so it must never be dropped to reset — truncate does not
  // fire the row trigger and restores the unsealed installation state.
  await pool.query(
    `truncate table ${LEGACY_REPLAY_ADMISSION_SEAL_TABLE}`,
  );
}

test(
  'U14: booting the installation ledger still refuses snapshot-less durable replay',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const workspaceId = `ws-seal-open-${randomUUID()}`;
    const taskId = `task-seal-open-${randomUUID()}`;
    try {
      await store.applySchema();
      // claim() reads the snapshot table, which applySchema does not create.
      await new PostgresExecutionPlanSnapshotStore(pool).migrate();
      await resetSeal(pool);
      // Exactly what api-runtime.ts:353 does on every API boot.
      await new PostgresLegacyReplayInventory(pool).migrateInstallationLedger();
      assert.equal(await isLegacyReplayAdmissionSealed(pool), false);

      const request = legacyBranchRequest(workspaceId);
      await assert.rejects(
        store.claim({
          taskId,
          fingerprint: fingerprintValue(request),
          request,
        }),
        /archived fail-closed \(U14\)/,
      );
    } finally {
      await pool.query(
        `delete from harness_runtime.task_requests
          where request->>'workspaceId'=$1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'V31-26a: the explicit append-only seal closes snapshot-less admission',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const inventory = new PostgresLegacyReplayInventory(pool);
    const workspaceId = `ws-seal-closed-${randomUUID()}`;
    const taskId = `task-seal-closed-${randomUUID()}`;
    const auditId = `seal-proof-${randomUUID()}`;
    try {
      await store.applySchema();
      // claim() reads the snapshot table, which applySchema does not create.
      await new PostgresExecutionPlanSnapshotStore(pool).migrate();
      await resetSeal(pool);
      await inventory.migrateInstallationLedger();
      await pool.query(
        `insert into harness_runtime.audit_events
           (id, workflow_id, stage, event_type, payload)
         values ($1, $2, 'assembly_delivery', 'legacy_replay_admission_seal',
                 '{"verified":true}'::jsonb)`,
        [auditId, `seal-${workspaceId}`],
      );

      await inventory.sealLegacyReplayAdmission({ evidenceAuditId: auditId });
      assert.equal(await isLegacyReplayAdmissionSealed(pool), true);

      const request = legacyBranchRequest(workspaceId);
      await assert.rejects(
        store.claim({
          taskId,
          fingerprint: fingerprintValue(request),
          request,
        }),
        /archived fail-closed \(U14\)|Legacy replay admission is closed by the recorded installation seal\./,
      );
    } finally {
      await resetSeal(pool);
      await pool.query('delete from harness_runtime.audit_events where id=$1', [
        auditId,
      ]);
      await pool.query(
        `delete from harness_runtime.task_requests
          where request->>'workspaceId'=$1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'V31-26a: a sealed installation accepts a task-bound canonical snapshot',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const inventory = new PostgresLegacyReplayInventory(pool);
    const snapshotStore = new PostgresExecutionPlanSnapshotStore(pool);
    const suffix = randomUUID();
    const workspaceId = `ws-seal-snapshot-${suffix}`;
    const taskId = `task-seal-snapshot-${suffix}`;
    const auditId = `seal-proof-${suffix}`;
    const request = makeRestartRequest(taskId, workspaceId).request;
    const snapshot = request.executionPlanSnapshot!;
    const snapshotWorkflowId = executionPlanAdmissionWorkflowId(
      taskId,
      request,
    );

    try {
      await store.applySchema();
      await snapshotStore.migrate();
      await resetSeal(pool);
      await inventory.migrateInstallationLedger();
      await new ExecutionPlanAdmissionService(snapshotStore).admitSnapshot({
        workflowId: snapshotWorkflowId,
        workspaceId,
        snapshot,
      });
      assert.equal(
        snapshotWorkflowId,
        `${taskId}:plan:${snapshot.planRevision}:${snapshot.snapshotHash}`,
      );

      await pool.query(
        `insert into harness_runtime.audit_events
           (id, workflow_id, stage, event_type, payload)
         values ($1, $2, 'assembly_delivery', 'legacy_replay_admission_seal',
                 '{"verified":true}'::jsonb)`,
        [auditId, `seal-${workspaceId}`],
      );
      await inventory.sealLegacyReplayAdmission({ evidenceAuditId: auditId });

      const claim = await store.claim({
        taskId,
        fingerprint: fingerprintValue(request),
        request,
      });
      assert.equal(claim.kind, 'created');

      // The caller-owned snapshot/hash cannot attest its own admission. The
      // persisted row must remain bound to both the logical task and workspace.
      await assert.rejects(
        store.claim({
          taskId: `${taskId}-other`,
          fingerprint: fingerprintValue(request),
          request,
        }),
        /archived fail-closed \(U14\)|Legacy replay admission is closed by the recorded installation seal\./,
      );
      const otherWorkspaceRequest = {
        ...request,
        workspaceId: `${workspaceId}-other`,
      };
      await assert.rejects(
        store.claim({
          taskId,
          fingerprint: fingerprintValue(otherWorkspaceRequest),
          request: otherWorkspaceRequest,
        }),
        /archived fail-closed \(U14\)|Legacy replay admission is closed by the recorded installation seal\./,
      );
    } finally {
      await resetSeal(pool);
      await pool.query('delete from harness_runtime.audit_events where id=$1', [
        auditId,
      ]);
      await pool.query(
        `delete from harness_runtime.task_requests
          where request->>'workspaceId'=any($1::text[])`,
        [[workspaceId, `${workspaceId}-other`]],
      );
      await pool.query(
        'delete from p1_execution_plan_snapshots where workspace_id=$1',
        [workspaceId],
      );
      await pool.end();
    }
  },
);

/**
 * Consumer proof at the public admission seam: U14 refuses snapshot-less
 * durable replay through HarnessTaskAdmissionService + PostgresHarnessStore.
 */
test(
  'U14: a snapshot-less submission is refused through HarnessTaskAdmissionService',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const workspaceId = `ws-seal-submit-${randomUUID()}`;
    const started: string[] = [];
    const service = new HarnessTaskAdmissionService(store, {
      async start(input) {
        started.push(input.workflowId);
        return { workflowId: input.workflowId };
      },
    });
    // The real HarnessTaskRequest shape: submit() parses it with
    // harnessTaskRequestSchema, so a hand-rolled object would be rejected before
    // the seal gate is ever reached.
    const submission = {
      taskId: `task-seal-submit-${randomUUID()}`,
      actorId: 'owner-1',
      workspaceId,
      packageId: 'package-1',
      expectedRevision: 2,
      workflowRevision: 4,
      creationMode: 'customized' as const,
      rawInput: '帮我做一条门店探店视频',
      intent: {
        context: {
          workId: 'work-1',
          intent: '帮我做一条门店探店视频',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    };
    try {
      await store.applySchema();
      // claim() reads the snapshot table, which applySchema does not create.
      await new PostgresExecutionPlanSnapshotStore(pool).migrate();
      await resetSeal(pool);
      await new PostgresLegacyReplayInventory(pool).migrateInstallationLedger();

      await assert.rejects(
        service.submit(submission),
        /archived fail-closed \(U14\)/,
      );
      assert.deepEqual(started, []);
    } finally {
      await resetSeal(pool);
      await pool.query(
        `delete from harness_runtime.task_requests
          where request->>'workspaceId'=$1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'V31-26a: sealing refuses without an audited proof row',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const inventory = new PostgresLegacyReplayInventory(pool);
    try {
      await new PostgresHarnessStore(pool).applySchema();
      await new PostgresExecutionPlanSnapshotStore(pool).migrate();
      await resetSeal(pool);
      await inventory.migrateInstallationLedger();
      await assert.rejects(
        inventory.sealLegacyReplayAdmission({
          evidenceAuditId: `missing-${randomUUID()}`,
        }),
        /audited/i,
      );
      assert.equal(await isLegacyReplayAdmissionSealed(pool), false);
    } finally {
      await resetSeal(pool);
      await pool.end();
    }
  },
);
