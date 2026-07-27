import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { PostgresOperationsRepository } from '../operations/postgres-repository.js';
import { HarnessDecisionService } from './decision-service.js';
import { PostgresHarnessStore } from './postgres-store.js';
import { harnessRuntimeId } from './workspace-scope.js';
import { HarnessTaskAdmissionService } from './task-admission.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres harness store atomically owns requests, decisions, traces and outbox',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    await store.applySchema();
    const suffix = randomUUID();
    const taskId = `harness-store-${suffix}`;
    const workspaceId = 'workspace-1';
    const runtimeTaskId = harnessRuntimeId(workspaceId, taskId);
    const otherWorkspaceId = 'workspace-2';
    const otherRuntimeTaskId = harnessRuntimeId(otherWorkspaceId, taskId);
    const questionId = `question-${suffix}`;
    let starts = 0;
    const admission = new HarnessTaskAdmissionService(store, {
      async start({ workflowId }) {
        starts += 1;
        return { workflowId };
      },
    });
    const request = taskRequest(taskId);

    try {
      assert.equal((await admission.submit(request)).replayed, false);
      assert.equal((await admission.submit(request)).replayed, true);
      assert.equal(starts, 2);
      await assert.rejects(
        admission.submit({ ...request, rawInput: '不同载荷' }),
        /different harness request payload/u
      );
      assert.equal(
        (
          await admission.submit({
            ...request,
            actorId: 'owner-2',
            workspaceId: otherWorkspaceId,
            packageId: 'package-2',
            rawInput: '另一个工作区使用同一个客户端任务 ID',
          })
        ).replayed,
        false,
      );
      assert.equal(starts, 3);
      assert.equal(await store.taskBelongsToWorkspace(taskId, workspaceId), true);
      assert.equal(
        await store.taskBelongsToWorkspace(taskId, otherWorkspaceId),
        true,
      );

      await store.registerPending(
        workspaceId,
        {
          questionId,
          workflowId: taskId,
          workflowRevision: 4,
          question: '当前团购价是多少？',
          options: [],
          freeText: { enabled: true },
          response: {
            field: 'offer_price',
            reason: '补充当前任务所需的权威事实',
          },
          scope: 'current_task',
        },
        { timeoutSeconds: 17 },
      );
      await store.registerPending(otherWorkspaceId, {
        questionId,
        workflowId: taskId,
        workflowRevision: 4,
        question: '当前团购价是多少？',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: '补充当前任务所需的权威事实',
        },
        scope: 'current_task',
      });
      assert.equal(
        (await store.readPending(workspaceId, taskId))?.questionId,
        questionId,
      );
      assert.equal(
        (await store.readDecisionTarget(workspaceId, taskId))
          ?.timeoutSeconds,
        17,
      );

      const resumed: string[] = [];
      const decisions = new HarnessDecisionService(store, {
        async resume(_workspaceId, _taskId, resumedCommand) {
          resumed.push(resumedCommand.questionId);
        },
      });
      const command = decisionInput(questionId);
      const concurrent = await Promise.all([
        decisions.submit(workspaceId, taskId, command),
        decisions.submit(workspaceId, taskId, command),
      ]);
      assert.deepEqual(
        concurrent.map((result) => result.replayed).sort(),
        [false, true],
      );
      assert.equal(
        (await decisions.submit(otherWorkspaceId, taskId, command)).replayed,
        false,
      );
      assert.deepEqual(resumed, [questionId, questionId]);
      assert.equal(await store.readPending(workspaceId, taskId), null);
      assert.equal(await store.readPending(otherWorkspaceId, taskId), null);
      assert.equal(
        (
          await store.readPending(workspaceId, taskId, {
            includeResolved: true,
          })
        )?.questionId,
        questionId,
      );
      await store.recordStageTrace({
        workspaceId,
        id: `trace-${taskId}-execution`,
        taskId,
        stage: 'execution_selection',
        payload: { winnerCandidateId: 'c01' },
      });
      await store.recordStageTrace({
        workspaceId,
        id: `trace-${taskId}-execution`,
        taskId,
        stage: 'execution_selection',
        payload: { winnerCandidateId: 'c01' },
      });

      const persisted = await pool.query(
        `select
           (select count(*)::int from harness_runtime.decision_events where task_id=$1) as events,
           (select resume_status from harness_runtime.decision_events where task_id=$1) as resume_status,
           (select count(*)::int from harness_runtime.decision_traces where task_id=$1) as traces,
           (select count(*)::int from harness_runtime.audit_events where workflow_id=$1) as audits,
           (select count(*)::int from harness_runtime.langfuse_outbox o
             join harness_runtime.audit_events a on a.id=o.audit_id
             where a.workflow_id=$1) as outbox`,
        [runtimeTaskId],
      );
      assert.deepEqual(persisted.rows[0], {
        events: 1,
        resume_status: 'sent',
        traces: 2,
        audits: 2,
        outbox: 2,
      });
      const decisionEvidence = await pool.query<{
        audit_payload: {
          eventId: string;
          questionId: string;
        };
        decision_payload: {
          decision: { value: string };
          patch: { field: string; value: string };
        };
      }>(
        `select events.payload as decision_payload,
                (select audit.payload
                   from harness_runtime.audit_events audit
                  where audit.workflow_id=$1
                    and audit.event_type='structured_decision_recorded'
                  limit 1) as audit_payload
           from harness_runtime.decision_events events
          where events.task_id=$1`,
        [runtimeTaskId],
      );
      assert.equal(
        decisionEvidence.rows[0]?.decision_payload.patch.field,
        command.patch.field,
      );
      assert.equal(
        decisionEvidence.rows[0]?.decision_payload.decision.value,
        command.decision.value,
      );
      assert.equal(
        decisionEvidence.rows[0]?.audit_payload.questionId,
        command.questionId,
      );
      const ownOutbox = await pool.query<{ audit_id: string }>(
        `select o.audit_id
         from harness_runtime.langfuse_outbox o
         join harness_runtime.audit_events a on a.id=o.audit_id
         where a.workflow_id=any($1::text[])
         order by o.audit_id`,
        [[runtimeTaskId, otherRuntimeTaskId]],
      );
      assert.equal(ownOutbox.rows.length, 3);
      const ownAuditIds = ownOutbox.rows.map((row) => row.audit_id);
      await pool.query(
        `update harness_runtime.langfuse_outbox
         set next_attempt_at='-infinity'::timestamptz
         where audit_id=any($1::text[])`,
        [ownAuditIds],
      );

      const claimed = await store.claimLangfuseBatch(ownAuditIds.length);
      const claimedByAuditId = new Map(
        claimed.map((item) => [item.auditId, item]),
      );
      assert.ok(
        ownAuditIds.every((auditId) => claimedByAuditId.has(auditId)),
      );
      assert.deepEqual(
        new Set(claimed.map((item) => item.workflowId)),
        new Set([runtimeTaskId, otherRuntimeTaskId]),
      );
      const failedItem = claimedByAuditId.get(ownAuditIds[0]!);
      const sentItem = claimedByAuditId.get(ownAuditIds[1]!);
      const deadLetterItem = claimedByAuditId.get(ownAuditIds[2]!);
      assert.ok(failedItem);
      assert.ok(sentItem);
      assert.ok(deadLetterItem);
      await store.markLangfuseSent(sentItem.auditId);
      await store.markLangfuseFailed(
        failedItem.auditId,
        'temporary failure',
        new Date(0)
      );
      const retried = await store.claimLangfuseBatch(1);
      const retriedItem = retried.find(
        (item) => item.auditId === failedItem.auditId,
      );
      assert.ok(retriedItem);
      assert.equal(retriedItem.attempts, 2);
      await store.markLangfuseSent(retriedItem.auditId);
      const outbox = await pool.query(
        `select status from harness_runtime.langfuse_outbox where audit_id=$1`,
        [retriedItem.auditId]
      );
      assert.equal(outbox.rows[0]?.status, 'sent');
      await store.markLangfuseFailed(
        deadLetterItem.auditId,
        'temporary failure',
        new Date(0),
      );
      for (let expectedAttempts = 2; expectedAttempts < 8; expectedAttempts += 1) {
        const retry = await store.claimLangfuseBatch(1, 300, 8);
        const retryItem: (typeof retry)[number] | undefined = retry.find(
          (item) => item.auditId === deadLetterItem.auditId,
        );
        assert.ok(retryItem);
        assert.equal(retryItem.attempts, expectedAttempts);
        await store.markLangfuseFailed(
          retryItem.auditId,
          'temporary failure',
          new Date(0),
        );
        const beforeLimit: {
          rows: Array<{
            status: string;
            attempts: number;
            dead_lettered_at: Date | null;
          }>;
        } = await pool.query<{
          status: string;
          attempts: number;
          dead_lettered_at: Date | null;
        }>(
          `select status, attempts, dead_lettered_at
           from harness_runtime.langfuse_outbox
           where audit_id=$1`,
          [deadLetterItem.auditId],
        );
        assert.deepEqual(beforeLimit.rows[0], {
          status: 'failed',
          attempts: expectedAttempts,
          dead_lettered_at: null,
        });
      }
      const finalAttempt = await store.claimLangfuseBatch(1, 300, 8);
      const finalAttemptItem = finalAttempt.find(
        (item) => item.auditId === deadLetterItem.auditId,
      );
      assert.ok(finalAttemptItem);
      assert.equal(finalAttemptItem.attempts, 8);
      await store.markLangfuseDeadLetter(
        finalAttemptItem.auditId,
        'attempt limit reached',
      );
      const deadLetter = await pool.query<{
        status: string;
        dead_lettered_at: Date | null;
      }>(
        `select status, dead_lettered_at
         from harness_runtime.langfuse_outbox
         where audit_id=$1`,
        [deadLetterItem.auditId],
      );
      assert.equal(deadLetter.rows[0]?.status, 'dead_letter');
      assert.ok(deadLetter.rows[0]?.dead_lettered_at);
      const afterDeadLetter = await store.claimLangfuseBatch(
        ownAuditIds.length,
      );
      assert.equal(
        afterDeadLetter.some(
          (item) => item.auditId === deadLetterItem.auditId,
        ),
        false,
      );
      await store.recordTerminalFailure({
        workspaceId,
        workflowId: taskId,
        failure: {
          code: 'HARNESS_COPY_ONLY',
          status: 409,
        },
      });
      assert.deepEqual(await store.readTerminalFailure(workspaceId, taskId), {
        code: 'HARNESS_COPY_ONLY',
        status: 409,
      });
    } finally {
      await pool.query(
        `delete from harness_runtime.task_requests where task_id in ($1,$2)`,
        [runtimeTaskId, otherRuntimeTaskId],
      );
      await pool.query(
        `delete from harness_runtime.pending_questions where task_id in ($1,$2)`,
        [runtimeTaskId, otherRuntimeTaskId],
      );
      await pool.query(
        `delete from harness_runtime.decision_events where task_id in ($1,$2)`,
        [runtimeTaskId, otherRuntimeTaskId],
      );
      await pool.query(
        `delete from harness_runtime.decision_traces where task_id in ($1,$2)`,
        [runtimeTaskId, otherRuntimeTaskId],
      );
      await pool.query(
        `delete from harness_runtime.audit_events where workflow_id in ($1,$2)`,
        [runtimeTaskId, otherRuntimeTaskId],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres timeout decisions resolve the row and separate browser from core ledger facts',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    await store.applySchema();
    const suffix = randomUUID();
    const workspaceId = `timeout-ledger-${suffix}`;
    const browserTaskId = `browser-timeout-${suffix}`;
    const coreTaskId = `core-timeout-${suffix}`;
    const holdTaskId = `hold-timeout-${suffix}`;
    const browserRuntimeId = harnessRuntimeId(workspaceId, browserTaskId);
    const coreRuntimeId = harnessRuntimeId(workspaceId, coreTaskId);
    const holdRuntimeId = harnessRuntimeId(workspaceId, holdTaskId);
    const successorStarts: string[] = [];
    const admission = new HarnessTaskAdmissionService(store, {
      async start({ workflowId }) {
        return { workflowId };
      },
    });
    const decisions = new HarnessDecisionService(store, {
      async resume() {},
      async startSuccessor({ workflowId }) {
        successorStarts.push(workflowId);
      },
    });

    try {
      for (const taskId of [browserTaskId, coreTaskId, holdTaskId]) {
        await admission.submit({
          ...taskRequest(taskId),
          packageId: `package-${taskId}`,
          workspaceId,
        });
        await store.registerPending(workspaceId, {
          questionId: `${taskId}:offer-price`,
          workflowId: taskId,
          workflowRevision: 4,
          question: '当前团购价是多少？',
          options: [],
          freeText: { enabled: true },
          response: {
            field: 'offer_price',
            reason: '补充当前任务所需的权威事实',
          },
          unattended: taskId === holdTaskId ? 'hold' : 'continue',
          scope: 'current_task',
        });
      }

      await decisions.submit(
        workspaceId,
        browserTaskId,
        ignoredDecision(
          `${browserTaskId}:offer-price`,
          `${browserTaskId}:offer-price:r4:timed_out`,
          '前端倒计时结束，按通用口径继续',
        ),
      );
      await decisions.submitCoreTimeout(
        workspaceId,
        coreTaskId,
        ignoredDecision(
          `${coreTaskId}:offer-price`,
          `${coreTaskId}:offer-price:r4:core_timeout`,
          '超时未作答，已按通用口径继续',
        ),
      );
      await decisions.submitCoreHoldExpired(
        workspaceId,
        holdTaskId,
        ignoredDecision(
          `${holdTaskId}:offer-price`,
          `${holdTaskId}:offer-price:r4:core_hold_expired`,
          '超时未选择，本次任务已取消，额度已退回',
        ),
      );

      const billingBefore = await successorBillingRows(pool, workspaceId);
      const consumed = await decisions.submit(
        workspaceId,
        coreTaskId,
        ignoredDecision(
          `${coreTaskId}:offer-price`,
          `${coreTaskId}:offer-price:browser-timed-out`,
          '未作答',
        ),
      );
      assert.equal(consumed.consumedByOther, true);
      assert.equal(consumed.replayed, undefined);
      assert.equal(consumed.successor, undefined);
      assert.deepEqual(await successorBillingRows(pool, workspaceId), billingBefore);
      assert.deepEqual(successorStarts, []);

      const late = await decisions.submit(
        workspaceId,
        coreTaskId,
        acceptedDecision(`${coreTaskId}:offer-price`, '398 元'),
      );
      const replay = await decisions.submit(
        workspaceId,
        coreTaskId,
        acceptedDecision(`${coreTaskId}:offer-price`, '399 元'),
      );
      assert.equal(late.replayed, false);
      assert.equal(replay.replayed, true);
      assert.equal(late.successor?.workflowId, replay.successor?.workflowId);
      assert.deepEqual(successorStarts, [late.successor?.workflowId]);

      const evidence = await pool.query<{
        audits: number;
        events: number;
        idempotency_keys: string[];
        outbox: number;
        pending_status: string;
        traces: number;
      }>(
        `select requests.workflow_id,
                questions.status as pending_status,
                count(distinct events.id)::int as events,
                array_agg(distinct events.idempotency_key order by events.idempotency_key)
                  as idempotency_keys,
                count(distinct traces.id)::int as traces,
                count(distinct audits.id)::int as audits,
                count(distinct outbox.audit_id)::int as outbox
           from harness_runtime.task_requests requests
           join harness_runtime.pending_questions questions
             on questions.task_id=requests.task_id
           join harness_runtime.decision_events events
             on events.task_id=requests.task_id
           join harness_runtime.decision_traces traces
             on traces.task_id=requests.task_id
           join harness_runtime.audit_events audits
             on audits.workflow_id=requests.task_id
            and audits.event_type='structured_decision_recorded'
           join harness_runtime.langfuse_outbox outbox
             on outbox.audit_id=audits.id
          where requests.task_id=any($1::text[])
          group by requests.workflow_id, questions.status
          order by requests.workflow_id`,
        [[browserRuntimeId, coreRuntimeId, holdRuntimeId]],
      );
      assert.deepEqual(
        evidence.rows.map((row) => ({
          audits: row.audits,
          events: row.events,
          idempotency_keys: [...row.idempotency_keys].sort(),
          outbox: row.outbox,
          pending_status: row.pending_status,
          traces: row.traces,
        })),
        [
          {
            audits: 1,
            events: 1,
            idempotency_keys: [
              `${browserTaskId}:offer-price:r4:timed_out`,
            ],
            outbox: 1,
            pending_status: 'resolved',
            traces: 1,
          },
          {
            audits: 2,
            events: 2,
            idempotency_keys: [
              `${coreTaskId}:offer-price:late_answer`,
              `${coreTaskId}:offer-price:r4:core_timeout`,
            ].sort(),
            outbox: 2,
            pending_status: 'resolved',
            traces: 2,
          },
          {
            audits: 1,
            events: 1,
            idempotency_keys: [
              `${holdTaskId}:offer-price:r4:core_hold_expired`,
            ],
            outbox: 1,
            pending_status: 'resolved',
            traces: 1,
          },
        ],
      );
      const coreTimeout = await pool.query<{
        decision_value: string;
        event_resolution_source: string;
        resolution_source: string;
        resume_status: string;
      }>(
        `select events.payload->'decision'->>'value' as decision_value,
                events.resolution_source as event_resolution_source,
                audits.payload->>'resolutionSource' as resolution_source,
                events.resume_status
           from harness_runtime.decision_events events
           join harness_runtime.audit_events audits
             on audits.workflow_id=events.task_id
            and audits.payload->>'eventId'=events.payload->>'id'
          where events.task_id=$1
            and events.resolution_source='core_timeout'`,
        [coreRuntimeId],
      );
      assert.deepEqual(coreTimeout.rows[0], {
        decision_value: '超时未作答，已按通用口径继续',
        event_resolution_source: 'core_timeout',
        resolution_source: 'core_timeout',
        resume_status: 'sent',
      });
      await assert.doesNotReject(
        new PostgresOperationsRepository(pool).assertTaskHasNoPendingQuestion(
          workspaceId,
          coreTaskId,
        ),
      );
      await assert.doesNotReject(
        new PostgresOperationsRepository(pool).assertTaskHasNoPendingQuestion(
          workspaceId,
          holdTaskId,
        ),
      );
    } finally {
      await pool.query(
        `delete from harness_runtime.langfuse_outbox
          where audit_id in (
            select id from harness_runtime.audit_events
             where workflow_id=any($1::text[])
          )`,
        [[browserRuntimeId, coreRuntimeId, holdRuntimeId]],
      );
      for (const table of [
        'audit_events',
        'decision_traces',
        'decision_events',
        'pending_questions',
        'task_requests',
      ]) {
        await pool.query(
          `delete from harness_runtime.${table} where ${
            table === 'audit_events' ? 'workflow_id' : 'task_id'
          }=any($1::text[])`,
          [[browserRuntimeId, coreRuntimeId, holdRuntimeId]],
        );
      }
      await pool.end();
    }
  },
);

test(
  'Postgres harness store resumes migrated legacy runtime identities',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    await store.applySchema();
    const taskId = `legacy-harness-${randomUUID()}`;
    const request = taskRequest(taskId);
    const { taskId: _taskId, ...workflowRequest } = request;
    const fingerprint = fingerprintValue(workflowRequest);
    const questionId = `legacy-question-${randomUUID()}`;
    const runtimeIds: Array<string | undefined> = [];

    try {
      await pool.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request)
         values ($1,$1,$1,$2,$3::jsonb)`,
        [taskId, fingerprint, JSON.stringify(workflowRequest)],
      );
      await pool.query(
        `insert into harness_runtime.pending_questions
           (task_id, question_id, workflow_revision, payload, status)
         values ($1,$2,4,$3::jsonb,'pending')`,
        [
          taskId,
          questionId,
          JSON.stringify({
            questionId,
            workflowId: taskId,
            workflowRevision: 4,
            question: '当前团购价是多少？',
            options: [],
            freeText: { enabled: true },
            response: {
              field: 'offer_price',
              reason: '补充当前任务所需的权威事实',
            },
            scope: 'current_task',
          }),
        ],
      );
      const admission = new HarnessTaskAdmissionService(store, {
        async start(input) {
          runtimeIds.push(input.runtimeId);
          return { workflowId: input.workflowId };
        },
      });
      assert.deepEqual(await admission.submit(request), {
        workflowId: taskId,
        replayed: true,
      });
      assert.deepEqual(runtimeIds, [taskId]);
      await assert.rejects(
        admission.submit({
          ...request,
          factScope: {
            storeId: request.workspaceId,
            serviceId: 'scalp-clean',
          },
        }),
        /different harness request payload/u,
      );
      assert.equal(
        await store.workflowRuntimeId(request.workspaceId, taskId),
        taskId,
      );
      assert.equal(
        (await store.readPending(request.workspaceId, taskId))?.questionId,
        questionId,
      );
      const scoped = harnessRuntimeId(request.workspaceId, taskId);
      assert.equal(
        (
          await pool.query(
            `select count(*)::int as count
             from harness_runtime.task_requests where task_id=$1`,
            [scoped],
          )
        ).rows[0]?.count,
        0,
      );

      const decisions = new HarnessDecisionService(store, {
        async resume(workspaceId, workflowId) {
          assert.equal(workspaceId, request.workspaceId);
          assert.equal(workflowId, taskId);
        },
      });
      await decisions.submit(
        request.workspaceId,
        taskId,
        decisionInput(questionId),
      );
      const legacyDecision = await pool.query(
        `select task_id, id from harness_runtime.decision_events
         where task_id=$1`,
        [taskId],
      );
      assert.equal(legacyDecision.rows[0]?.task_id, taskId);
      assert.match(legacyDecision.rows[0]?.id ?? '', /^event-/u);
    } finally {
      await pool.query(
        `delete from harness_runtime.langfuse_outbox
         where audit_id in (
           select id from harness_runtime.audit_events where workflow_id=$1
         )`,
        [taskId],
      );
      await pool.query(
        `delete from harness_runtime.audit_events where workflow_id=$1`,
        [taskId],
      );
      await pool.query(
        `delete from harness_runtime.decision_traces where task_id=$1`,
        [taskId]
      );
      await pool.query(
        `delete from harness_runtime.decision_events where task_id=$1`,
        [taskId],
      );
      await pool.query(
        `delete from harness_runtime.pending_questions where task_id=$1`,
        [taskId],
      );
      await pool.query(
        `delete from harness_runtime.task_requests where task_id=$1`,
        [taskId],
      );
      await pool.end();
    }
  }
);

test(
  'active tasks are the ones still worth returning to, not everything from the last day',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    await store.applySchema();
    const suffix = randomUUID();
    const workspaceId = `active-tasks-${suffix}`;
    const runningTaskId = `running-${suffix}`;
    const deliveredTaskId = `delivered-${suffix}`;
    const cancelledTaskId = `cancelled-${suffix}`;
    const runtimeIdFor = (taskId: string) =>
      harnessRuntimeId(workspaceId, taskId);
    const decisions = new HarnessDecisionService(store, {
      async resume() {},
      async startSuccessor() {},
    });
    const seed = async (taskId: string, rawInput: string) => {
      await pool.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request)
         values ($1,$2,$1,$3,$4::jsonb)`,
        [
          runtimeIdFor(taskId),
          taskId,
          `fingerprint-${taskId}`,
          JSON.stringify({
            workspaceId,
            actorId: 'owner-1',
            packageId: `package-${taskId}`,
            rawInput,
            executionSnapshot: { work: { id: `work-${taskId}` } },
          }),
        ],
      );
    };

    try {
      await seed(runningTaskId, '还在跑的这条');
      await seed(deliveredTaskId, '已经交付的这条');
      await seed(cancelledTaskId, '确认卡超时被取消的这条');

      await pool.query(
        `insert into harness_runtime.audit_events
           (id, workflow_id, stage, event_type, payload)
         values ($1,$2,'assembly_delivery','package_delivered','{}'::jsonb)`,
        [`audit-delivered-${suffix}`, runtimeIdFor(deliveredTaskId)],
      );

      // The cancellation is written through the production seam, so the query
      // is matched against what really lands rather than a shape invented here.
      const questionId = `${cancelledTaskId}:offer-price`;
      await store.registerPending(workspaceId, {
        questionId,
        workflowId: cancelledTaskId,
        workflowRevision: 4,
        question: '当前团购价是多少？',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: '补充当前任务所需的权威事实',
        },
        unattended: 'hold',
        scope: 'current_task',
      });
      await decisions.submitCoreHoldExpired(
        workspaceId,
        cancelledTaskId,
        ignoredDecision(
          questionId,
          `${questionId}:r4:core_hold_expired`,
          '超时未选择，本次任务已取消，额度已退回',
        ),
      );

      // A cancelled run settles as a refund and returns normally, so it writes
      // no failure event — without its own exclusion it would be dragged back
      // into the composer on every mount for 24 hours.
      assert.deepEqual(
        (await store.listActiveTasks(workspaceId)).map(
          ({ taskId, merchantText }) => ({ taskId, merchantText }),
        ),
        [{ taskId: runningTaskId, merchantText: '还在跑的这条' }],
      );
    } finally {
      const runtimeIds = [
        runtimeIdFor(runningTaskId),
        runtimeIdFor(deliveredTaskId),
        runtimeIdFor(cancelledTaskId),
      ];
      await pool.query(
        `delete from harness_runtime.langfuse_outbox
          where audit_id in (
            select id from harness_runtime.audit_events
             where workflow_id=any($1::text[]))`,
        [runtimeIds],
      );
      await pool.query(
        `delete from harness_runtime.audit_events where workflow_id=any($1::text[])`,
        [runtimeIds],
      );
      for (const table of [
        'decision_events',
        'decision_traces',
        'pending_questions',
        'task_requests',
      ]) {
        await pool.query(
          `delete from harness_runtime.${table} where task_id=any($1::text[])`,
          [runtimeIds],
        );
      }
      await pool.end();
    }
  },
);

function taskRequest(taskId: string) {
  return {
    taskId,
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 2,
    workflowRevision: 4,
    creationMode: 'customized' as const,
    rawInput: '把新团购做一套能发的',
    intent: {
      context: {
        workId: 'work-1',
        intent: '把新团购做一套能发的',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
}

function ignoredDecision(
  questionId: string,
  idempotencyKey: string,
  value: string,
) {
  return {
    idempotencyKey,
    questionId,
    workflowRevision: 4,
    patch: {
      field: 'offer_price',
      value,
      reason: '补充当前任务所需的权威事实',
    },
    decision: { state: 'ignored' as const, value },
  };
}

function acceptedDecision(questionId: string, value: string) {
  return {
    idempotencyKey: `merchant-${randomUUID()}`,
    questionId,
    workflowRevision: 4,
    patch: {
      field: 'offer_price',
      value,
      reason: '补充当前任务所需的权威事实',
    },
    decision: { state: 'accepted' as const, value },
  };
}

async function successorBillingRows(pool: Pool, workspaceId: string) {
  const result = await pool.query<{
    quotes: number;
    reservations: number;
    submissions: number;
  }>(
    `select
       (select count(*)::int
          from execution_spine.creation_submissions
         where workspace_id=$1) as submissions,
       (select count(*)::int
          from p1_product_billing_quotes
         where workspace_id=$1) as quotes,
       (select count(*)::int
          from p1_product_billing_usage
         where workspace_id=$1) as reservations`,
    [workspaceId],
  );
  return result.rows[0];
}

function decisionInput(questionId: string) {
  return {
    idempotencyKey: 'decision-1',
    questionId,
    workflowRevision: 4,
    patch: {
      field: 'offer_price',
      value: '当前团购价 398 元',
      reason: '补充当前任务所需的权威事实',
    },
    decision: {
      state: 'accepted' as const,
      value: '当前团购价 398 元',
    },
  };
}
