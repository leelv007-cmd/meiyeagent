import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import { PostgresHarnessStore } from './postgres-store.js';
import { MAX_RESERVATION_SWEEP_ATTEMPTS } from './reservation-sweeper.js';
import { harnessRuntimeId } from './workspace-scope.js';

const connectionString = process.env.TEST_DATABASE_URL;

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
    const taskIds = [expiredTaskId, currentTaskId, continueTaskId];
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
                : '2026-07-25T00:00:00.000Z',
          }),
        ),
      );

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

async function seedReservation(
  pool: Pool,
  input: {
    workspaceId: string;
    taskId: string;
    runtimeId: string;
    unattended: 'continue' | 'hold';
    heldSince: string;
  },
) {
  const quoteId = `quote-${input.taskId}`;
  const usageId = `usage-${input.taskId}`;
  await pool.query(
    `insert into harness_runtime.task_requests
       (task_id, workflow_id, runtime_id, fingerprint, request)
     values ($1,$2,$3,$4,$5)`,
    [
      input.runtimeId,
      input.taskId,
      input.runtimeId,
      `fingerprint-${input.taskId}`,
      JSON.stringify({
        workspaceId: input.workspaceId,
        usageReservation: { id: usageId },
      }),
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
      input.taskId,
      JSON.stringify({
        workspaceId: input.workspaceId,
        quoteId,
        taskId: input.taskId,
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
      input.taskId,
      quoteId,
      JSON.stringify({
        id: usageId,
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        quoteId,
        status: 'reserved',
        reservedUnits: [{ resource: 'image', quantity: 2 }],
      }),
    ],
  );
}
