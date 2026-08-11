import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import { PostgresCreationSubmissionStore } from '../execution-spine/postgres-creation-submission-store.js';
import { settlementIdempotencyKey } from '../execution-spine/billing-identity.js';
import { PostgresHarnessBillingCompensationStore } from './postgres-billing-compensation-store.js';
import { PostgresHarnessCarrierSettlementCoordinator } from './postgres-carrier-settlement-coordinator.js';
import { PostgresHarnessStore } from './postgres-store.js';
import { harnessRuntimeId } from './workspace-scope.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'carrier receipts wait for the frozen package set before producing one work settlement',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const coordinator = new PostgresHarnessCarrierSettlementCoordinator(pool);
    const suffix = randomUUID();
    const workspaceId = `carrier-aggregate-${suffix}`;
    const billingTaskId = `task-${suffix}`;
    const base = {
      workspaceId,
      taskId: billingTaskId,
      workId: `work-${suffix}`,
      quoteRef: { id: `quote-${suffix}`, revision: 'quote-revision-1' },
      reservationId: `consume:task:${billingTaskId}`,
      carrierUnitIds: ['copy', 'note'],
    };
    const packageBilling = {
      contractHash: `package-contract-${suffix}`,
      allocations: [
        {
          allocationId: 'copy-output',
          carrierUnitId: 'copy',
          carrier: 'copy' as const,
          deliveryUnits: 1,
          creditCost: 1,
          failureRefundsCredits: true,
          operation: 'copy.generate',
          catalogModel: { id: 'copy-model', revision: 'copy-r1' },
          routeSnapshotRef: 'route-copy-r1',
          rightsRevisionRefs: ['rights-copy-r1'],
        },
        {
          allocationId: 'note-pages',
          carrierUnitId: 'note',
          carrier: 'note' as const,
          deliveryUnits: 2,
          creditCost: 2,
          failureRefundsCredits: true,
          operation: 'note.generate',
          catalogModel: { id: 'note-model', revision: 'note-r1' },
          routeSnapshotRef: 'route-note-r1',
          rightsRevisionRefs: ['rights-note-r1'],
        },
      ],
    };
    const note = {
      workspaceId,
      taskId: `${billingTaskId}:carrier-note`,
      billingTaskId,
      billingIdentity: {
        ...base,
        workflowId: `${billingTaskId}:carrier-note`,
        carrierUnitId: 'note',
        carrierBillableUnits: 2,
        packageBilling,
      },
      quoteId: base.quoteRef.id,
      quoteRevision: base.quoteRef.revision,
      partialDelivery: { totalUnits: 2, deliveredUnits: 1 },
    };
    const copy = {
      ...note,
      taskId: `${billingTaskId}:carrier-copy`,
      billingIdentity: {
        ...base,
        workflowId: `${billingTaskId}:carrier-copy`,
        carrierUnitId: 'copy',
        carrierBillableUnits: 1,
        packageBilling,
      },
      partialDelivery: undefined,
    };
    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS harness_runtime');
      await coordinator.migrate();
      assert.equal(
        await coordinator.recordCarrierTerminal({ action: 'commit', settlement: note }),
        null,
      );
      const ready = await coordinator.recordCarrierTerminal({
        action: 'refund',
        settlement: copy,
      });
      assert.equal(ready?.action, 'commit');
      assert.equal(ready?.settlement.partialDelivery, undefined);
      assert.deepEqual(ready?.settlement.packagePartialDelivery, {
        allocations: [
          { allocationId: 'copy-output', deliveredUnits: 0 },
          { allocationId: 'note-pages', deliveredUnits: 1 },
        ],
      });
      await coordinator.markWorkSettled(ready!.aggregateKey);
      assert.equal(
        await coordinator.recordCarrierTerminal({ action: 'commit', settlement: note }),
        null,
      );
      const rows = await pool.query<{ status: string; receipts: number }>(
        `SELECT settlements.status, count(receipts.*)::int AS receipts
           FROM harness_runtime.billing_work_settlements settlements
           LEFT JOIN harness_runtime.billing_carrier_receipts receipts
             ON receipts.workspace_id=settlements.workspace_id
            AND receipts.aggregate_key=settlements.aggregate_key
          WHERE settlements.workspace_id=$1
          GROUP BY settlements.status`,
        [workspaceId],
      );
      assert.deepEqual(rows.rows, [{ status: 'settled', receipts: 2 }]);
    } finally {
      await pool.query(
        'DELETE FROM harness_runtime.billing_carrier_receipts WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.billing_work_settlements WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.end();
    }
  },
);

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
      taskId: `task-${suffix}:plan-r2`,
      billingTaskId: `task-${suffix}`,
      billingIdentity: identity(`forced-refund-${suffix}`, `task-${suffix}`, `task-${suffix}:plan-r2`, `quote-${suffix}`),
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
      assert.equal(claimed?.taskId, task.taskId);
      assert.equal(claimed?.billingTaskId, task.billingTaskId);
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
  'compensation queue rejects caller identity and credit-operation mismatches before persistence',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const compensations = new PostgresHarnessBillingCompensationStore(pool);
    const suffix = randomUUID();
    const workspaceId = `billing-enqueue-fence-${suffix}`;
    const billingTaskId = `task-${suffix}`;
    const taskId = `${billingTaskId}:plan-r1`;
    const task = {
      action: 'refund' as const,
      attempts: 0,
      workspaceId,
      taskId,
      billingTaskId,
      billingIdentity: identity(workspaceId, billingTaskId, taskId, `quote-${suffix}`),
      quoteId: `quote-${suffix}`,
      quoteRevision: 'quote-revision-1',
    };
    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS harness_runtime');
      await compensations.migrate();
      await assert.rejects(
        compensations.enqueue({ ...task, taskId: `${taskId}:caller-bypass` }),
        /frozen identity/u,
      );
      await assert.rejects(
        compensations.enqueue({
          ...task,
          creditUsageOperationId: 'caller-op-bypass',
        }),
        /credit usage operation/u,
      );
      const rows = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM harness_runtime.billing_compensations
          WHERE workspace_id=$1`,
        [workspaceId],
      );
      assert.equal(rows.rows[0]?.count, 0);
    } finally {
      await pool.query(
        'DELETE FROM harness_runtime.billing_compensations WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.billing_compensation_conflicts WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.end();
    }
  },
);


test(
  'opposite compensation actions cannot bypass the billing-identity fence via different plan workflow ids',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const compensations = new PostgresHarnessBillingCompensationStore(pool);
    const suffix = randomUUID();
    const workspaceId = `billing-fence-${suffix}`;
    const billingTaskId = `task-billing-${suffix}`;
    const refund = {
      action: 'refund' as const,
      attempts: 0,
      workspaceId,
      taskId: `${billingTaskId}:plan-r1`,
      billingTaskId,
      billingIdentity: identity(workspaceId, billingTaskId, `${billingTaskId}:plan-r1`, `quote-${suffix}`),
      quoteId: `quote-${suffix}`,
      quoteRevision: 'quote-revision-1',
      forceCreditRefund: true,
    };
    const commit = {
      action: 'commit' as const,
      attempts: 0,
      workspaceId,
      taskId: `${billingTaskId}:plan-r2`,
      billingTaskId,
      billingIdentity: identity(workspaceId, billingTaskId, `${billingTaskId}:plan-r2`, `quote-${suffix}`),
      quoteId: `quote-${suffix}`,
      quoteRevision: 'quote-revision-1',
    };
    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS harness_runtime');
      await compensations.migrate();
      await compensations.enqueue(refund);
      await assert.rejects(
        compensations.enqueue(commit),
        /opposite action/u,
      );
      const rows = await pool.query<{ action: string; task_id: string }>(
        `SELECT action, task_id
           FROM harness_runtime.billing_compensations
          WHERE workspace_id=$1
          ORDER BY task_id`,
        [workspaceId],
      );
      assert.deepEqual(rows.rows, [
        { action: 'refund', task_id: refund.taskId },
      ]);
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
      await pool.end();
    }
  },
);

test(
  'different frozen carrier units of one billing task retain independent queue ownership',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const compensations = new PostgresHarnessBillingCompensationStore(pool);
    const suffix = randomUUID();
    const workspaceId = `carrier-unit-${suffix}`;
    const billingTaskId = `task-${suffix}`;
    const baseIdentity = {
      workspaceId,
      taskId: billingTaskId,
      workId: `work-${suffix}`,
      quoteRef: { id: `quote-${suffix}`, revision: 'quote-revision-1' },
      reservationId: `consume:task:${billingTaskId}`,
      carrierUnitIds: ['copy', 'note'],
    };
    const note = {
      action: 'commit' as const,
      attempts: 0,
      workspaceId,
      taskId: `${billingTaskId}:carrier-note`,
      billingTaskId,
      billingIdentity: {
        ...baseIdentity,
        workflowId: `${billingTaskId}:carrier-note`,
        carrierUnitId: 'note',
        carrierBillableUnits: 1,
      },
      quoteId: baseIdentity.quoteRef.id,
      quoteRevision: baseIdentity.quoteRef.revision,
    };
    const copy = {
      ...note,
      action: 'refund' as const,
      taskId: `${billingTaskId}:carrier-copy`,
      billingIdentity: {
        ...baseIdentity,
        workflowId: `${billingTaskId}:carrier-copy`,
        carrierUnitId: 'copy',
        carrierBillableUnits: 1,
      },
    };
    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS harness_runtime');
      await compensations.migrate();
      await compensations.enqueue(note);
      await compensations.enqueue(copy);
      const claimed = await compensations.claimBatch(10);
      assert.deepEqual(
        claimed.map((item) => item.taskId).sort(),
        [note.taskId, copy.taskId].sort(),
      );
      await Promise.all(claimed.map((item) => compensations.markCompleted(item)));
      const rows = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM harness_runtime.billing_compensations
          WHERE workspace_id=$1 AND status='completed'`,
        [workspaceId],
      );
      assert.equal(rows.rows[0]?.count, 2);
    } finally {
      await pool.query(
        'DELETE FROM harness_runtime.billing_compensations WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.billing_compensation_conflicts WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'migration archives a legacy compensation whose payload disagrees with its frozen identity',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const compensations = new PostgresHarnessBillingCompensationStore(pool);
    const suffix = randomUUID();
    const workspaceId = `billing-invalid-legacy-${suffix}`;
    const taskId = `task-${suffix}:carrier-note`;
    const billingTaskId = `task-${suffix}`;
    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS harness_runtime');
      await compensations.migrate();
      await pool.query(
        `ALTER TABLE harness_runtime.billing_compensations
           ALTER COLUMN settlement_idempotency_key DROP NOT NULL`,
      );
      await pool.query(
        `INSERT INTO harness_runtime.billing_compensations
           (action, workspace_id, task_id, billing_task_id, payload)
         VALUES ('commit',$1,$2,$3,$4::jsonb)`,
        [
          workspaceId,
          taskId,
          billingTaskId,
          JSON.stringify({
            workspaceId,
            taskId,
            billingTaskId,
            quoteId: `quote-${suffix}-payload`,
            quoteRevision: 'quote-revision-1',
            billingIdentity: {
              workspaceId,
              taskId: billingTaskId,
              workId: `work-${suffix}`,
              workflowId: taskId,
              quoteRef: {
                id: `quote-${suffix}-identity`,
                revision: 'quote-revision-1',
              },
              reservationId: `consume:task:${billingTaskId}`,
              carrierUnitId: 'note',
              carrierUnitIds: ['copy'],
              carrierBillableUnits: 1,
            },
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
            [workspaceId, taskId],
          )
        ).rows[0]?.count,
        0,
      );
      assert.deepEqual(
        (
          await pool.query<{ archive_reason: string }>(
            `SELECT archive_reason
               FROM harness_runtime.billing_compensation_conflicts
              WHERE workspace_id=$1 AND task_id=$2`,
            [workspaceId, taskId],
          )
        ).rows,
        [{ archive_reason: 'legacy_missing_frozen_billing_identity' }],
      );
    } finally {
      await pool.query(
        'DELETE FROM harness_runtime.billing_compensations WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.billing_compensation_conflicts WHERE workspace_id=$1',
        [workspaceId],
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
        `ALTER TABLE harness_runtime.billing_compensations
           ALTER COLUMN settlement_idempotency_key DROP NOT NULL`,
      );
      // Simulate a pre-fence dual-owner row pair on the same billing identity.
      // billing_task_id is required after migration; the unique settlement
      // index is dropped so opposite actions can coexist until re-migrate.
      await pool.query(
        `INSERT INTO harness_runtime.billing_compensations
           (action, workspace_id, task_id, billing_task_id, payload)
         VALUES
           ('commit',$1,$2,$2,$3::jsonb),
           ('refund',$1,$2,$2,$3::jsonb)`,
        [
          workspaceId,
          legacyConflictTaskId,
          JSON.stringify({
            workspaceId,
            taskId: legacyConflictTaskId,
            billingTaskId: legacyConflictTaskId,
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
        }
        const billingIdentity = identity(
          workspaceId,
          item.taskId,
          item.taskId,
          quoteId,
        );
        await pool.query(
          `INSERT INTO harness_runtime.task_requests
             (task_id, workflow_id, runtime_id, fingerprint, request,
              billing_identity, admission_state)
           VALUES ($1,$2,$1,$3,$4::jsonb,$5::jsonb,'awaiting_confirmation')`,
          [
            runtimeId,
            item.taskId,
            `fingerprint-${item.taskId}`,
            JSON.stringify({ workspaceId, billingIdentity }),
            JSON.stringify(billingIdentity),
          ],
        );
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
      const deliveredIdentity = identity(
        workspaceId,
        `delivered-${suffix}`,
        `delivered-${suffix}`,
        `quote-delivered-${suffix}`,
      );
      const recoveredKey = await pool.query<{ settlement_idempotency_key: string }>(
        `SELECT settlement_idempotency_key
           FROM harness_runtime.billing_compensations
          WHERE workspace_id=$1 AND task_id=$2`,
        [workspaceId, `delivered-${suffix}`],
      );
      assert.equal(
        recoveredKey.rows[0]?.settlement_idempotency_key,
        settlementIdempotencyKey(deliveredIdentity),
      );
      await assert.rejects(
        compensations.enqueue({
          action: 'refund',
          attempts: 0,
          workspaceId,
          taskId: `delivered-${suffix}`,
          billingTaskId: `delivered-${suffix}`,
          billingIdentity: deliveredIdentity,
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

test(
  'orphan recovery keeps package carrier idempotency keys identical to direct settlement',
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
    const workspaceId = `billing-package-orphan-${suffix}`;
    const billingTaskId = `task-${suffix}`;
    const workflowId = `${billingTaskId}:carrier-note`;
    const quoteId = `quote-${suffix}`;
    const usageId = `usage-${suffix}`;
    const packageBilling = {
      contractHash: `package-contract-${suffix}`,
      allocations: [
        {
          allocationId: 'copy-output',
          carrierUnitId: 'copy',
          carrier: 'copy' as const,
          deliveryUnits: 1,
          creditCost: 3,
          failureRefundsCredits: true,
          operation: 'copy.generate',
          catalogModel: { id: 'copy-model', revision: 'copy-r1' },
          routeSnapshotRef: 'route-copy-r1',
          rightsRevisionRefs: ['rights-copy-r1'],
        },
        {
          allocationId: 'note-pages',
          carrierUnitId: 'note',
          carrier: 'note' as const,
          deliveryUnits: 2,
          creditCost: 6,
          failureRefundsCredits: true,
          operation: 'note.generate',
          catalogModel: { id: 'note-model', revision: 'note-r1' },
          routeSnapshotRef: 'route-note-r1',
          rightsRevisionRefs: ['rights-note-r1'],
        },
      ],
    };
    const billingIdentity = {
      workspaceId,
      taskId: billingTaskId,
      workId: `work-${suffix}`,
      workflowId,
      quoteRef: { id: quoteId, revision: 'quote-revision-1' },
      reservationId: `consume:task:${billingTaskId}`,
      carrierUnitId: 'note',
      carrierUnitIds: ['copy', 'note'],
      carrierBillableUnits: 2,
      packageBilling,
    };
    try {
      await harness.applySchema();
      await submissions.applySchema();
      await billing.migrate();
      await compensations.migrate();
      await pool.query(
        `INSERT INTO p1_product_billing_quotes
           (workspace_id, quote_id, task_id, lifecycle_status, payload)
         VALUES ($1,$2,$3,'reserved',$4::jsonb)`,
        [
          workspaceId,
          quoteId,
          billingTaskId,
          JSON.stringify({
            workspaceId,
            quoteId,
            taskId: billingTaskId,
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
          usageId,
          billingTaskId,
          quoteId,
          JSON.stringify({
            id: usageId,
            workspaceId,
            taskId: billingTaskId,
            quoteId,
            status: 'reserved',
          }),
        ],
      );
      await pool.query(
        `INSERT INTO execution_spine.creation_submissions
           (id, workspace_id, idempotency_key, payload_hash, submission,
            harness_state, task_id, created_at)
         VALUES ($1,$2,$3,$3,'{}'::jsonb,'failed',$4,clock_timestamp())`,
        [
          `submission-${suffix}`,
          workspaceId,
          `idempotency-${suffix}`,
          billingTaskId,
        ],
      );
      const runtimeId = harnessRuntimeId(workspaceId, workflowId);
      await pool.query(
        `INSERT INTO harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request,
            billing_identity, admission_state)
         VALUES ($1,$2,$1,$3,$4::jsonb,$5::jsonb,'admitted')`,
        [
          runtimeId,
          workflowId,
          `fingerprint-${suffix}`,
          JSON.stringify({
            workspaceId,
            usageReservation: { id: usageId },
            billingIdentity,
          }),
          JSON.stringify(billingIdentity),
        ],
      );

      assert.equal(await compensations.recoverOrphans(10), 1);
      const [claimed] = await compensations.claimBatch(10);
      assert.ok(claimed);
      assert.equal(
        claimed.settlementIdempotencyKey,
        settlementIdempotencyKey(billingIdentity),
      );
      await compensations.markCompleted(claimed);
      const status = await pool.query<{ status: string }>(
        `SELECT status
           FROM harness_runtime.billing_compensations
          WHERE workspace_id=$1 AND task_id=$2`,
        [workspaceId, workflowId],
      );
      assert.deepEqual(status.rows, [{ status: 'completed' }]);
    } finally {
      await pool.query(
        'DELETE FROM harness_runtime.billing_compensations WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.billing_compensation_conflicts WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.task_requests WHERE request->>\'workspaceId\'=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM execution_spine.creation_submissions WHERE workspace_id=$1',
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

function identity(
  workspaceId: string,
  taskId: string,
  workflowId: string,
  quoteId: string,
) {
  return {
    workspaceId,
    taskId,
    workId: `work-${taskId}`,
    workflowId,
    quoteRef: { id: quoteId, revision: 'quote-revision-1' },
    reservationId: `consume:task:${taskId}`,
    carrierUnitId: 'single',
    carrierUnitIds: ['single'],
    carrierBillableUnits: 1,
  };
}
