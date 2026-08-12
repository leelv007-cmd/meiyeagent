import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AGENT_PRIMITIVE_IDS } from '@meiye/contracts';
import { Pool } from 'pg';

import { AgentPrimitiveDurableTracePort } from '../agent-primitives/durable-trace-port.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { PostgresGrantLotLedger } from '../foundation/postgres-grant-lot.js';
import {
  PostgresCreationSubmissionPersistence,
  PostgresCreationSubmissionStore,
  PostgresProductBillingUsageReservation,
} from '../execution-spine/postgres-creation-submission-store.js';
import { PostgresOperationsRepository } from '../operations/postgres-repository.js';
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import { AgentPrimitiveObservabilityAdapter } from '../creation-experience/agent-primitive-observability.js';
import { HarnessObservabilityEventAudit } from '../creation-experience/observability-events.js';
import { HarnessDecisionService } from './decision-service.js';
import { PostgresHarnessResumeReconcilerStore } from './postgres-resume-reconciler-store.js';
import { PostgresHarnessStore } from './postgres-store.js';
import { harnessRuntimeId } from './workspace-scope.js';
import {
  HarnessTaskAdmissionService,
  type HarnessWorkflowInput,
} from './task-admission.js';
import {
  HARNESS_LANGFUSE_PROMPT_NAMES,
  LangfuseHarnessPromptResolver,
  type HarnessFrozenPrompts,
} from './langfuse-prompts.js';

const connectionString = process.env.TEST_DATABASE_URL;

// registerPending writes into operations-owned p1_content_packages and the
// compensation store joins execution_spine.creation_submissions; app boot owns
// both migrations, so a provisioned-but-never-booted database lacks them.
test.before(async () => {
  if (!connectionString) return;
  const pool = new Pool({ connectionString });
  try {
    await new PostgresOperationsRepository(pool).migrate();
    await new PostgresProductBillingRepository(pool).migrate();
    await new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(
          pool,
          new PostgresGrantLotLedger(pool),
        ),
      ),
    ).migrate();
  } finally {
    await pool.end();
  }
});

test(
  'Postgres harness schema backfills legacy failed dead letters',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const auditId = `legacy-dead-letter-${randomUUID()}`;
    try {
      await store.applySchema();
      await pool.query(
        `insert into harness_runtime.audit_events
           (id, workflow_id, stage, event_type, payload)
         values ($1, 'legacy-workflow', 'execution_selection', 'legacy', '{}'::jsonb)`,
        [auditId],
      );
      await pool.query(
        `insert into harness_runtime.langfuse_outbox
           (audit_id, status, dead_lettered_at)
         values ($1, 'failed', now())`,
        [auditId],
      );

      await store.applySchema();
      const migrated = await pool.query<{ status: string }>(
        `select status from harness_runtime.langfuse_outbox where audit_id=$1`,
        [auditId],
      );
      assert.equal(migrated.rows[0]?.status, 'dead_letter');
    } finally {
      await pool.query('delete from harness_runtime.audit_events where id=$1', [
        auditId,
      ]);
      await pool.end();
    }
  },
);

test(
  'Postgres observability audit replays exact payloads and rejects identity conflicts',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const taskId = `observability-idempotency-${randomUUID()}`;
    const workspaceId = 'workspace-1';
    const runtimeTaskId = harnessRuntimeId(workspaceId, taskId);

    try {
      await store.applySchema();
      await new HarnessTaskAdmissionService(store, {
        async start({ workflowId }) {
          return { workflowId };
        },
      }).submit(taskRequest(taskId));
      const adapter = new AgentPrimitiveObservabilityAdapter(
        new HarnessObservabilityEventAudit(store),
        {
          resolve() {
            return { kind: 'not_billed' };
          },
        },
      );
      const rootInput = {
        context: {
          workspaceId,
          userId: 'worker-a',
          correlationId: 'corr-assembly',
          actor: 'worker' as const,
        },
        taskId,
        primitiveId: 'harness-assembly:event_persistence',
        baseIdempotencyKey: 'harness-assembly-event-persistence',
        axes: {
          axisScope: 'task_root',
          skillRevision: { kind: 'absent' },
          promptVersion: { kind: 'absent' },
          catalogRevision: {
            kind: 'bound',
            value: 'catalog-r1',
          },
          scene: {
            kind: 'bound',
            value: 'recipe-card-group',
          },
        } as const,
      };
      await Promise.all([
        adapter.append({ ...rootInput, phase: 'succeeded' }),
        adapter.append({ ...rootInput, phase: 'succeeded' }),
      ]);
      await assert.rejects(
        adapter.append({
          ...rootInput,
          axes: {
            ...rootInput.axes,
            catalogRevision: {
              kind: 'bound',
              value: 'catalog-conflict',
            },
          },
          phase: 'succeeded',
        }),
        (error: unknown) =>
          error instanceof Error &&
          error.name === 'TaskRootObservabilityConflictError',
      );
      const input = {
        context: {
          workspaceId,
          userId: 'worker-a',
          correlationId: 'corr-primitive',
          actor: 'worker' as const,
        },
        taskId,
        primitiveId: 'generate',
        baseIdempotencyKey: 'primitive-call-terminal',
        axes: {
          axisScope: 'execution_child',
          skillRevision: { kind: 'absent' },
          promptVersion: { kind: 'absent' },
          catalogRevision: { kind: 'absent' },
          scene: { kind: 'absent' },
        } as const,
      };

      const exactReplays = await Promise.all([
        adapter.append({ ...input, phase: 'succeeded' }),
        adapter.append({ ...input, phase: 'succeeded' }),
      ]);
      assert.equal(
        exactReplays[0]?.idempotencyKey,
        exactReplays[1]?.idempotencyKey,
      );
      const conflictingTerminals = await Promise.allSettled([
        adapter.append({ ...input, phase: 'succeeded' }),
        adapter.append({
          ...input,
          phase: 'rejected',
          rejectionClass: 'execution_failed',
        }),
      ]);
      assert.deepEqual(
        conflictingTerminals.map(({ status }) => status).sort(),
        ['fulfilled', 'rejected'],
      );
      const rejection = conflictingTerminals.find(
        ({ status }) => status === 'rejected',
      );
      assert.match(
        String(rejection?.status === 'rejected' ? rejection.reason : undefined),
        /idempotency conflict/i,
      );

      const persisted = await pool.query<{
        audits: number;
        outbox: number;
        phase: string;
      }>(
        `select
           (select count(*)::int
              from harness_runtime.audit_events
             where workflow_id=$1 and event_type='agent_primitive.lifecycle')
             as audits,
           (select count(*)::int
              from harness_runtime.langfuse_outbox outbox
              join harness_runtime.audit_events audit
                on audit.id=outbox.audit_id
             where audit.workflow_id=$1
               and audit.event_type='agent_primitive.lifecycle')
             as outbox,
           (select payload->'payload'->>'phase'
              from harness_runtime.audit_events
             where workflow_id=$1
               and event_type='agent_primitive.lifecycle'
               and payload->'payload'->>'primitiveId'='generate')
             as phase`,
        [runtimeTaskId],
      );
      assert.deepEqual(persisted.rows[0], {
        audits: 2,
        outbox: 2,
        phase: 'succeeded',
      });
      const root = await pool.query<{
        audits: number;
        outbox: number;
        skill_revision: string | null;
        prompt_version: string | null;
        catalog_revision: string;
        scene: string;
      }>(
        `select
           count(*)::int as audits,
           count(outbox.audit_id)::int as outbox,
           min(audit.payload->>'skillRevision') as skill_revision,
           min(audit.payload->>'promptVersion') as prompt_version,
           min(audit.payload->>'catalogRevision') as catalog_revision,
           min(audit.payload->>'scene') as scene
         from harness_runtime.audit_events audit
         left join harness_runtime.langfuse_outbox outbox
           on outbox.audit_id=audit.id
         where audit.workflow_id=$1
           and audit.event_type='agent_primitive.lifecycle'
           and audit.payload->>'axisScope'='task_root'`,
        [runtimeTaskId],
      );
      assert.deepEqual(root.rows[0], {
        audits: 1,
        outbox: 1,
        skill_revision: null,
        prompt_version: null,
        catalog_revision: 'catalog-r1',
        scene: 'recipe-card-group',
      });
    } finally {
      await pool.query(
        `delete from harness_runtime.audit_events
          where workflow_id=$1
            and event_type='agent_primitive.lifecycle'`,
        [runtimeTaskId],
      );
      await pool.query(
        'delete from harness_runtime.task_requests where task_id=$1',
        [runtimeTaskId],
      );
      await pool.end();
    }
  },
);

test(
  'all six primitive lifecycles persist idempotently to Postgres audit and outbox',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const taskId = `primitive-durable-trace-${randomUUID()}`;
    const workspaceId = 'workspace-1';
    const runtimeTaskId = harnessRuntimeId(workspaceId, taskId);
    const port = new AgentPrimitiveDurableTracePort(
      new HarnessObservabilityEventAudit(store),
    );
    const serverContext = {
      actorId: 'primitive-postgres-worker',
      correlationId: `correlation-${taskId}`,
      idempotencyKey: '',
      observability: {
        axisScope: 'execution_child' as const,
        skillRevision: { kind: 'absent' as const },
        promptVersion: {
          kind: 'bound' as const,
          value: 'harness/copy-candidate@7',
        },
        catalogRevision: {
          kind: 'bound' as const,
          value: 'catalog-r7',
        },
        scene: {
          kind: 'bound' as const,
          value: 'harness:copy',
        },
      },
      taskId,
      workspaceId,
    };

    try {
      await store.applySchema();
      await new HarnessTaskAdmissionService(store, {
        async start({ workflowId }) {
          return { workflowId };
        },
      }).submit(taskRequest(taskId));

      for (const primitiveId of AGENT_PRIMITIVE_IDS) {
        const context = {
          ...serverContext,
          idempotencyKey: `primitive-postgres-${primitiveId}`,
          ...(primitiveId === 'generate' || primitiveId === 'revise'
            ? {
                billing: {
                  productUsageTaskId: `usage-${primitiveId}`,
                  quoteId: `quote-${primitiveId}`,
                },
              }
            : {}),
        };
        await port.append({
          phase: 'invoked',
          primitiveId,
          serverContext: context,
        });
        await port.append({
          phase: 'succeeded',
          primitiveId,
          serverContext: context,
        });
        await port.append({
          phase: 'succeeded',
          primitiveId,
          serverContext: context,
        });
      }
      await assert.rejects(
        port.append({
          phase: 'rejected',
          primitiveId: 'check',
          rejectionClass: 'execution_failed',
          serverContext: {
            ...serverContext,
            idempotencyKey: 'primitive-postgres-check',
          },
        }),
        /idempotency conflict/iu,
      );

      const persisted = await pool.query<{
        payload: unknown;
        primitive_id: string;
        phase: string;
        outbox: number;
      }>(
        `select
           audit.payload,
           audit.payload->'payload'->>'primitiveId' as primitive_id,
           audit.payload->'payload'->>'phase' as phase,
           count(outbox.audit_id)::int as outbox
         from harness_runtime.audit_events audit
         left join harness_runtime.langfuse_outbox outbox
           on outbox.audit_id=audit.id
         where audit.workflow_id=$1
           and audit.event_type='agent_primitive.lifecycle'
         group by audit.id
         order by primitive_id, phase`,
        [runtimeTaskId],
      );
      assert.equal(persisted.rowCount, 12);
      assert.equal(
        persisted.rows.reduce((count, row) => count + row.outbox, 0),
        12,
      );
      assert.deepEqual(
        [...new Set(persisted.rows.map(({ primitive_id }) => primitive_id))],
        [...AGENT_PRIMITIVE_IDS].sort(),
      );
      for (const primitiveId of AGENT_PRIMITIVE_IDS) {
        assert.deepEqual(
          persisted.rows
            .filter(({ primitive_id }) => primitive_id === primitiveId)
            .map(({ phase }) => phase)
            .sort(),
          ['invoked', 'succeeded'],
        );
      }
      assert.equal(
        JSON.stringify(persisted.rows.map(({ payload }) => payload)).includes(
          '"error"',
        ),
        false,
      );
    } finally {
      await pool.query(
        `delete from harness_runtime.audit_events
          where workflow_id=$1
            and event_type='agent_primitive.lifecycle'`,
        [runtimeTaskId],
      );
      await pool.query(
        'delete from harness_runtime.task_requests where task_id=$1',
        [runtimeTaskId],
      );
      await pool.end();
    }
  },
);

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
        /different harness request payload/u,
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
        (await store.readDecisionTarget(workspaceId, taskId))?.timeoutSeconds,
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
      const claimed = await store.claimLangfuseBatch(3);
      assert.equal(claimed.length, 3);
      const ownAuditIds = claimed.map((item) => item.auditId);
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
        new Date(0),
      );
      const retried = await store.claimLangfuseBatch(1);
      const retriedItem = retried.find(
        (item) => item.auditId === failedItem.auditId,
      );
      assert.ok(retriedItem);
      assert.equal(retriedItem.attempts, 2);
      await store.markLangfuseSent(retriedItem.auditId);
      assert.equal(
        (await store.claimLangfuseBatch(ownAuditIds.length)).some(
          (item) => item.auditId === retriedItem.auditId,
        ),
        false,
      );
      await store.markLangfuseFailed(
        deadLetterItem.auditId,
        'temporary failure',
        new Date(0),
      );
      for (
        let expectedAttempts = 2;
        expectedAttempts < 8;
        expectedAttempts += 1
      ) {
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
        [
          {
            signal: 'trace',
            reason: 'transient',
            count: 1,
            source: 'langfuse_outbox',
          },
        ],
      );
      const afterDeadLetter = await store.claimLangfuseBatch(
        ownAuditIds.length,
      );
      assert.equal(
        afterDeadLetter.some((item) => item.auditId === deadLetterItem.auditId),
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
  'prompt fallback audit reaches PostgreSQL without prompt content',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const taskId = `prompt-fallback-${randomUUID()}`;
    const workspaceId = 'workspace-1';
    const runtimeTaskId = harnessRuntimeId(workspaceId, taskId);
    const contentHash = 'f'.repeat(64);
    const startedRequests: HarnessWorkflowInput[] = [];
    let promptFailure: Error | undefined;
    await store.applySchema();
    const admission = new HarnessTaskAdmissionService(
      store,
      {
        async start({ workflowId, request }) {
          startedRequests.push(structuredClone(request));
          return { workflowId };
        },
      },
      {
        async resolve() {
          if (promptFailure) throw promptFailure;
          const prompts = Object.fromEntries(
            Object.entries(HARNESS_LANGFUSE_PROMPT_NAMES).map(([key, name]) => [
              key,
              {
                name,
                version: '7',
                content: `private pinned prompt content for ${key}`,
                contentHash: 'e'.repeat(64),
                label: 'production',
                source: 'langfuse',
                isFallback: false,
              },
            ]),
          ) as HarnessFrozenPrompts;
          return {
            ...prompts,
            intentNaming: {
              name: 'harness/intent-naming',
              version: 'builtin-v1',
              content: 'private builtin prompt content',
              contentHash,
              label: 'production',
              source: 'builtin',
              isFallback: true,
              fallbackReason: 'request_failed',
            },
            briefCompilation: {
              name: 'harness/brief-copy',
              version: '7',
              content: 'private pinned prompt content',
              contentHash: 'e'.repeat(64),
              label: 'production',
              source: 'langfuse',
              isFallback: false,
            },
          };
        },
      },
      store,
    );

    try {
      await admission.submit({
        ...taskRequest(taskId),
        workspaceId,
      });
      promptFailure = new Error('Langfuse unavailable after admission');
      assert.equal(
        (
          await admission.submit({
            ...taskRequest(taskId),
            workspaceId,
          })
        ).replayed,
        true,
      );
      assert.equal(
        startedRequests[1]?.prompts?.intentNaming.content,
        'private builtin prompt content',
      );
      const [audit] = await store.claimLangfuseBatch(1);
      assert.ok(audit);
      assert.equal(audit.eventType, 'langfuse_prompt_fallback');
      assert.deepEqual(audit.payload, {
        promptKey: 'intentNaming',
        name: 'harness/intent-naming',
        version: 'builtin-v1',
        contentHash,
        fallbackReason: 'request_failed',
        prompt: {
          name: 'harness/intent-naming',
          version: 'builtin-v1',
          contentHash,
          label: 'production',
          source: 'builtin',
          isFallback: true,
          fallbackReason: 'request_failed',
        },
      });
      assert.equal(
        JSON.stringify(audit.payload).includes('private builtin prompt content'),
        false,
      );
    } finally {
      await pool.query(
        `delete from harness_runtime.langfuse_outbox
          where audit_id in (
            select id from harness_runtime.audit_events
             where workflow_id=$1)`,
        [runtimeTaskId],
      );
      await pool.query(
        'delete from harness_runtime.audit_events where workflow_id=$1',
        [runtimeTaskId],
      );
      await pool.query(
        'delete from harness_runtime.task_requests where task_id=$1',
        [runtimeTaskId],
      );
      await pool.end();
    }
  },
);

test(
  'detached prompt audit reaches PostgreSQL and outbox without a Harness task request',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const workspaceId = `prompt-audit-${suffix}`;
    const workflowId = `canvas-text-${suffix}`;
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const contentHash = 'd'.repeat(64);
    await store.applySchema();

    try {
      await store.appendPromptAudit({
        workspaceId,
        id: `audit-${workflowId}-prompt-fallback-textResponse-${contentHash}`,
        workflowId,
        stage: 'prompt_resolution',
        eventType: 'langfuse_prompt_fallback',
        payload: {
          promptKey: 'textResponse',
          prompt: {
            name: 'harness/text-response',
            version: 'builtin-v1',
            content: 'private prompt content',
            contentHash,
            label: 'production',
            source: 'builtin',
            isFallback: false,
            fallbackReason: 'request_failed',
          },
          untrusted: 'must not persist',
        },
      } as Parameters<PostgresHarnessStore['appendPromptAudit']>[0]);

      const [persisted] = await store.claimLangfuseBatch(1);
      assert.ok(persisted);
      assert.equal(persisted.eventType, 'langfuse_prompt_fallback');
      assert.equal(
        await store.taskBelongsToWorkspace(workflowId, workspaceId),
        false,
      );
      assert.equal(
        JSON.stringify(persisted.payload).includes('private prompt content'),
        false,
      );
      assert.deepEqual(persisted.payload, {
        promptKey: 'textResponse',
        prompt: {
          name: 'harness/text-response',
          version: 'builtin-v1',
          contentHash,
          label: 'production',
          source: 'builtin',
          isFallback: true,
          fallbackReason: 'request_failed',
        },
      });
    } finally {
      await pool.query(
        `delete from harness_runtime.langfuse_outbox
          where audit_id in (
            select id from harness_runtime.audit_events
             where workflow_id=$1)`,
        [runtimeWorkflowId],
      );
      await pool.query(
        'delete from harness_runtime.audit_events where workflow_id=$1',
        [runtimeWorkflowId],
      );
      await pool.end();
    }
  },
);

test(
  'local Langfuse HTTP 503 persists pilot fallbacks before Harness workflow start',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    let promptRequests = 0;
    const server = createServer((_request, response) => {
      promptRequests += 1;
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'local test outage' }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    const { port } = server.address() as AddressInfo;
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const workspaceId = `prompt-503-${suffix}`;
    const taskId = `prompt-503-task-${suffix}`;
    const runtimeTaskId = harnessRuntimeId(workspaceId, taskId);
    const promptCount = Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length;
    let workflowStarts = 0;
    await store.applySchema();
    const admission = new HarnessTaskAdmissionService(
      store,
      {
        async start({ workflowId }) {
          const persisted = await store.claimLangfuseBatch(promptCount);
          assert.equal(persisted.length, promptCount);
          for (const item of persisted) {
            assert.equal(item.eventType, 'langfuse_prompt_fallback');
            const payload = item.payload as Record<string, unknown>;
            const prompt = payload.prompt as Record<string, unknown>;
            assert.equal(Object.hasOwn(prompt, 'content'), false);
            assert.equal(prompt.source, 'builtin');
            assert.equal(prompt.isFallback, true);
            assert.equal(prompt.fallbackReason, 'http_503');
          }
          workflowStarts += 1;
          return { workflowId };
        },
      },
      new LangfuseHarnessPromptResolver({
        baseUrl: `http://127.0.0.1:${port}`,
        publicKey: 'pk-local-503',
        secretKey: 'sk-local-503',
        policy: 'pilot',
        versions: Object.fromEntries(
          Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).map((key) => [key, 9]),
        ),
        warn() {},
      }),
      store,
    );

    try {
      const result = await admission.submit({
        ...taskRequest(taskId),
        workspaceId,
      });
      assert.deepEqual(result, { workflowId: taskId, replayed: false });
      assert.equal(promptRequests, promptCount);
      assert.equal(workflowStarts, 1);
    } finally {
      await pool.query(
        `delete from harness_runtime.langfuse_outbox
          where audit_id in (
            select id from harness_runtime.audit_events
             where workflow_id=$1)`,
        [runtimeTaskId],
      );
      await pool.query(
        'delete from harness_runtime.audit_events where workflow_id=$1',
        [runtimeTaskId],
      );
      await pool.query(
        'delete from harness_runtime.task_requests where runtime_id=$1',
        [runtimeTaskId],
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
          '超时未选择，本次任务已取消，积分已退回',
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
            idempotency_keys: [`${browserTaskId}:offer-price:r4:timed_out`],
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
  'Postgres decision resume leases recover sending rows and fence stale owners',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const workspaceId = `resume-lease-${suffix}`;
    const taskId = `task-${suffix}`;
    const runtimeId = harnessRuntimeId(workspaceId, taskId);
    const questionId = `question-${suffix}`;

    try {
      await store.applySchema();
      await new HarnessTaskAdmissionService(store, {
        async start({ workflowId }) {
          return { workflowId };
        },
      }).submit({ ...taskRequest(taskId), workspaceId });
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
      await assert.rejects(
        new HarnessDecisionService(store, {
          async resume() {
            throw new Error('simulated process boundary');
          },
        }).submit(workspaceId, taskId, decisionInput(questionId)),
      );
      const event = await pool.query<{ id: string; logical_id: string }>(
        `SELECT id, payload->>'id' AS logical_id
         FROM harness_runtime.decision_events WHERE task_id=$1`,
        [runtimeId],
      );
      const eventId = event.rows[0]?.id;
      const logicalEventId = event.rows[0]?.logical_id;
      assert.ok(eventId);
      assert.ok(logicalEventId);

      const concurrentClaims = await Promise.all([
        new PostgresHarnessResumeReconcilerStore(pool).claimPending(1),
        new PostgresHarnessResumeReconcilerStore(pool).claimPending(1),
      ]);
      const claimed = concurrentClaims.flat();
      assert.equal(claimed.length, 1);
      assert.equal(claimed[0]?.eventId, eventId);
      const oldClaimId = claimed[0]?.claimId;
      assert.ok(oldClaimId);
      assert.equal(
        await store.claimDecisionResume(
          workspaceId,
          taskId,
          logicalEventId,
          'claim-new',
        ),
        false,
      );
      await pool.query(
        `UPDATE harness_runtime.decision_events
         SET resume_lease_expires_at=clock_timestamp() - interval '1 second'
         WHERE id=$1`,
        [eventId],
      );
      assert.equal(
        await store.claimDecisionResume(
          workspaceId,
          taskId,
          logicalEventId,
          'claim-new',
        ),
        true,
      );
      await store.releaseDecisionResume(
        workspaceId,
        taskId,
        logicalEventId,
        oldClaimId,
      );
      await store.markDecisionResumed(
        workspaceId,
        taskId,
        logicalEventId,
        oldClaimId,
      );
      const stillOwned = await pool.query<{
        resume_claim_id: string;
        resume_status: string;
      }>(
        `SELECT resume_claim_id, resume_status
         FROM harness_runtime.decision_events WHERE id=$1`,
        [eventId],
      );
      assert.deepEqual(stillOwned.rows[0], {
        resume_claim_id: 'claim-new',
        resume_status: 'sending',
      });
      await store.markDecisionResumed(
        workspaceId,
        taskId,
        logicalEventId,
        'claim-new',
      );
      assert.equal(
        (
          await pool.query<{ resume_status: string }>(
            `SELECT resume_status
             FROM harness_runtime.decision_events WHERE id=$1`,
            [eventId],
          )
        ).rows[0]?.resume_status,
        'sent',
      );
    } finally {
      await pool.query(
        `DELETE FROM harness_runtime.langfuse_outbox
         WHERE audit_id IN (
           SELECT id FROM harness_runtime.audit_events WHERE workflow_id=$1
         )`,
        [runtimeId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.audit_events WHERE workflow_id=$1',
        [runtimeId],
      );
      for (const table of [
        'decision_traces',
        'decision_events',
        'pending_questions',
        'task_requests',
      ]) {
        await pool.query(
          `DELETE FROM harness_runtime.${table} WHERE task_id=$1`,
          [runtimeId],
        );
      }
      await pool.end();
    }
  },
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
    const seed = async (
      taskId: string,
      rawInput: string,
      composerAuthority?: {
        agentThreadId: string;
        agentRunId: string;
        executionConfirmationRequestId: string;
      },
    ) => {
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
            ...composerAuthority,
          }),
        ],
      );
    };

    try {
      await seed(runningTaskId, '还在跑的这条', {
        agentThreadId: `thread-${suffix}`,
        agentRunId: `run-${suffix}`,
        executionConfirmationRequestId: `confirmation-${suffix}`,
      });
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
          '超时未选择，本次任务已取消，积分已退回',
        ),
      );

      // A cancelled run settles as a refund and returns normally, so it writes
      // no failure event — without its own exclusion it would be dragged back
      // into the composer on every mount for 24 hours.
      const activeTasks = await store.listActiveTasks(workspaceId);
      assert.deepEqual(
        activeTasks.map(
          ({ taskId, merchantText }) => ({ taskId, merchantText }),
        ),
        [{ taskId: runningTaskId, merchantText: '还在跑的这条' }],
      );
      assert.deepEqual(
        activeTasks[0] && {
          agentThreadId: activeTasks[0].agentThreadId,
          agentRunId: activeTasks[0].agentRunId,
          executionConfirmationRequestId:
            activeTasks[0].executionConfirmationRequestId,
        },
        {
          agentThreadId: `thread-${suffix}`,
          agentRunId: `run-${suffix}`,
          executionConfirmationRequestId: `confirmation-${suffix}`,
        },
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

// V31-55 group②: composerPreparedAttemptId() mints a suffixed workflow id
// (`${bareTaskId}:plan-r${revision}`) for a merchant_confirmed prepared
// attempt, distinct from the bare taskId the merchant-facing client (and
// its interaction/decision polling) actually knows. workflowRuntimeId's
// lookup only matched task_id/workflow_id, neither of which is the bare id
// once a plan has gone through a paid confirmation attempt — so a merchant
// polling by the bare id got HARNESS_TASK_NOT_FOUND even though the
// attempt's pending interaction was sitting right there under sourceTaskId.
test(
  'workflowRuntimeId resolves a prepared attempt by the bare merchant taskId via sourceTaskId',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    await store.applySchema();
    const suffix = randomUUID();
    const workspaceId = `sourcetask-${suffix}`;
    const otherWorkspaceId = `sourcetask-other-${suffix}`;
    const bareTaskId = `composer-task:${suffix}`;
    const attemptId = `${bareTaskId}:plan-r1`;
    const runtimeId = harnessRuntimeId(workspaceId, attemptId);

    const seedAttempt = async (
      workflowId: string,
      ownerWorkspaceId: string,
      sourceTaskId: string | undefined,
      createdAt: string,
    ) => {
      const runtime = harnessRuntimeId(ownerWorkspaceId, workflowId);
      await pool.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request, created_at)
         values ($1,$2,$1,$3,$4::jsonb,$5::timestamptz)`,
        [
          runtime,
          workflowId,
          `fingerprint-${workflowId}`,
          JSON.stringify({
            workspaceId: ownerWorkspaceId,
            actorId: 'owner-1',
            packageId: `package-${workflowId}`,
            rawInput: '把新团购做一套能发的',
            ...(sourceTaskId ? { sourceTaskId } : {}),
          }),
          createdAt,
        ],
      );
    };

    try {
      await seedAttempt(
        attemptId,
        workspaceId,
        bareTaskId,
        '2026-08-10T00:00:00.000Z',
      );

      // ① The bare merchant taskId must resolve the prepared attempt's
      // runtime id through the sourceTaskId arm.
      assert.equal(
        await store.workflowRuntimeId(workspaceId, bareTaskId),
        runtimeId,
      );
      assert.equal(
        await store.taskBelongsToWorkspace(bareTaskId, workspaceId),
        true,
      );

      // ② The suffixed attempt id must still resolve directly (the path the
      // Core-only curl discriminating experiment exercised and must not break).
      assert.equal(
        await store.workflowRuntimeId(workspaceId, attemptId),
        runtimeId,
      );

      // ③ Safety arm: the same bare id in a different workspace must not match.
      assert.equal(
        await store.workflowRuntimeId(otherWorkspaceId, bareTaskId),
        null,
      );
      assert.equal(
        await store.taskBelongsToWorkspace(bareTaskId, otherWorkspaceId),
        false,
      );

      // ④ A second, later prepared attempt for the same bare taskId (a
      // re-confirm after a plan revise) must win over the first — the
      // merchant is always polling for the current attempt, not whichever
      // one happened to be admitted first.
      const secondAttemptId = `${bareTaskId}:plan-r2`;
      const secondRuntimeId = harnessRuntimeId(workspaceId, secondAttemptId);
      await seedAttempt(
        secondAttemptId,
        workspaceId,
        bareTaskId,
        '2026-08-10T00:00:05.000Z',
      );
      assert.equal(
        await store.workflowRuntimeId(workspaceId, bareTaskId),
        secondRuntimeId,
      );
    } finally {
      await pool.query(
        `delete from harness_runtime.task_requests where task_id=any($1::text[])`,
        [
          [
            harnessRuntimeId(workspaceId, attemptId),
            harnessRuntimeId(workspaceId, `${bareTaskId}:plan-r2`),
          ],
        ],
      );
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
