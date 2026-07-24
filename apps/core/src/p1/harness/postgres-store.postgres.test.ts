import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
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

      await store.registerPending(workspaceId, {
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

      const resumed: string[] = [];
      const decisions = new HarnessDecisionService(store, {
        async resume(_workspaceId, _taskId, resumedCommand) {
          resumed.push(resumedCommand.questionId);
        },
      });
      const command = decisionInput(questionId);
      assert.equal(
        (await decisions.submit(workspaceId, taskId, command)).replayed,
        false,
      );
      assert.equal(
        (await decisions.submit(workspaceId, taskId, command)).replayed,
        true,
      );
      assert.equal(
        (await decisions.submit(otherWorkspaceId, taskId, command)).replayed,
        false,
      );
      assert.deepEqual(resumed, [questionId, questionId]);
      assert.equal(await store.readPending(workspaceId, taskId), null);
      assert.equal(await store.readPending(otherWorkspaceId, taskId), null);
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
      assert.ok(failedItem);
      assert.ok(sentItem);
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

function taskRequest(taskId: string) {
  return {
    taskId,
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 2,
    workflowRevision: 4,
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
