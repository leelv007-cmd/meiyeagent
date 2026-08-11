import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { MemoryObservabilityEventAudit } from '../creation-experience/observability-events.js';
import { creditUsageOperationId } from '../credit-billing/credit-ledger.js';
import { PostgresCreditLedger } from '../credit-billing/postgres-credit-ledger.js';
import { DurableProductBillingService } from '../product-billing/durable-service.js';
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import { HarnessProductBillingSettlementExecutor } from './product-billing-settlement.js';
import { PostgresHarnessResumeReconcilerStore } from './postgres-resume-reconciler-store.js';
import { PostgresHarnessStore } from './postgres-store.js';
import { billingIdentityReservationFingerprint } from '../execution-spine/billing-identity.js';
import {
  HarnessReservationSweeper,
  MAX_RESERVATION_SWEEP_ATTEMPTS,
} from './reservation-sweeper.js';
import { harnessRuntimeId } from './workspace-scope.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres reservation sweep backfills only legacy rows that already contain a frozen identity',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const billing = new PostgresProductBillingRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-sweep-migration-${suffix}`;
    const workflowTaskId = `source-sweep-migration-${suffix}:plan-r2`;
    const billingTaskId = `source-sweep-migration-${suffix}`;
    const runtimeId = `runtime-sweep-migration-${suffix}`;
    const orphanWorkspaceId = `workspace-sweep-migration-orphan-${suffix}`;
    const orphanTaskId = `legacy-sweep-migration-${suffix}`;
    const orphanRuntimeId = `legacy-runtime-migration-${suffix}`;
    const unresolvedWorkspaceId =
      `workspace-sweep-migration-unresolved-${suffix}`;
    const unresolvedTaskId = `missing-source-${suffix}:plan-r3`;
    const unresolvedRuntimeId = `missing-runtime-migration-${suffix}`;
    const workspaceIds = [
      workspaceId,
      orphanWorkspaceId,
      unresolvedWorkspaceId,
    ];

    try {
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
        -- Rebuild the pre-billing-identity shape so migration can be proven on a
        -- shared TEST_DATABASE_URL that may already carry the new constraint.
        drop table if exists harness_runtime.reservation_sweeps;
        create table harness_runtime.reservation_sweeps (
          workspace_id text not null,
          task_id text not null,
          runtime_id text not null,
          question_id text not null,
          quote_id text not null,
          quote_revision text not null,
          usage_reservation_id text not null,
          reserved_units jsonb not null,
          held_since timestamptz not null,
          reason text not null,
          status text not null,
          attempts integer not null default 1,
          next_attempt_at timestamptz not null default now(),
          last_error text,
          completed_at timestamptz,
          dead_lettered_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          primary key (workspace_id, task_id)
        )
      `);
      await billing.migrate();
      for (const row of [
        {
          workspaceId,
          taskId: billingTaskId,
          quoteId: `quote-${billingTaskId}`,
          usageId: `usage-${billingTaskId}`,
        },
        {
          workspaceId: orphanWorkspaceId,
          taskId: orphanTaskId,
          quoteId: `quote-${orphanTaskId}`,
          usageId: `usage-${orphanTaskId}`,
        },
      ]) {
        await pool.query(
          `insert into p1_product_billing_quotes
             (workspace_id, quote_id, task_id, lifecycle_status, payload)
           values ($1,$2,$3,'reserved',$4::jsonb)`,
          [
            row.workspaceId,
            row.quoteId,
            row.taskId,
            JSON.stringify({
              workspaceId: row.workspaceId,
              quoteId: row.quoteId,
              taskId: row.taskId,
              revision: 'quote-r1',
              lifecycleStatus: 'reserved',
            }),
          ],
        );
        await pool.query(
          `insert into p1_product_billing_usage
             (workspace_id, usage_id, task_id, quote_id, status, payload)
           values ($1,$2,$3,$4,'reserved',$5::jsonb)`,
          [
            row.workspaceId,
            row.usageId,
            row.taskId,
            row.quoteId,
            JSON.stringify({
              id: row.usageId,
              workspaceId: row.workspaceId,
              taskId: row.taskId,
              quoteId: row.quoteId,
              status: 'reserved',
            }),
          ],
        );
      }
      await pool.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request)
         values ($1,$2,$3,$4,$5::jsonb)`,
        [
          runtimeId,
          workflowTaskId,
          runtimeId,
          `fingerprint-${workflowTaskId}`,
          JSON.stringify({
            workspaceId,
            billingTaskId,
            carrierUnitId: 'single',
            carrierUnitIds: ['single'],
            carrierBillableUnits: 1,
            usageReservation: {
              id: `usage-${billingTaskId}`,
              creditUsageOperationId: `consume:task:${billingTaskId}`,
            },
            executionSnapshot: {
              work: { id: `work-${billingTaskId}` },
              quote: {
                id: `quote-${billingTaskId}`,
                revision: 'quote-r1',
              },
            },
            pendingExecutionPlanSnapshot: {
              snapshotHash: `snapshot-${workflowTaskId}`,
              content: {
                planId: `plan-${billingTaskId}`,
                planRevision: 1,
                quoteRef: {
                  id: `quote-${billingTaskId}`,
                  revision: 'quote-r1',
                },
              },
            },
            executionConfirmationRequestId: `confirmation-${workflowTaskId}`,
            billingIdentity: {
              workspaceId,
              taskId: billingTaskId,
              workId: `work-${billingTaskId}`,
              workflowId: workflowTaskId,
              quoteRef: {
                id: `quote-${billingTaskId}`,
                revision: 'quote-r1',
              },
              creditUsageOperationId: `consume:task:${billingTaskId}`,
              productUsageReservationId: `usage-${billingTaskId}`,
              reservationId: billingIdentityReservationFingerprint({
                creditUsageOperationId: `consume:task:${billingTaskId}`,
                productUsageReservationId: `usage-${billingTaskId}`,
              }),
              carrierUnitId: 'single',
              carrierUnitIds: ['single'],
              carrierBillableUnits: 1,
              planId: `plan-${billingTaskId}`,
              planRevision: 1,
              snapshotHash: `snapshot-${workflowTaskId}`,
            },
          }),
        ],
      );
      for (const row of [
        {
          workspaceId,
          taskId: workflowTaskId,
          runtimeId,
          quoteId: `quote-${billingTaskId}`,
          usageId: `usage-${billingTaskId}`,
        },
        {
          workspaceId: orphanWorkspaceId,
          taskId: orphanTaskId,
          runtimeId: orphanRuntimeId,
          quoteId: `quote-${orphanTaskId}`,
          usageId: `usage-${orphanTaskId}`,
        },
        {
          workspaceId: unresolvedWorkspaceId,
          taskId: unresolvedTaskId,
          runtimeId: unresolvedRuntimeId,
          quoteId: `quote-${unresolvedTaskId}`,
          usageId: `usage-${unresolvedTaskId}`,
        },
      ]) {
        await pool.query(
          `insert into harness_runtime.reservation_sweeps
             (workspace_id, task_id, runtime_id, question_id, quote_id,
              quote_revision, usage_reservation_id, reserved_units,
              held_since, reason, status)
           values ($1,$2,$3,$4,$5,'quote-r1',$6,'[]'::jsonb,
                   '2026-07-25T00:00:00.000Z',
                   'hold_reservation_ttl_elapsed','processing')`,
          [
            row.workspaceId,
            row.taskId,
            row.runtimeId,
            `question-${row.taskId}`,
            row.quoteId,
            row.usageId,
          ],
        );
      }

      await store.applySchema();

      const rows = await pool.query<{
        billing_task_id: string | null;
        last_error: string | null;
        status: string;
        task_id: string;
      }>(
        `select task_id, billing_task_id, status, last_error
           from harness_runtime.reservation_sweeps
          where workspace_id=any($1::text[])`,
        [workspaceIds],
      );
      const migrated = new Map(rows.rows.map((row) => [row.task_id, row]));
      assert.deepEqual(migrated.get(workflowTaskId), {
        task_id: workflowTaskId,
        billing_task_id: billingTaskId,
        last_error: null,
        status: 'processing',
      });
      assert.deepEqual(migrated.get(orphanTaskId), {
        task_id: orphanTaskId,
        billing_task_id: null,
        last_error: 'Reservation sweep billing identity could not be migrated.',
        status: 'dead_letter',
      });
      assert.deepEqual(migrated.get(unresolvedTaskId), {
        task_id: unresolvedTaskId,
        billing_task_id: null,
        last_error: 'Reservation sweep billing identity could not be migrated.',
        status: 'dead_letter',
      });
    } finally {
      await pool.query(
        `delete from harness_runtime.reservation_sweeps
          where workspace_id=any($1::text[])`,
        [workspaceIds],
      );
      await pool.query(
        `delete from harness_runtime.task_requests where runtime_id=$1`,
        [runtimeId],
      );
      await pool.query(
        `delete from p1_product_billing_usage
          where workspace_id=any($1::text[])`,
        [workspaceIds],
      );
      await pool.query(
        `delete from p1_product_billing_quotes
          where workspace_id=any($1::text[])`,
        [workspaceIds],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres reservation sweep selects only expired holds and recovers the post-refund crash window',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-sweep-${suffix}`;
    const expiredTaskId = `expired-hold-${suffix}`;
    const currentTaskId = `current-hold-${suffix}`;
    const continueTaskId = `continue-${suffix}`;
    const scopedTaskId = `scoped-${suffix}`;
    const scopedOtherTaskId = `scoped-other-${suffix}`;
    const taskIds = [
      expiredTaskId,
      currentTaskId,
      continueTaskId,
      scopedTaskId,
      scopedOtherTaskId,
    ];
    const runtimeIds = taskIds.map((taskId) =>
      harnessRuntimeId(workspaceId, taskId),
    );

    try {
      await store.applySchema();
      await new PostgresProductBillingRepository(pool).migrate();
      await Promise.all(
        taskIds.map((taskId, index) =>
          seedReservation(pool, {
            workspaceId,
            taskId,
            runtimeId: runtimeIds[index]!,
            unattended: taskId === continueTaskId ? 'continue' : 'hold',
            heldSince:
              taskId === currentTaskId
                ? '2026-07-27T12:00:00.000Z'
                : taskId === scopedTaskId || taskId === scopedOtherTaskId
                  ? '2026-07-27T13:00:00.000Z'
                : '2026-07-25T00:00:00.000Z',
          }),
        ),
      );

      const exactClaim = await store.claimBatch({
        expiresBefore: '2026-07-28T00:00:00.000Z',
        limit: 20,
        taskId: scopedTaskId,
        workspaceId,
      });
      assert.deepEqual(
        exactClaim.map(({ taskId }) => taskId),
        [scopedTaskId],
      );
      await store.markFailed(exactClaim[0]!, 'scoped claim proof', 'refund');

      const claimed = await store.claimBatch({
        expiresBefore: '2026-07-26T00:00:00.000Z',
        limit: 20,
      });

      assert.deepEqual(
        claimed.map(({ attempts, taskId }) => ({ attempts, taskId })),
        [{ attempts: 1, taskId: expiredTaskId }],
      );
      assert.deepEqual(claimed[0]?.reservedUnits, [
        { resource: 'image', quantity: 2 },
      ]);

      await pool.query(
        `update p1_product_billing_usage
            set status='refunded',
                payload=jsonb_set(payload, '{status}', '"refunded"')
          where workspace_id=$1 and task_id=$2`,
        [workspaceId, expiredTaskId],
      );
      await pool.query(
        `update p1_product_billing_quotes
            set lifecycle_status='refunded',
                payload=jsonb_set(payload, '{lifecycleStatus}', '"refunded"')
          where workspace_id=$1 and task_id=$2`,
        [workspaceId, expiredTaskId],
      );
      await store.markFailed(
        claimed[0]!,
        'grant-lot refund failed after ProductUsage changed',
        'refund',
      );
      const partialRefundFence = await pool.query<{ status: string }>(
        `select status
           from harness_runtime.reservation_sweeps
          where workspace_id=$1 and task_id=$2`,
        [workspaceId, expiredTaskId],
      );
      assert.equal(partialRefundFence.rows[0]?.status, 'processing');
      assert.equal(
        (await store.readDecisionTarget(workspaceId, expiredTaskId))
          ?.reservationReleased,
        true,
      );
      await pool.query(
        `update harness_runtime.reservation_sweeps
            set updated_at=now() - interval '2 minutes'
          where workspace_id=$1 and task_id=$2`,
        [workspaceId, expiredTaskId],
      );

      const replay = await store.claimBatch({
        expiresBefore: '2026-07-26T00:00:00.000Z',
        limit: 20,
      });
      assert.deepEqual(
        replay.map(({ attempts, taskId }) => ({ attempts, taskId })),
        [{ attempts: 2, taskId: expiredTaskId }],
      );

      await store.markCompleted(replay[0]!);
      assert.equal(
        (await store.readDecisionTarget(workspaceId, expiredTaskId))
          ?.reservationReleased,
        true,
      );
      const persisted = await pool.query<{
        audit_payload: {
          attempts: number;
          holdStillPending: boolean;
          reason: string;
        };
        outbox_status: string;
        question_status: string;
        sweep_status: string;
      }>(
        `select sweeps.status as sweep_status,
                questions.status as question_status,
                audit.payload as audit_payload,
                outbox.status as outbox_status
           from harness_runtime.reservation_sweeps sweeps
           join harness_runtime.pending_questions questions
             on questions.task_id=sweeps.runtime_id
           join harness_runtime.audit_events audit
             on audit.workflow_id=sweeps.runtime_id
            and audit.event_type='product_usage_reservation_released'
           join harness_runtime.langfuse_outbox outbox
             on outbox.audit_id=audit.id
          where sweeps.workspace_id=$1 and sweeps.task_id=$2`,
        [workspaceId, expiredTaskId],
      );
      assert.deepEqual(persisted.rows[0], {
        audit_payload: {
          attempts: 2,
          heldSince: '2026-07-25T00:00:00.000Z',
          holdStillPending: true,
          questionId: `question-${expiredTaskId}`,
          quoteId: `quote-${expiredTaskId}`,
          reason: 'hold_reservation_ttl_elapsed',
          reservedUnits: [{ resource: 'image', quantity: 2 }],
          usageReservationId: `usage-${expiredTaskId}`,
        },
        outbox_status: 'queued',
        question_status: 'pending',
        sweep_status: 'completed',
      });
      const operationsAudit = await pool.query<{ payload: unknown }>(
        `select payload
           from p1_operations_audit_events
          where workspace_id=$1 and id=$2`,
        [workspaceId, `product_usage.reservation_released:${expiredTaskId}`],
      );
      assert.deepEqual(operationsAudit.rows[0]?.payload, {
        action: 'product_usage.reservation_released',
        actorId: 'reservation-sweeper',
        correlationId: `reservation-sweep:${expiredTaskId}`,
        createdAt: (operationsAudit.rows[0]?.payload as { createdAt: string })
          .createdAt,
        details: {
          attempts: 2,
          heldSince: '2026-07-25T00:00:00.000Z',
          holdStillPending: true,
          questionId: `question-${expiredTaskId}`,
          quoteId: `quote-${expiredTaskId}`,
          reason: 'hold_reservation_ttl_elapsed',
          reservedUnits: [{ resource: 'image', quantity: 2 }],
          usageReservationId: `usage-${expiredTaskId}`,
        },
        entityId: expiredTaskId,
        entityType: 'product_usage_reservation',
        id: `product_usage.reservation_released:${expiredTaskId}`,
        workspaceId,
      });

      await pool.query(
        `update harness_runtime.pending_questions
            set updated_at='2026-07-25T00:00:00.000Z'
          where task_id=$1`,
        [runtimeIds[1]],
      );
      const failedRefund = await store.claimBatch({
        expiresBefore: '2026-07-26T00:00:00.000Z',
        limit: 20,
      });
      assert.deepEqual(
        failedRefund.map(({ taskId }) => taskId),
        [currentTaskId],
      );
      await store.markFailed(
        failedRefund[0]!,
        'billing is temporarily unavailable',
        'refund',
      );
      const firstBackoff = await pool.query<{
        next_attempt_at: Date;
        status: string;
      }>(
        `select status, next_attempt_at
           from harness_runtime.reservation_sweeps
          where workspace_id=$1 and task_id=$2`,
        [workspaceId, currentTaskId],
      );
      assert.equal(firstBackoff.rows[0]?.status, 'failed');
      assert.ok(
        (firstBackoff.rows[0]?.next_attempt_at.getTime() ?? 0) - Date.now() >
          50_000,
      );

      for (
        let expectedAttempt = 2;
        expectedAttempt <= MAX_RESERVATION_SWEEP_ATTEMPTS;
        expectedAttempt += 1
      ) {
        await pool.query(
          `update harness_runtime.reservation_sweeps
              set next_attempt_at=now() - interval '1 second'
            where workspace_id=$1 and task_id=$2`,
          [workspaceId, currentTaskId],
        );
        const retry = await store.claimBatch({
          expiresBefore: '2026-07-26T00:00:00.000Z',
          limit: 20,
        });
        assert.equal(retry[0]?.attempts, expectedAttempt);
        await store.markFailed(
          retry[0]!,
          'billing is still unavailable',
          'refund',
        );
        if (expectedAttempt === 2) {
          const secondBackoff = await pool.query<{ next_attempt_at: Date }>(
            `select next_attempt_at
               from harness_runtime.reservation_sweeps
              where workspace_id=$1 and task_id=$2`,
            [workspaceId, currentTaskId],
          );
          assert.ok(
            (secondBackoff.rows[0]?.next_attempt_at.getTime() ?? 0) -
              Date.now() >
              110_000,
          );
        }
      }
      const deadLetter = await pool.query<{
        attempts: number;
        dead_lettered_at: Date | null;
        status: string;
      }>(
        `select status, attempts, dead_lettered_at
           from harness_runtime.reservation_sweeps
          where workspace_id=$1 and task_id=$2`,
        [workspaceId, currentTaskId],
      );
      assert.equal(deadLetter.rows[0]?.status, 'dead_letter');
      assert.equal(
        deadLetter.rows[0]?.attempts,
        MAX_RESERVATION_SWEEP_ATTEMPTS,
      );
      assert.ok(deadLetter.rows[0]?.dead_lettered_at);
      const deadLetterAudit = await pool.query<{ action: string }>(
        `select payload->>'action' as action
           from p1_operations_audit_events
          where workspace_id=$1 and id=$2`,
        [
          workspaceId,
          `product_usage.reservation_release_dead_letter:${currentTaskId}`,
        ],
      );
      assert.equal(
        deadLetterAudit.rows[0]?.action,
        'product_usage.reservation_release_dead_letter',
      );

      const accepted = await store.submit({
        workspaceId,
        taskId: currentTaskId,
        mode: 'decision',
        command: {
          questionId: `question-${currentTaskId}`,
          workflowRevision: 1,
          idempotencyKey: `answer-${suffix}`,
          patch: {
            field: 'merchant_answer',
            value: '继续',
            reason: '商家已经补充',
          },
          decision: { state: 'accepted', value: '继续' },
        },
        event: {
          id: `event-${suffix}`,
          taskId: currentTaskId,
          questionId: `question-${currentTaskId}`,
          workflowRevision: 1,
          idempotencyKey: `answer-${suffix}`,
          payloadFingerprint: `payload-${suffix}`,
          patch: {
            field: 'merchant_answer',
            value: '继续',
            reason: '商家已经补充',
          },
          decision: { state: 'accepted', value: '继续' },
        },
        trace: {
          id: `trace-${suffix}`,
          taskId: currentTaskId,
          stage: 'intent_naming',
          kind: 'structured_decision',
          eventId: `event-${suffix}`,
          questionId: `question-${currentTaskId}`,
          workflowRevision: 1,
          outcome: 'accepted',
        },
      });
      assert.equal(accepted.outcome, 'created');
      assert.equal(accepted.resumeRequired, true);
      const failedProjection = await pool.query<{
        question_status: string;
        sweep_status: string;
      }>(
        `select questions.status as question_status,
                sweeps.status as sweep_status
           from harness_runtime.pending_questions questions
           join harness_runtime.reservation_sweeps sweeps
             on sweeps.runtime_id=questions.task_id
          where sweeps.workspace_id=$1 and sweeps.task_id=$2`,
        [workspaceId, currentTaskId],
      );
      assert.deepEqual(failedProjection.rows[0], {
        question_status: 'resolved',
        sweep_status: 'dead_letter',
      });
      assert.deepEqual(
        await store.claimBatch({
          expiresBefore: '2026-07-26T00:00:00.000Z',
          limit: 20,
        }),
        [],
      );
    } finally {
      await pool.query(
        `delete from p1_operations_audit_events where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from harness_runtime.audit_events
          where workflow_id = any($1::text[])`,
        [runtimeIds],
      );
      await pool.query(
        `delete from harness_runtime.reservation_sweeps
          where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from harness_runtime.decision_events
          where task_id = any($1::text[])`,
        [runtimeIds],
      );
      await pool.query(
        `delete from harness_runtime.decision_traces
          where task_id = any($1::text[])`,
        [runtimeIds],
      );
      await pool.query(
        `delete from harness_runtime.pending_questions
          where task_id = any($1::text[])`,
        [runtimeIds],
      );
      await pool.query(
        `delete from harness_runtime.task_requests
          where runtime_id = any($1::text[])`,
        [runtimeIds],
      );
      await pool.query(
        `delete from p1_product_billing_usage where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from p1_product_billing_quotes where workspace_id=$1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres reservation sweep keeps workflow and billing task coordinates separate',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-sweep-coordinates-${suffix}`;
    const sourceTaskId = `source-task-${suffix}`;
    const workflowTaskId = `${sourceTaskId}:plan-r1`;
    const runtimeId = harnessRuntimeId(workspaceId, workflowTaskId);
    const resumeEventId = `resume-event-${suffix}`;
    const retrySourceTaskId = `retry-source-task-${suffix}`;
    const retryWorkflowTaskId = `${retrySourceTaskId}:plan-r1`;
    const retryRuntimeId = harnessRuntimeId(
      workspaceId,
      retryWorkflowTaskId,
    );
    const refundedTaskIds: string[] = [];
    const expiredWorkflowTaskIds: string[] = [];

    try {
      await store.applySchema();
      await new PostgresProductBillingRepository(pool).migrate();
      await seedReservation(pool, {
        workspaceId,
        taskId: workflowTaskId,
        billingTaskId: sourceTaskId,
        runtimeId,
        unattended: 'hold',
        heldSince: '2026-07-25T00:00:00.000Z',
      });

      const sweeper = new HarnessReservationSweeper(
        store,
        {
          async commit() {
            throw new Error('reservation sweeper never commits usage');
          },
          async refund(input) {
            const billingTaskId = input.billingTaskId ?? input.taskId;
            refundedTaskIds.push(billingTaskId);
            await pool.query(
              `update p1_product_billing_usage
                  set status='refunded',
                      payload=jsonb_set(payload, '{status}', '"refunded"')
                where workspace_id=$1 and task_id=$2`,
              [input.workspaceId, billingTaskId],
            );
            await pool.query(
              `update p1_product_billing_quotes
                  set lifecycle_status='refunded',
                      payload=jsonb_set(
                        payload,
                        '{lifecycleStatus}',
                        '"refunded"'
                      )
                where workspace_id=$1 and task_id=$2`,
              [input.workspaceId, billingTaskId],
            );
          },
        },
        {
          now: () => new Date('2026-07-26T00:01:00.000Z'),
          reservationTtlSeconds: 24 * 60 * 60,
          async expireHold(input) {
            assert.equal(
              (
                await store.readDecisionTarget(
                  input.workspaceId,
                  input.taskId,
                )
              )?.reservationReleased,
              true,
            );
            await pool.query(
              `insert into harness_runtime.decision_events
                 (id, task_id, question_id, workflow_revision,
                  idempotency_key, payload_fingerprint, payload,
                  resolution_source, resume_status)
               values ($1,$2,$3,1,$4,$5,$6::jsonb,'decision','pending')`,
              [
                resumeEventId,
                runtimeId,
                `question-${workflowTaskId}`,
                `resume-expired-${suffix}`,
                `resume-fingerprint-${suffix}`,
                JSON.stringify({
                  patch: {
                    field: 'offer_price',
                    value: '超时已取消',
                    reason: '保留资源已退回',
                  },
                  decision: { state: 'ignored', value: '超时已取消' },
                }),
              ],
            );
            const resume = await new PostgresHarnessResumeReconcilerStore(
              pool,
            ).claimEvent(resumeEventId);
            assert.equal(resume?.kind, 'structured_decision');
            if (resume?.kind !== 'structured_decision') {
              throw new Error('Expected a structured decision resume claim.');
            }
            assert.equal(resume.taskId, workflowTaskId);
            assert.equal(resume.reservationReleased, true);
            expiredWorkflowTaskIds.push(input.taskId);
          },
        },
      );

      assert.deepEqual(
        await sweeper.runOnce({ workspaceId, taskId: workflowTaskId }),
        { claimed: 1, completed: 1, failed: 0 },
      );
      assert.deepEqual(refundedTaskIds, [sourceTaskId]);
      assert.deepEqual(expiredWorkflowTaskIds, [workflowTaskId]);
      const persisted = await pool.query<{ status: string }>(
        `select status
           from harness_runtime.reservation_sweeps
          where workspace_id=$1 and task_id=$2`,
        [workspaceId, workflowTaskId],
      );
      assert.equal(persisted.rows[0]?.status, 'completed');

      await seedReservation(pool, {
        workspaceId,
        taskId: retryWorkflowTaskId,
        billingTaskId: retrySourceTaskId,
        runtimeId: retryRuntimeId,
        unattended: 'hold',
        heldSince: '2026-07-25T00:00:00.000Z',
      });
      const failedBillingTaskIds: string[] = [];
      const failedSweeper = new HarnessReservationSweeper(
        store,
        {
          async commit() {
            throw new Error('reservation sweeper never commits usage');
          },
          async refund(input) {
            failedBillingTaskIds.push(input.billingTaskId ?? input.taskId);
            throw new Error('billing is temporarily unavailable');
          },
        },
        {
          now: () => new Date('2026-07-26T00:01:00.000Z'),
          reservationTtlSeconds: 24 * 60 * 60,
        },
      );
      assert.deepEqual(
        await failedSweeper.runOnce({
          workspaceId,
          taskId: retryWorkflowTaskId,
        }),
        { claimed: 1, completed: 0, failed: 1 },
      );
      assert.deepEqual(failedBillingTaskIds, [retrySourceTaskId]);
      const retryFence = await pool.query<{
        next_attempt_at: Date;
        status: string;
      }>(
        `select status, next_attempt_at
           from harness_runtime.reservation_sweeps
          where workspace_id=$1 and task_id=$2`,
        [workspaceId, retryWorkflowTaskId],
      );
      assert.equal(retryFence.rows[0]?.status, 'failed');
      assert.ok(
        (retryFence.rows[0]?.next_attempt_at.getTime() ?? 0) - Date.now() >
          50_000,
      );
    } finally {
      await pool.query(
        `delete from p1_operations_audit_events where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from harness_runtime.audit_events
          where workflow_id=any($1::text[])`,
        [[runtimeId, retryRuntimeId]],
      );
      await pool.query(
        `delete from harness_runtime.reservation_sweeps where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from harness_runtime.decision_events
          where task_id=any($1::text[])`,
        [[runtimeId, retryRuntimeId]],
      );
      await pool.query(
        `delete from harness_runtime.pending_questions
          where task_id=any($1::text[])`,
        [[runtimeId, retryRuntimeId]],
      );
      await pool.query(
        `delete from harness_runtime.task_requests
          where runtime_id=any($1::text[])`,
        [[runtimeId, retryRuntimeId]],
      );
      await pool.query(
        `delete from p1_product_billing_usage where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from p1_product_billing_quotes where workspace_id=$1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres split reservation stale reclaim preserves billing identity and settles once',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const billing = new DurableProductBillingService(
      billingRepository,
      () => new Date('2026-07-25T00:00:00.000Z'),
    );
    const credits = new PostgresCreditLedger(pool);
    const events = new MemoryObservabilityEventAudit();
    const suffix = randomUUID();
    const workspaceId = `workspace-sweep-stale-${suffix}`;
    const billingTaskId = `source-task-stale-${suffix}`;
    const workflowTaskId = `${billingTaskId}:plan-r2`;
    const runtimeId = harnessRuntimeId(workspaceId, workflowTaskId);
    const quoteId = `quote-stale-${suffix}`;
    const axesTaskIds: string[] = [];
    const expiredWorkflowTaskIds: string[] = [];

    try {
      await pool.query(`create table if not exists workspaces (
        id text primary key,
        name text not null
      )`);
      await pool.query(
        `insert into workspaces (id, name) values ($1, 'V31-57 stale reclaim')`,
        [workspaceId],
      );
      await store.applySchema();
      await billingRepository.migrate();
      const creditClient = await pool.connect();
      try {
        await credits.migrate(creditClient);
      } finally {
        creditClient.release();
      }
      await credits.grant({
        createdAt: '2026-07-24T00:00:00.000Z',
        credits: 5,
        expirationDate: null,
        id: `credit-lot-${suffix}`,
        sourceRef: `expiry-stale-${suffix}`,
        transactionType: 'PURCHASE_PACKAGE',
        workspaceId,
      });
      await credits.consume({
        workspaceId,
        credits: 2,
        transactionId: creditUsageOperationId(billingTaskId),
        actorId: 'owner-stale-reclaim',
        correlationId: `reserve-stale-${suffix}`,
        createdAt: '2026-07-25T00:00:00.000Z',
      });
      const quote = await billing.buildQuote({
        billingMode: 'per_request',
        catalogModelId: 'copy-model-stale-reclaim',
        catalogModelRevision: 'catalog-r1',
        creditCost: 2,
        failureRefundsCredits: true,
        frozenCandidateDeploymentIds: ['copy-deployment-stale-reclaim'],
        quoteId,
        quotePolicyRevision: 'quote-policy-r1',
        routeSnapshotRef: 'route-stale-reclaim',
        unitRate: 2,
        workspaceId,
      });
      const confirmed = await billing.confirm({
        quoteId,
        taskId: billingTaskId,
        workspaceId,
      });
      const reserved = await billing.reserve({
        quoteId,
        units: [],
        workspaceId,
      });
      await seedPendingReservationRequest(pool, {
        workspaceId,
        workflowTaskId,
        billingTaskId,
        runtimeId,
        quoteId,
        quoteRevision: confirmed.revision,
        usageReservationId: reserved.usage.id,
        creditUsageOperationId: creditUsageOperationId(billingTaskId),
        heldSince: '2026-07-25T00:00:00.000Z',
      });

      const settlement = new HarnessProductBillingSettlementExecutor(
        billing,
        undefined,
        () => new Date('2026-07-26T00:01:00.000Z'),
        {
          events,
          context: {
            async readTaskRootAxes(_resolvedWorkspaceId, taskId) {
              axesTaskIds.push(taskId);
              return {
                axisScope: 'task_root',
                skillRevision: { kind: 'absent' },
                promptVersion: { kind: 'bound', value: 'copy@v4' },
                catalogRevision: { kind: 'bound', value: 'catalog-r7' },
                scene: { kind: 'bound', value: 'opening-campaign' },
              };
            },
          },
        },
        credits,
      );
      const first = new HarnessReservationSweeper(store, settlement, {
        now: () => new Date('2026-07-26T00:01:00.000Z'),
        reservationTtlSeconds: 24 * 60 * 60,
        async expireHold() {
          throw new Error('simulated crash before sweep completion');
        },
      });
      assert.deepEqual(
        await first.runOnce({ workspaceId, taskId: workflowTaskId }),
        { claimed: 1, completed: 0, failed: 1 },
      );
      assert.equal(
        (await billing.getUsage(billingTaskId, workspaceId))?.status,
        'refunded',
      );
      assert.equal(
        (
          await pool.query<{ billing_task_id: string }>(
            `select billing_task_id
               from harness_runtime.reservation_sweeps
              where workspace_id=$1 and task_id=$2`,
            [workspaceId, workflowTaskId],
          )
        ).rows[0]?.billing_task_id,
        billingTaskId,
      );
      await pool.query(
        `update harness_runtime.reservation_sweeps
            set updated_at=now() - interval '2 minutes'
          where workspace_id=$1 and task_id=$2`,
        [workspaceId, workflowTaskId],
      );

      const restarted = new HarnessReservationSweeper(store, settlement, {
        now: () => new Date('2026-07-26T00:01:00.000Z'),
        reservationTtlSeconds: 24 * 60 * 60,
        async expireHold(input) {
          expiredWorkflowTaskIds.push(input.taskId);
        },
      });
      assert.deepEqual(
        await restarted.runOnce({ workspaceId, taskId: workflowTaskId }),
        { claimed: 1, completed: 1, failed: 0 },
      );
      assert.deepEqual(expiredWorkflowTaskIds, [workflowTaskId]);
      assert.deepEqual(axesTaskIds, [workflowTaskId, workflowTaskId]);
      assert.deepEqual(
        events.list(workspaceId).map((event) => event.taskId),
        [workflowTaskId],
      );
      assert.equal(
        (await credits.listTransactions(workspaceId)).filter(
          (transaction) => transaction.transactionType === 'REFUND',
        ).length,
        1,
      );
      assert.equal(
        (await credits.project(workspaceId, '2026-07-26T00:01:00.000Z'))
          .availableCredits,
        5,
      );
    } finally {
      await pool.query(
        `delete from p1_operations_audit_events where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from harness_runtime.audit_events where workflow_id=$1`,
        [runtimeId],
      );
      await pool.query(
        `delete from harness_runtime.reservation_sweeps where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from harness_runtime.pending_questions where task_id=$1`,
        [runtimeId],
      );
      await pool.query(
        `delete from harness_runtime.task_requests where runtime_id=$1`,
        [runtimeId],
      );
      await pool.query(
        `delete from p1_product_billing_usage where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from p1_product_billing_quotes where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(`delete from workspaces where id=$1`, [workspaceId]);
      await pool.end();
    }
  },
);

test(
  'Postgres reservation sweep dead-letters an orphaned same-id row',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-sweep-orphan-${suffix}`;
    const taskId = `legacy-task-${suffix}`;
    const runtimeId = `legacy-runtime-${suffix}`;
    const refundedTaskIds: string[] = [];
    const expiredTaskIds: string[] = [];

    try {
      await store.applySchema();
      await pool.query(
        `insert into harness_runtime.reservation_sweeps
           (workspace_id, task_id, billing_task_id, runtime_id, question_id,
            quote_id, quote_revision, usage_reservation_id, reserved_units,
            held_since, reason, status, updated_at)
         values ($1,$2,$2,$3,$4,$5,'quote-r1',$6,$7::jsonb,
                 '2026-07-25T00:00:00.000Z',
                 'hold_reservation_ttl_elapsed','processing',
                 now() - interval '2 minutes')`,
        [
          workspaceId,
          taskId,
          runtimeId,
          `question-${taskId}`,
          `quote-${taskId}`,
          `usage-${taskId}`,
          JSON.stringify([{ resource: 'image', quantity: 2 }]),
        ],
      );
      await new PostgresProductBillingRepository(pool).migrate();
      const sweeper = new HarnessReservationSweeper(
        store,
        {
          async commit() {
            throw new Error('reservation sweeper never commits usage');
          },
          async refund(input) {
            refundedTaskIds.push(input.billingTaskId ?? input.taskId);
          },
        },
        {
          async expireHold(input) {
            expiredTaskIds.push(input.taskId);
          },
        },
      );

      assert.deepEqual(
        await sweeper.runOnce({ workspaceId, taskId }),
        { claimed: 0, completed: 0, failed: 0 },
      );
      assert.deepEqual(refundedTaskIds, []);
      assert.deepEqual(expiredTaskIds, []);
      assert.deepEqual(
        (
          await pool.query<{
            billing_task_id: string;
            last_error: string;
            status: string;
          }>(
            `select billing_task_id, last_error, status
               from harness_runtime.reservation_sweeps
              where workspace_id=$1 and task_id=$2`,
            [workspaceId, taskId],
          )
        ).rows[0],
        {
          billing_task_id: taskId,
          last_error: 'Reservation sweep workflow authority is unavailable.',
          status: 'dead_letter',
        },
      );
    } finally {
      await pool.query(
        `delete from p1_operations_audit_events where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from harness_runtime.audit_events where workflow_id=$1`,
        [runtimeId],
      );
      await pool.query(
        `delete from harness_runtime.reservation_sweeps where workspace_id=$1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres reservation sweep dead-letters a malformed persisted identity before refund',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-sweep-invalid-identity-${suffix}`;
    const billingTaskId = `task-sweep-invalid-identity-${suffix}`;
    const taskId = `${billingTaskId}:plan-r1`;
    const runtimeId = harnessRuntimeId(workspaceId, taskId);
    const quoteId = `quote-sweep-invalid-identity-${suffix}`;
    const usageReservationId = `usage-sweep-invalid-identity-${suffix}`;
    const reservationId = creditUsageOperationId(billingTaskId);

    try {
      await store.applySchema();
      await new PostgresProductBillingRepository(pool).migrate();
      await seedPendingReservationRequest(pool, {
        workspaceId,
        workflowTaskId: taskId,
        billingTaskId,
        runtimeId,
        quoteId,
        quoteRevision: 'quote-r1',
        usageReservationId,
        creditUsageOperationId: reservationId,
        heldSince: '2026-07-25T00:00:00.000Z',
      });
      await pool.query(
        `insert into p1_product_billing_quotes
           (workspace_id, quote_id, task_id, lifecycle_status, payload)
         values ($1,$2,$3,'reserved',$4::jsonb)`,
        [
          workspaceId,
          quoteId,
          billingTaskId,
          JSON.stringify({
            workspaceId,
            quoteId,
            taskId: billingTaskId,
            revision: 'quote-r1',
            lifecycleStatus: 'reserved',
          }),
        ],
      );
      await pool.query(
        `insert into p1_product_billing_usage
           (workspace_id, usage_id, task_id, quote_id, status, payload)
         values ($1,$2,$3,$4,'reserved',$5::jsonb)`,
        [
          workspaceId,
          usageReservationId,
          billingTaskId,
          quoteId,
          JSON.stringify({
            id: usageReservationId,
            workspaceId,
            taskId: billingTaskId,
            quoteId,
            status: 'reserved',
            reservedUnits: [{ resource: 'image', quantity: 1 }],
          }),
        ],
      );
      await pool.query(
        `insert into harness_runtime.reservation_sweeps
           (workspace_id, task_id, billing_task_id, runtime_id, question_id,
            quote_id, quote_revision, usage_reservation_id, reserved_units,
            billing_identity, held_since, reason, status, updated_at)
         values ($1,$2,$3,$4,$5,$6,'quote-r1',$7,$8::jsonb,$9::jsonb,
                 '2026-07-25T00:00:00.000Z',
                 'hold_reservation_ttl_elapsed','processing',
                 now() - interval '2 minutes')`,
        [
          workspaceId,
          taskId,
          billingTaskId,
          runtimeId,
          `question-${taskId}`,
          quoteId,
          usageReservationId,
          JSON.stringify([{ resource: 'image', quantity: 1 }]),
          JSON.stringify({
            workspaceId,
            taskId: billingTaskId,
            workId: `work-${billingTaskId}`,
            workflowId: taskId,
            quoteRef: { id: quoteId, revision: 'quote-r1' },
            reservationId,
            carrierUnitId: 'single',
            carrierUnitIds: ['single', 'single'],
            carrierBillableUnits: 1,
          }),
        ],
      );

      assert.deepEqual(
        await store.claimBatch({
          expiresBefore: '2026-07-26T00:00:00.000Z',
          limit: 1,
          workspaceId,
          taskId,
        }),
        [],
      );
      assert.deepEqual(
        (
          await pool.query<{ last_error: string; status: string }>(
            `select status, last_error
               from harness_runtime.reservation_sweeps
              where workspace_id=$1 and task_id=$2`,
            [workspaceId, taskId],
          )
        ).rows[0],
        {
          status: 'dead_letter',
          last_error: 'Reservation sweep billing identity is incomplete.',
        },
      );
    } finally {
      await pool.query(
        `delete from harness_runtime.reservation_sweeps where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from harness_runtime.pending_questions where task_id=$1`,
        [runtimeId],
      );
      await pool.query(
        `delete from harness_runtime.task_requests where runtime_id=$1`,
        [runtimeId],
      );
      await pool.query(
        `delete from p1_product_billing_usage where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from p1_product_billing_quotes where workspace_id=$1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres reservation sweep rejects mismatched source usage and quote bindings',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-sweep-binding-${suffix}`;
    const usageSourceTaskId = `usage-source-${suffix}`;
    const usageWorkflowTaskId = `${usageSourceTaskId}:plan-r1`;
    const usageRuntimeId = harnessRuntimeId(
      workspaceId,
      usageWorkflowTaskId,
    );
    const quoteSourceTaskId = `quote-source-${suffix}`;
    const quoteWorkflowTaskId = `${quoteSourceTaskId}:plan-r1`;
    const quoteRuntimeId = harnessRuntimeId(
      workspaceId,
      quoteWorkflowTaskId,
    );
    const acceptedSourceTaskId = `accepted-source-${suffix}`;
    const acceptedWorkflowTaskId = `${acceptedSourceTaskId}:plan-r1`;
    const acceptedRuntimeId = harnessRuntimeId(
      workspaceId,
      acceptedWorkflowTaskId,
    );

    try {
      await store.applySchema();
      await new PostgresProductBillingRepository(pool).migrate();
      await seedReservation(pool, {
        workspaceId,
        taskId: usageWorkflowTaskId,
        billingTaskId: usageSourceTaskId,
        requestUsageReservationId: `other-usage-${suffix}`,
        runtimeId: usageRuntimeId,
        unattended: 'hold',
        heldSince: '2026-07-25T00:00:00.000Z',
      });
      await seedReservation(pool, {
        workspaceId,
        taskId: quoteWorkflowTaskId,
        billingTaskId: quoteSourceTaskId,
        quoteTaskId: `other-quote-task-${suffix}`,
        runtimeId: quoteRuntimeId,
        unattended: 'hold',
        heldSince: '2026-07-25T00:00:00.000Z',
      });
      await seedReservation(pool, {
        workspaceId,
        taskId: acceptedWorkflowTaskId,
        billingTaskId: acceptedSourceTaskId,
        requestQuoteId: `other-accepted-quote-${suffix}`,
        runtimeId: acceptedRuntimeId,
        unattended: 'hold',
        heldSince: '2026-07-25T00:00:00.000Z',
      });

      assert.deepEqual(
        await store.claimBatch({
          expiresBefore: '2026-07-26T00:00:00.000Z',
          limit: 1,
          workspaceId,
          taskId: usageWorkflowTaskId,
        }),
        [],
      );
      assert.deepEqual(
        await store.claimBatch({
          expiresBefore: '2026-07-26T00:00:00.000Z',
          limit: 1,
          workspaceId,
          taskId: acceptedWorkflowTaskId,
        }),
        [],
      );
      assert.deepEqual(
        await store.claimBatch({
          expiresBefore: '2026-07-26T00:00:00.000Z',
          limit: 1,
          workspaceId,
          taskId: quoteWorkflowTaskId,
        }),
        [],
      );
    } finally {
      await pool.query(
        `delete from harness_runtime.reservation_sweeps where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from harness_runtime.pending_questions
          where task_id=any($1::text[])`,
        [[usageRuntimeId, quoteRuntimeId, acceptedRuntimeId]],
      );
      await pool.query(
        `delete from harness_runtime.task_requests
          where runtime_id=any($1::text[])`,
        [[usageRuntimeId, quoteRuntimeId, acceptedRuntimeId]],
      );
      await pool.query(
        `delete from p1_product_billing_usage where workspace_id=$1`,
        [workspaceId],
      );
      await pool.query(
        `delete from p1_product_billing_quotes where workspace_id=$1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

async function seedReservation(
  pool: Pool,
  input: {
    workspaceId: string;
    taskId: string;
    billingTaskId?: string;
    quoteTaskId?: string;
    requestQuoteId?: string;
    requestUsageReservationId?: string;
    runtimeId: string;
    unattended: 'continue' | 'hold';
    heldSince: string;
  },
) {
  const billingTaskId = input.billingTaskId ?? input.taskId;
  const quoteTaskId = input.quoteTaskId ?? billingTaskId;
  const quoteId = `quote-${billingTaskId}`;
  const usageId = `usage-${billingTaskId}`;
  const requestQuoteId = input.requestQuoteId ?? quoteId;
  const requestUsageReservationId = input.requestUsageReservationId ?? usageId;
  const reservationIdempotencyKey = `consume:task:${billingTaskId}`;
  const billingIdentity = {
    workspaceId: input.workspaceId,
    taskId: billingTaskId,
    workId: `work-${billingTaskId}`,
    workflowId: input.taskId,
    quoteRef: { id: requestQuoteId, revision: 'quote-r1' },
    creditUsageOperationId: reservationIdempotencyKey,
    productUsageReservationId: requestUsageReservationId,
    reservationId: billingIdentityReservationFingerprint({
      creditUsageOperationId: reservationIdempotencyKey,
      productUsageReservationId: requestUsageReservationId,
    }),
    carrierUnitId: 'single',
    carrierUnitIds: ['single'],
    carrierBillableUnits: 1,
    planId: `plan-${billingTaskId}`,
    planRevision: 1,
    snapshotHash: `snapshot-${input.taskId}`,
  };
  await pool.query(
    `insert into harness_runtime.task_requests
       (task_id, workflow_id, runtime_id, fingerprint, request,
        billing_identity, confirmation_request_id, admission_state)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,'awaiting_confirmation')`,
    [
      input.runtimeId,
      input.taskId,
      input.runtimeId,
      `fingerprint-${input.taskId}`,
      JSON.stringify({
        workspaceId: input.workspaceId,
        billingTaskId,
        carrierUnitId: 'single',
        carrierUnitIds: ['single'],
        carrierBillableUnits: 1,
        usageReservation: {
          id: requestUsageReservationId,
          creditUsageOperationId: reservationIdempotencyKey,
        },
        executionSnapshot: {
          work: { id: `work-${billingTaskId}` },
          quote: {
            id: requestQuoteId,
            revision: 'quote-r1',
          },
        },
        pendingExecutionPlanSnapshot: {
          snapshotHash: `snapshot-${input.taskId}`,
          content: {
            planId: `plan-${billingTaskId}`,
            planRevision: 1,
            quoteRef: { id: requestQuoteId, revision: 'quote-r1' },
          },
        },
        executionConfirmationRequestId: `confirmation-${input.taskId}`,
        billingIdentity,
      }),
      JSON.stringify(billingIdentity),
      `confirmation-${input.taskId}`,
    ],
  );
  await pool.query(
    `insert into harness_runtime.pending_questions
       (task_id, question_id, workflow_revision, payload, status, updated_at)
     values ($1,$2,1,$3,'pending',$4)`,
    [
      input.runtimeId,
      `question-${input.taskId}`,
      JSON.stringify({
        questionId: `question-${input.taskId}`,
        workflowId: input.taskId,
        workflowRevision: 1,
        question: '这次活动价是多少？',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: '补充本次任务所需信息',
        },
        unattended: input.unattended,
        scope: 'current_task',
      }),
      input.heldSince,
    ],
  );
  await pool.query(
    `insert into p1_product_billing_quotes
       (workspace_id, quote_id, task_id, lifecycle_status, payload)
     values ($1,$2,$3,'reserved',$4)`,
    [
      input.workspaceId,
      quoteId,
      quoteTaskId,
      JSON.stringify({
        workspaceId: input.workspaceId,
        quoteId,
        taskId: quoteTaskId,
        revision: 'quote-r1',
        lifecycleStatus: 'reserved',
      }),
    ],
  );
  await pool.query(
    `insert into p1_product_billing_usage
       (workspace_id, usage_id, task_id, quote_id, status, payload)
     values ($1,$2,$3,$4,'reserved',$5)`,
    [
      input.workspaceId,
      usageId,
      billingTaskId,
      quoteId,
      JSON.stringify({
        id: usageId,
        workspaceId: input.workspaceId,
        taskId: billingTaskId,
        quoteId,
        status: 'reserved',
        reservedUnits: [{ resource: 'image', quantity: 2 }],
      }),
    ],
  );
}

async function seedPendingReservationRequest(
  pool: Pool,
  input: {
    workspaceId: string;
    workflowTaskId: string;
    billingTaskId: string;
    runtimeId: string;
    quoteId: string;
    quoteRevision: string;
    usageReservationId: string;
    creditUsageOperationId: string;
    heldSince: string;
  },
) {
  const billingIdentity = {
    workspaceId: input.workspaceId,
    taskId: input.billingTaskId,
    workId: `work-${input.billingTaskId}`,
    workflowId: input.workflowTaskId,
    quoteRef: { id: input.quoteId, revision: input.quoteRevision },
    creditUsageOperationId: input.creditUsageOperationId,
    productUsageReservationId: input.usageReservationId,
    reservationId: billingIdentityReservationFingerprint({
      creditUsageOperationId: input.creditUsageOperationId,
      productUsageReservationId: input.usageReservationId,
    }),
    carrierUnitId: 'single',
    carrierUnitIds: ['single'],
    carrierBillableUnits: 1,
    planId: `plan-${input.billingTaskId}`,
    planRevision: 1,
    snapshotHash: `snapshot-${input.workflowTaskId}`,
  };
  await pool.query(
    `insert into harness_runtime.task_requests
       (task_id, workflow_id, runtime_id, fingerprint, request,
        billing_identity, confirmation_request_id, admission_state)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,'awaiting_confirmation')`,
    [
      input.runtimeId,
      input.workflowTaskId,
      input.runtimeId,
      `fingerprint-${input.workflowTaskId}`,
      JSON.stringify({
        workspaceId: input.workspaceId,
        billingTaskId: input.billingTaskId,
        carrierUnitId: 'single',
        carrierUnitIds: ['single'],
        carrierBillableUnits: 1,
        usageReservation: {
          id: input.usageReservationId,
          credits: 2,
          units: [],
          creditUsageOperationId: input.creditUsageOperationId,
        },
        executionSnapshot: {
          work: { id: `work-${input.billingTaskId}` },
          quote: {
            id: input.quoteId,
            revision: input.quoteRevision,
          },
        },
        pendingExecutionPlanSnapshot: {
          snapshotHash: `snapshot-${input.workflowTaskId}`,
          content: {
            planId: `plan-${input.billingTaskId}`,
            planRevision: 1,
            quoteRef: { id: input.quoteId, revision: input.quoteRevision },
          },
        },
        executionConfirmationRequestId: `confirmation-${input.workflowTaskId}`,
        billingIdentity,
      }),
      JSON.stringify(billingIdentity),
      `confirmation-${input.workflowTaskId}`,
    ],
  );
  await pool.query(
    `insert into harness_runtime.pending_questions
       (task_id, question_id, workflow_revision, payload, status, updated_at)
     values ($1,$2,1,$3,'pending',$4)`,
    [
      input.runtimeId,
      `question-${input.workflowTaskId}`,
      JSON.stringify({
        questionId: `question-${input.workflowTaskId}`,
        workflowId: input.workflowTaskId,
        workflowRevision: 1,
        question: '这次活动价是多少？',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: '补充本次任务所需信息',
        },
        unattended: 'hold',
        scope: 'current_task',
      }),
      input.heldSince,
    ],
  );
}
