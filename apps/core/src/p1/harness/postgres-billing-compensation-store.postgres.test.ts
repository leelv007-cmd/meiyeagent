import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import { PostgresCreationSubmissionStore } from '../execution-spine/postgres-creation-submission-store.js';
import { PostgresHarnessBillingCompensationStore } from './postgres-billing-compensation-store.js';
import { PostgresHarnessStore } from './postgres-store.js';
import { harnessRuntimeId } from './workspace-scope.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'queued credit refunds preserve the forced-refund contract',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const compensations = new PostgresHarnessBillingCompensationStore(pool);
    const suffix = randomUUID();
    const task = {
      action: 'refund' as const,
      attempts: 0,
      workspaceId: `forced-refund-${suffix}`,
      taskId: `task-${suffix}`,
      quoteId: `quote-${suffix}`,
      quoteRevision: 'quote-revision-1',
      forceCreditRefund: true,
    };
    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS harness_runtime');
      await compensations.migrate();
      await compensations.enqueue(task);

      const [claimed] = await compensations.claimBatch(1);
      assert.equal(claimed?.forceCreditRefund, true);
    } finally {
      await pool.query(
        `DELETE FROM harness_runtime.billing_compensations
         WHERE workspace_id=$1 AND task_id=$2`,
        [task.workspaceId, task.taskId],
      );
      await pool.end();
    }
  },
);

test(
  'terminal facts rebuild one missing owner for every reserved Harness usage',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const harness = new PostgresHarnessStore(pool);
    const submissions = new PostgresCreationSubmissionStore(pool, {
      async reserve() {},
    });
    const billing = new PostgresProductBillingRepository(pool);
    const compensations = new PostgresHarnessBillingCompensationStore(pool);
    const suffix = randomUUID();
    const workspaceId = `billing-orphan-${suffix}`;
    const cases = [
      { action: 'refund', fact: 'failure', forceCreditRefund: true, taskId: `failed-${suffix}` },
      { action: 'refund', fact: 'cancellation', forceCreditRefund: true, taskId: `cancelled-${suffix}` },
      { action: 'commit', fact: 'delivery', forceCreditRefund: false, taskId: `delivered-${suffix}` },
      {
        action: 'refund',
        fact: 'start_failure',
        forceCreditRefund: false,
        taskId: `start-failed-${suffix}`,
      },
    ] as const;

    try {
      await harness.applySchema();
      await submissions.applySchema();
      await billing.migrate();
      await compensations.migrate();
      const legacyConflictTaskId = `legacy-conflict-${suffix}`;
      await pool.query(
        `DROP INDEX IF EXISTS
           harness_runtime.harness_billing_compensations_task_settlement_idx`,
      );
      await pool.query(
        `INSERT INTO harness_runtime.billing_compensations
           (action, workspace_id, task_id, payload)
         VALUES
           ('commit',$1,$2,$3::jsonb),
           ('refund',$1,$2,$3::jsonb)`,
        [
          workspaceId,
          legacyConflictTaskId,
          JSON.stringify({
            workspaceId,
            taskId: legacyConflictTaskId,
            quoteId: `quote-${legacyConflictTaskId}`,
            quoteRevision: 'quote-revision-1',
          }),
        ],
      );
      await compensations.migrate();
      assert.equal(
        (
          await pool.query<{ count: number }>(
            `SELECT count(*)::int AS count
             FROM harness_runtime.billing_compensations
             WHERE workspace_id=$1 AND task_id=$2`,
            [workspaceId, legacyConflictTaskId],
          )
        ).rows[0]?.count,
        0,
      );
      assert.equal(
        (
          await pool.query<{ count: number }>(
            `SELECT count(*)::int AS count
             FROM harness_runtime.billing_compensation_conflicts
             WHERE workspace_id=$1 AND task_id=$2`,
            [workspaceId, legacyConflictTaskId],
          )
        ).rows[0]?.count,
        2,
      );
      for (const item of cases) {
        const runtimeId = harnessRuntimeId(workspaceId, item.taskId);
        const quoteId = `quote-${item.taskId}`;
        await pool.query(
          `INSERT INTO p1_product_billing_quotes
             (workspace_id, quote_id, task_id, lifecycle_status, payload)
           VALUES ($1,$2,$3,'reserved',$4::jsonb)`,
          [
            workspaceId,
            quoteId,
            item.taskId,
            JSON.stringify({
              workspaceId,
              quoteId,
              taskId: item.taskId,
              revision: 'quote-revision-1',
            }),
          ],
        );
        await pool.query(
          `INSERT INTO p1_product_billing_usage
             (workspace_id, usage_id, task_id, quote_id, status, payload)
           VALUES ($1,$2,$3,$4,'reserved',$5::jsonb)`,
          [
            workspaceId,
            `usage-${item.taskId}`,
            item.taskId,
            quoteId,
            JSON.stringify({
              id: `usage-${item.taskId}`,
              workspaceId,
              taskId: item.taskId,
              quoteId,
              status: 'reserved',
            }),
          ],
        );
        if (item.fact === 'start_failure') {
          await pool.query(
            `INSERT INTO execution_spine.creation_submissions
               (id, workspace_id, idempotency_key, payload_hash, submission,
                harness_state, task_id, created_at)
             VALUES ($1,$2,$3,$3,'{}'::jsonb,'failed',$4,clock_timestamp())`,
            [
              `submission-${item.taskId}`,
              workspaceId,
              `idempotency-${item.taskId}`,
              item.taskId,
            ],
          );
        } else {
          await pool.query(
            `INSERT INTO harness_runtime.task_requests
               (task_id, workflow_id, runtime_id, fingerprint, request)
             VALUES ($1,$2,$1,$3,$4::jsonb)`,
            [
              runtimeId,
              item.taskId,
              `fingerprint-${item.taskId}`,
              JSON.stringify({ workspaceId }),
            ],
          );
        }
        if (item.fact === 'cancellation') {
          await pool.query(
            `INSERT INTO harness_runtime.decision_events
               (id, task_id, question_id, workflow_revision, idempotency_key,
                payload_fingerprint, payload, resolution_source, resume_status)
             VALUES ($1,$2,'question-1',1,$3,$4,'{}'::jsonb,
                     'core_hold_expired','sent')`,
            [
              `decision-${item.taskId}`,
              runtimeId,
              `idempotency-${item.taskId}`,
              `payload-${item.taskId}`,
            ],
          );
        } else if (item.fact !== 'start_failure') {
          const trustedUsage =
            item.fact === 'delivery'
              ? {
                  kind: 'media_duration',
                  actualSeconds: 7,
                  evidenceRef: `owned-asset:${item.taskId}`,
                }
              : undefined;
          await pool.query(
            `INSERT INTO harness_runtime.audit_events
               (id, workflow_id, stage, event_type, payload, created_at)
             VALUES ($1,$2,'workflow',$3,$4::jsonb,
                     clock_timestamp() - interval '10 minutes')`,
            [
              `audit-${item.taskId}`,
              runtimeId,
              item.fact === 'failure' ? 'workflow_failed' : 'package_delivered',
              JSON.stringify(
                trustedUsage ? { billingTrustedUsage: trustedUsage } : {},
              ),
            ],
          );
        }
      }

      await pool.query(
        `UPDATE harness_runtime.audit_events
         SET created_at=clock_timestamp()
         WHERE id=$1`,
        [`audit-delivered-${suffix}`],
      );
      assert.equal(await compensations.recoverOrphans(20), 3);
      assert.equal(
        (
          await pool.query<{ count: number }>(
            `SELECT count(*)::int AS count
             FROM harness_runtime.billing_compensations
             WHERE workspace_id=$1 AND action='commit'`,
            [workspaceId],
          )
        ).rows[0]?.count,
        0,
      );
      await pool.query(
        `UPDATE harness_runtime.audit_events
         SET created_at=clock_timestamp() - interval '10 minutes'
         WHERE id=$1`,
        [`audit-delivered-${suffix}`],
      );
      assert.equal(await compensations.recoverOrphans(20), 1);
      assert.equal(await compensations.recoverOrphans(20), 0);
      const claimed = await compensations.claimBatch(20);
      assert.deepEqual(
        claimed
          .map(({ action, taskId }) => ({ action, taskId }))
          .sort((left, right) => left.taskId.localeCompare(right.taskId)),
        cases
          .map(({ action, taskId }) => ({ action, taskId }))
          .sort((left, right) => left.taskId.localeCompare(right.taskId)),
      );
      for (const item of cases) {
        assert.equal(
          claimed.find(({ taskId }) => taskId === item.taskId)
            ?.forceCreditRefund === true,
          item.forceCreditRefund,
        );
      }
      assert.deepEqual(
        claimed.find(({ action }) => action === 'commit')?.trustedUsage,
        {
          kind: 'media_duration',
          actualSeconds: 7,
          evidenceRef: `owned-asset:delivered-${suffix}`,
        },
      );
      await assert.rejects(
        compensations.enqueue({
          action: 'refund',
          attempts: 0,
          workspaceId,
          taskId: `delivered-${suffix}`,
          quoteId: `quote-delivered-${suffix}`,
          quoteRevision: 'quote-revision-1',
        }),
        /opposite action/u,
      );
      assert.deepEqual(
        (
          await pool.query<{ action: string }>(
            `SELECT action
             FROM harness_runtime.billing_compensations
             WHERE workspace_id=$1 AND task_id=$2`,
            [workspaceId, `delivered-${suffix}`],
          )
        ).rows,
        [{ action: 'commit' }],
      );
    } finally {
      await pool.query(
        `DELETE FROM harness_runtime.billing_compensations
         WHERE workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `DELETE FROM harness_runtime.billing_compensation_conflicts
         WHERE workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `DELETE FROM harness_runtime.decision_events
         WHERE task_id IN (
           SELECT runtime_id FROM harness_runtime.task_requests
           WHERE request->>'workspaceId'=$1
         )`,
        [workspaceId],
      );
      await pool.query(
        `DELETE FROM harness_runtime.audit_events
         WHERE workflow_id IN (
           SELECT runtime_id FROM harness_runtime.task_requests
           WHERE request->>'workspaceId'=$1
         )`,
        [workspaceId],
      );
      await pool.query(
        `DELETE FROM harness_runtime.task_requests
         WHERE request->>'workspaceId'=$1`,
        [workspaceId],
      );
      await pool.query(
        `DELETE FROM execution_spine.creation_submissions
         WHERE workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_product_billing_usage WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_product_billing_quotes WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.end();
    }
  },
);
