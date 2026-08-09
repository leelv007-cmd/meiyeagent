/**
 * V31-26a / P0-B: the installation ledger must not close the legacy replay
 * branch that production still runs on.
 *
 * Fail-open positive case: after `migrateInstallationLedger()` (which every API
 * boot calls) a snapshot-less Task claim — every paid note/media Make today —
 * must still be admitted.
 * Fail-closed negative case: once an operator records the explicit append-only
 * seal, the same snapshot-less claim is rejected.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresLegacyReplayInventory } from '../ops-console/postgres-legacy-replay-inventory.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { isLegacyReplayAdmissionSealed } from './legacy-replay-admission-seal.js';
import { PostgresHarnessStore } from './postgres-store.js';
import type { HarnessWorkflowInput } from './task-admission.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString
  ? false
  : 'TEST_DATABASE_URL is not configured';

function legacyBranchRequest(workspaceId: string): HarnessWorkflowInput {
  // Shape of the branch task-admission.ts:422-427 documents as still legacy:
  // merchant_confirmed paid media, therefore no executionPlanSnapshot.
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
  // The seal table is append-only via trigger; drop it to restore the
  // unsealed installation state between cases.
  await pool.query(
    'drop table if exists p1_legacy_replay_admission_seal cascade',
  );
}

test(
  'V31-26a: booting the installation ledger keeps the live legacy branch admissible',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const workspaceId = `ws-seal-open-${randomUUID()}`;
    const taskId = `task-seal-open-${randomUUID()}`;
    try {
      await store.applySchema();
      await resetSeal(pool);
      // Exactly what api-runtime.ts:353 does on every API boot.
      await new PostgresLegacyReplayInventory(pool).migrateInstallationLedger();
      assert.equal(await isLegacyReplayAdmissionSealed(pool), false);

      const request = legacyBranchRequest(workspaceId);
      const claim = await store.claim({
        taskId,
        fingerprint: fingerprintValue(request),
        request,
      });
      assert.equal(claim.kind, 'created');
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
        /Legacy replay admission is closed by the recorded installation seal\./,
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
  'V31-26a: sealing refuses without an audited proof row',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const inventory = new PostgresLegacyReplayInventory(pool);
    try {
      await new PostgresHarnessStore(pool).applySchema();
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
