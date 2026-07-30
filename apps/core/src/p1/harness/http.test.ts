import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type {
  DiagnosticRun,
  QuestionCard,
  StructuredDecisionInput,
} from '@meiye/contracts';

import type { DiagnosticRepository } from '../../diagnostics/repository.js';
import { createCoreServer } from '../../server.js';
import { WorkflowEventApplicationService } from '../workflow-events.js';
import { TaskBlockingNodeConflictError } from '../operations/repository.js';
import { HarnessApplicationService } from './application-service.js';
import {
  HarnessDecisionService,
  type HarnessPendingDecisionProjection,
  type HarnessDecisionStore,
} from './decision-service.js';
import {
  HarnessTaskAdmissionService,
  type HarnessTaskRequestRegistry,
  type HarnessWorkflowInput,
} from './task-admission.js';

const diagnostics: DiagnosticRepository = {
  async create(run: DiagnosticRun) {
    return run;
  },
  async get() {
    return null;
  },
  async save(run: DiagnosticRun) {
    return run;
  },
};

test('memory harness registry rejects a question while the task has a pending approval', async () => {
  const registry = new MemoryHarnessStore({
    async hasPendingApproval(workspaceId, taskId) {
      return workspaceId === 'workspace-1' && taskId === 'task-http-1';
    },
  });

  await assert.rejects(
    registry.registerPending('workspace-1', question()),
    (error: unknown) =>
      error instanceof TaskBlockingNodeConflictError &&
      error.code === 'TASK_BLOCKING_NODE_CONFLICT' &&
      error.status === 409 &&
      error.message ===
        'Task task-http-1 already has a pending blocking node.',
  );
  assert.equal(await registry.readPending('workspace-1', 'task-http-1'), null);
});

test('harness HTTP boundary admits, reads and answers one authoritative question', async (t) => {
  const registry = new MemoryHarnessStore();
  let currentTimeoutSeconds = 29;
  const resumed: string[] = [];
  const successors: Array<{
    command: StructuredDecisionInput;
    workflowId: string;
  }> = [];
  let resumeAttempts = 0;
  const interactionCalls: unknown[] = [];
  const decisions = new HarnessDecisionService(registry, {
    async resume(_workspaceId, _taskId, command) {
      resumeAttempts += 1;
      if (resumeAttempts === 1) throw new Error('DBOS unavailable');
      resumed.push(command.questionId);
    },
    async startSuccessor({ command, workflowId }) {
      successors.push({ command, workflowId });
    },
  });
  const harnessService = new HarnessApplicationService(
    new HarnessTaskAdmissionService(registry, {
      async start({ workflowId }) {
        return { workflowId };
      },
    }),
    decisions,
    registry,
    registry,
    registry,
    {
      async readTimeoutSeconds() {
        return currentTimeoutSeconds;
      },
    },
    {
      async readForCarrier(workspaceId, taskId, carrier) {
        interactionCalls.push(['read', workspaceId, taskId, carrier]);
        return {
          requestId: 'interaction-http-1',
          runId: taskId,
          step: 'context_injection',
          revision: 1,
          kind: 'ask_merchant',
          questions: [
            {
              itemId: 'service',
              question: '这次主推哪个项目？',
              fallback: { kind: 'deferred' },
            },
          ],
          groupSkip: true,
          presentation: {
            carriers: ['conversation'],
            blocking: 'none',
            notification: 'none',
          },
        };
      },
      async ackRenderer(workspaceId, taskId, acknowledgement) {
        interactionCalls.push([
          'renderer',
          workspaceId,
          taskId,
          acknowledgement,
        ]);
      },
      async setEditing(workspaceId, taskId, input) {
        interactionCalls.push(['editing', workspaceId, taskId, input]);
      },
      async submit(workspaceId, answer) {
        interactionCalls.push(['submit', workspaceId, answer]);
        if (
          typeof answer === 'object' &&
          answer !== null &&
          'response' in answer &&
          (answer as { response?: { malformed?: boolean } }).response
            ?.malformed
        ) {
          return {
            kind: 'reask' as const,
            request: {
              requestId: 'interaction-http-1',
              runId: 'task-http-1',
              step: 'context_injection' as const,
              revision: 2,
              kind: 'ask_merchant' as const,
              questions: [
                {
                  itemId: 'service',
                  question: '这次主推哪个项目？',
                  fallback: { kind: 'deferred' as const },
                },
              ],
              groupSkip: true as const,
              presentation: {
                carriers: ['conversation' as const],
                blocking: 'none' as const,
                notification: 'none' as const,
              },
            },
          };
        }
        return { kind: 'resumed' as const, replayed: false };
      },
      async submitMerchantMessage(workspaceId, taskId, input) {
        interactionCalls.push(['message', workspaceId, taskId, input]);
        return { kind: 'resumed' as const, replayed: false };
      },
      async readWaitingMessageForCarrier(workspaceId, taskId, carrier) {
        interactionCalls.push([
          'read-message',
          workspaceId,
          taskId,
          carrier,
        ]);
        return null;
      },
    },
  );
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    harnessService,
    serviceToken: 'harness-http-token',
    workflowEvents: new WorkflowEventApplicationService([
      {
        owns: (workspaceId, workflowId) =>
          registry.taskBelongsToWorkspace(workflowId, workspaceId),
        async *stream(input) {
          if (input.workflowId === 'task-http-conflict') {
            yield {
              event: 'workflow.state' as const,
              data: {
                workflowId: input.workflowId,
                sourceRevision: 2,
                status: 'failed' as const,
                occurredAt: '2026-07-18T08:00:05.000Z',
                snapshot: {
                  outcome: 'failed',
                  error: {
                    code: 'CONTENT_PACKAGE_REVISION_CONFLICT',
                    expectedRevision: 0,
                    currentRevision: 2,
                  },
                },
              },
            };
            return;
          }
          const stages = [
            'intent_naming',
            'context_injection',
            'brief_compilation',
            'execution_selection',
            'assembly_delivery',
          ] as const;
          for (const [sequence, stage] of stages.entries()) {
            yield {
              event: 'workflow.progress' as const,
              data: {
                eventId: `${input.workflowId}:progress:${sequence}`,
                workflowId: input.workflowId,
                workflowType: 'beauty_marketing_harness',
                sequence,
                sourceRevision: 1,
                stage,
                state: 'success' as const,
                occurredAt: `2026-07-18T08:00:0${sequence}.000Z`,
                message: `stage-${sequence}`,
              },
            };
          }
          yield {
            event: 'workflow.token' as const,
            data: {
              eventId: `${input.workflowId}:token:5`,
              workflowId: input.workflowId,
              sequence: 5,
              sourceRevision: 1,
              candidateId: 'candidate-1',
              channel: 'copy.body' as const,
              delta: '正在生成的文案',
              occurredAt: '2026-07-18T08:00:05.000Z',
            },
          };
          yield {
            event: 'workflow.state' as const,
            data: {
              workflowId: input.workflowId,
              sourceRevision: 1,
              status: 'success' as const,
              occurredAt: '2026-07-18T08:00:05.000Z',
              snapshot: resultSnapshot(),
            },
          };
        },
      },
    ]),
    workflowHeartbeatMs: 5,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-1/p1/harness/tasks`;
  const headers = {
    'content-type': 'application/json',
    'x-service-token': 'harness-http-token',
    'x-user-id': 'owner-1',
    'x-workspace-id': 'workspace-1',
    'x-workspace-role': 'owner',
  };
  const retiredAdmission = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(taskRequest()),
  });
  assert.equal(retiredAdmission.status, 410);
  assert.equal(
    (await retiredAdmission.json()).error.code,
    'HARNESS_TASK_ADMISSION_RETIRED',
  );

  assert.deepEqual(
    await harnessService.submit({
      ...taskRequest(),
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
    }),
    {
    workflowId: 'task-http-1',
    replayed: false,
    },
  );

  const productMetric = {
    idempotencyKey: 'first-usable-draft:task-http-1',
    path: 'canonical_mouse',
    timeToFirstUsableDraftMs: 842,
    userActivationCount: 1,
  };
  const recordedMetric = await fetch(
    `${base}/task-http-1/product-metrics`,
    { method: 'POST', headers, body: JSON.stringify(productMetric) },
  );
  assert.equal(recordedMetric.status, 202);
  assert.deepEqual((await recordedMetric.json()).data, { recorded: true });
  assert.deepEqual(registry.auditEvents(), [
    {
      eventType: 'first_usable_draft_observed',
      payload: {
        path: 'canonical_mouse',
        timeToFirstUsableDraftMs: 842,
        userActivationCount: 1,
      },
      stage: 'product_experience',
      workflowId: 'task-http-1',
      workspaceId: 'workspace-1',
    },
  ]);
  const replayedMetric = await fetch(
    `${base}/task-http-1/product-metrics`,
    { method: 'POST', headers, body: JSON.stringify(productMetric) },
  );
  assert.equal(replayedMetric.status, 202);
  assert.equal(registry.auditEvents().length, 1);

  const invalidMetric = await fetch(
    `${base}/task-http-1/product-metrics`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...productMetric, userActivationCount: 101 }),
    },
  );
  assert.equal(invalidMetric.status, 400);
  assert.equal(
    (await invalidMetric.json()).error.code,
    'INVALID_HARNESS_PRODUCT_METRIC',
  );

  await registry.registerPending('workspace-1', question(), {
    timeoutSeconds: 17,
  });
  currentTimeoutSeconds = 29;
  const pending = await fetch(`${base}/task-http-1/decision`, { headers });
  assert.equal(pending.status, 200);
  assert.deepEqual((await pending.json()).data, {
    question: question(),
    resolutionSource: null,
    status: 'pending',
    timeoutSeconds: 17,
  });

  const interaction = await fetch(`${base}/task-http-1/interaction`, {
    headers,
  });
  assert.equal(interaction.status, 200);
  assert.equal((await interaction.json()).data.requestId, 'interaction-http-1');
  const interactionAnswer = {
    requestId: 'interaction-http-1',
    revision: 1,
    idempotencyKey: 'interaction-http-answer-1',
    resume: { runId: 'task-http-1', step: 'context_injection' },
    response: {
      kind: 'answer',
      items: [
        {
          itemId: 'service',
          result: { kind: 'answer', value: '头皮护理' },
        },
      ],
    },
  };
  const malformedInteractionAnswer = {
    ...interactionAnswer,
    idempotencyKey: 'interaction-http-malformed-1',
    response: { malformed: true },
  };
  const malformedInteraction = await fetch(
    `${base}/task-http-1/interaction`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(malformedInteractionAnswer),
    },
  );
  assert.equal(malformedInteraction.status, 200);
  assert.equal(
    (await malformedInteraction.json()).data.request.revision,
    2,
  );
  const interactionAnswerR2 = {
    ...interactionAnswer,
    revision: 2,
    idempotencyKey: 'interaction-http-answer-2',
  };
  const interactionAnswered = await fetch(
    `${base}/task-http-1/interaction`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(interactionAnswerR2),
    },
  );
  assert.equal(interactionAnswered.status, 200);
  assert.deepEqual((await interactionAnswered.json()).data, {
    kind: 'resumed',
    replayed: false,
  });
  const renderer = await fetch(
    `${base}/task-http-1/interaction/renderer?interaction-version=2`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: 'interaction-http-1',
        revision: 2,
        step: 'context_injection',
        carrier: 'conversation',
      }),
    },
  );
  assert.equal(renderer.status, 204);
  const editing = await fetch(
    `${base}/task-http-1/interaction/editing?interaction-version=2`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: 'interaction-http-1',
        revision: 2,
        step: 'context_injection',
        carrier: 'conversation',
        editing: true,
      }),
    },
  );
  assert.equal(editing.status, 204);
  const legacyRenderer = await fetch(
    `${base}/task-http-1/interaction/renderer`,
    {
      method: 'POST',
      headers,
    },
  );
  assert.equal(legacyRenderer.status, 426);
  const legacyEditing = await fetch(
    `${base}/task-http-1/interaction/editing`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ editing: true }),
    },
  );
  assert.equal(legacyEditing.status, 426);
  const merchantMessage = {
    requestId: 'interaction-http-1',
    revision: 2,
    step: 'execution_selection',
    carrier: 'conversation',
    idempotencyKey: 'interaction-http-message-1',
    message: '请换成更稳妥的方案',
  };
  const merchantMessageTarget = await fetch(
    `${base}/task-http-1/interaction/message`,
    { headers },
  );
  assert.equal(merchantMessageTarget.status, 200);
  assert.equal((await merchantMessageTarget.json()).data, null);
  const merchantMessageResponse = await fetch(
    `${base}/task-http-1/interaction/message`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(merchantMessage),
    },
  );
  assert.equal(merchantMessageResponse.status, 200);
  assert.deepEqual((await merchantMessageResponse.json()).data, {
    kind: 'resumed',
    replayed: false,
  });
  assert.deepEqual(interactionCalls, [
    ['read', 'workspace-1', 'task-http-1', 'conversation'],
    ['submit', 'workspace-1', malformedInteractionAnswer],
    ['submit', 'workspace-1', interactionAnswerR2],
    [
      'renderer',
      'workspace-1',
      'task-http-1',
      {
        requestId: 'interaction-http-1',
        revision: 2,
        step: 'context_injection',
        carrier: 'conversation',
      },
    ],
    [
      'editing',
      'workspace-1',
      'task-http-1',
      {
        requestId: 'interaction-http-1',
        revision: 2,
        step: 'context_injection',
        carrier: 'conversation',
        editing: true,
      },
    ],
    ['read-message', 'workspace-1', 'task-http-1', 'conversation'],
    ['message', 'workspace-1', 'task-http-1', merchantMessage],
  ]);
  const mismatchedInteraction = await fetch(
    `${base}/task-http-1/interaction`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...interactionAnswer,
        resume: {
          ...interactionAnswer.resume,
          runId: 'task-http-other',
        },
      }),
    },
  );
  assert.equal(mismatchedInteraction.status, 409);

  await harnessService.submit({
    ...taskRequest('task-http-legacy'),
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
  });
  await registry.registerPending(
    'workspace-1',
    question('task-http-legacy'),
  );
  const legacyPending = await fetch(
    `${base}/task-http-legacy/decision`,
    { headers },
  );
  assert.equal(legacyPending.status, 200);
  assert.equal((await legacyPending.json()).data.timeoutSeconds, 29);

  const unavailable = await fetch(`${base}/task-http-1/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify(decisionInput()),
  });
  assert.equal(unavailable.status, 503);
  assert.equal(
    (await unavailable.json()).error.code,
    'HARNESS_DECISION_RESUME_UNAVAILABLE',
  );
  const answered = await fetch(`${base}/task-http-1/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify(decisionInput()),
  });
  assert.equal(answered.status, 200);
  assert.equal((await answered.json()).data.replayed, true);
  assert.deepEqual(resumed, ['question-1']);

  await harnessService.submit({
    ...taskRequest('task-http-late'),
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
  });
  await registry.registerPending(
    'workspace-1',
    question('task-http-late'),
  );
  await decisions.submitCoreTimeout(
    'workspace-1',
    'task-http-late',
    coreTimeoutDecision(),
  );
  const timedOutSnapshot = await fetch(
    `${base}/task-http-late/decision`,
    { headers },
  );
  assert.equal(timedOutSnapshot.status, 200);
  assert.deepEqual((await timedOutSnapshot.json()).data, {
    question: question('task-http-late'),
    resolutionSource: 'core_timeout',
    status: 'resolved',
    timeoutSeconds: null,
  });

  const consumedSentinel = await fetch(
    `${base}/task-http-late/decision`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...decisionInput(),
        idempotencyKey: 'browser-timed-out-after-core',
        patch: { ...decisionInput().patch, value: '未作答' },
        decision: { state: 'ignored', value: '未作答' },
      }),
    },
  );
  assert.equal(consumedSentinel.status, 200);
  const consumedBody = (await consumedSentinel.json()).data;
  assert.equal(consumedBody.consumedByOther, true);
  assert.equal('replayed' in consumedBody, false);
  assert.equal('successor' in consumedBody, false);
  assert.equal(successors.length, 0);

  const lateAnswer = await fetch(
    `${base}/task-http-late/decision`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(decisionInput()),
    },
  );
  assert.equal(lateAnswer.status, 200);
  const firstLateBody = (await lateAnswer.json()).data;
  assert.equal(firstLateBody.replayed, false);
  assert.match(
    firstLateBody.successor.workflowId,
    /^composer-task:late-answer-/u,
  );

  const repeatedLateAnswer = await fetch(
    `${base}/task-http-late/decision`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...decisionInput(),
        idempotencyKey: 'decision-http-late-second',
        patch: {
          ...decisionInput().patch,
          value: '当前团购价 428 元',
        },
        decision: { state: 'accepted', value: '当前团购价 428 元' },
      }),
    },
  );
  assert.equal(repeatedLateAnswer.status, 200);
  const repeatedLateBody = (await repeatedLateAnswer.json()).data;
  assert.equal(repeatedLateBody.replayed, true);
  assert.deepEqual(repeatedLateBody.successor, firstLateBody.successor);
  assert.equal(successors.length, 1);
  assert.equal(successors[0]?.workflowId, firstLateBody.successor.workflowId);
  assert.equal(
    successors[0]?.command.idempotencyKey,
    'question-1:late_answer',
  );
  assert.equal(
    successors[0]?.command.decision.value,
    '当前团购价 398 元',
  );

  const recommendation = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-1/p1/harness/recommendation`,
    { headers },
  );
  assert.equal(recommendation.status, 200);
  assert.deepEqual((await recommendation.json()).data, {
    workspaceId: 'workspace-1',
    currentFactsRevision: 0,
    recommendation: null,
    stale: false,
  });

  const events = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-1/p1/workflows/task-http-1/events`,
    { headers },
  );
  const eventBody = await events.text();
  assert.equal(events.status, 200);
  assert.equal(
    (eventBody.match(/event: workflow\.progress/gu) ?? []).length,
    5,
  );
  assert.match(eventBody, /event: workflow\.token/u);
  assert.match(eventBody, /"channel":"copy\.body"/u);
  assert.match(eventBody, /"delta":"正在生成的文案"/u);
  assert.match(eventBody, /event: workflow\.state/u);
  assert.match(eventBody, /"revision":1/u);
  for (const field of [
    'whyPost',
    'expressionIdentity',
    'factReferences',
    'platforms',
    'customerAction',
    'complianceStatus',
    'deliverables',
  ]) {
    assert.match(eventBody, new RegExp(`"${field}"`, 'u'));
  }

  await harnessService.submit({
    ...taskRequest('task-http-conflict'),
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
  });
  const conflictEvents = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-1/p1/workflows/task-http-conflict/events`,
    { headers },
  );
  const conflictBody = await conflictEvents.text();
  assert.equal(conflictEvents.status, 200);
  assert.match(conflictBody, /CONTENT_PACKAGE_REVISION_CONFLICT/u);
  assert.match(conflictBody, /"expectedRevision":0/u);
  assert.match(conflictBody, /"currentRevision":2/u);

  const foreign = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-2/p1/harness/tasks/task-http-1/decision`,
    {
      headers: {
        ...headers,
        'x-workspace-id': 'workspace-2',
      },
    }
  );
  assert.equal(foreign.status, 404);
  const foreignMetric = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-2/p1/harness/tasks/task-http-1/product-metrics`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'x-workspace-id': 'workspace-2',
      },
      body: JSON.stringify(productMetric),
    },
  );
  assert.equal(foreignMetric.status, 404);
});

/**
 * 时间桥 (D-145 / W10). The browser asks this on composer mount, so a closed tab
 * stops being a way to lose a run. It has to be a workspace-scoped read that
 * carries exactly what reopening the conversation needs — and nothing that would
 * let the browser hold a second copy of the transcript.
 */
test('harness HTTP boundary lists the runs still in flight for one workspace', async (t) => {
  const activeTask = {
    taskId: 'task-http-live',
    workId: 'work-live',
    packageId: 'package-live',
    merchantText: '写一条周末到店的团购活动文案',
    submittedAt: '2026-07-18T08:00:00.000Z',
  };
  const registry = new MemoryHarnessStore();
  const harnessService = new HarnessApplicationService(
    new HarnessTaskAdmissionService(registry, {
      async start({ workflowId }) {
        return { workflowId };
      },
    }),
    new HarnessDecisionService(registry, {
      async resume() {},
      async startSuccessor() {},
    }),
    {
      taskBelongsToWorkspace: (taskId, workspaceId) =>
        registry.taskBelongsToWorkspace(taskId, workspaceId),
      async listActiveTasks(workspaceId) {
        return workspaceId === 'workspace-1' ? [activeTask] : [];
      },
    },
  );
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    harnessService,
    serviceToken: 'harness-http-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const headers = {
    'content-type': 'application/json',
    'x-service-token': 'harness-http-token',
    'x-user-id': 'owner-1',
    'x-workspace-id': 'workspace-1',
    'x-workspace-role': 'owner',
  };

  const listed = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-1/p1/harness/tasks`,
    { headers },
  );
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).data, { tasks: [activeTask] });

  // Another workspace's runs are not this workspace's business.
  const foreign = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-2/p1/harness/tasks`,
    { headers: { ...headers, 'x-workspace-id': 'workspace-2' } },
  );
  assert.equal(foreign.status, 200);
  assert.deepEqual((await foreign.json()).data, { tasks: [] });
});

/**
 * A missing bridge must never be the reason a composer will not mount: the
 * conversation still works, it just cannot offer a way back into an older run.
 */
test('a store that cannot answer the time bridge yields an empty list, not a failure', async () => {
  const registry = new MemoryHarnessStore();
  const harnessService = new HarnessApplicationService(
    new HarnessTaskAdmissionService(registry, {
      async start({ workflowId }) {
        return { workflowId };
      },
    }),
    new HarnessDecisionService(registry, {
      async resume() {},
      async startSuccessor() {},
    }),
    registry,
  );

  assert.deepEqual(await harnessService.listActiveTasks('workspace-1'), {
    tasks: [],
  });
});

class MemoryHarnessStore
  implements HarnessTaskRequestRegistry, HarnessDecisionStore
{
  private readonly tasks = new Map<
    string,
    {
      fingerprint: string;
      request: HarnessWorkflowInput;
      workspaceId: string;
    }
  >();
  private readonly decisions = new Map<
    string,
    {
      command: StructuredDecisionInput;
      fingerprint: string;
    }
  >();
  private readonly resumedEvents = new Set<string>();
  private readonly resumeClaims = new Map<string, string>();
  private readonly pending = new Map<string, QuestionCard>();
  private readonly pendingProjections = new Map<
    string,
    HarnessPendingDecisionProjection
  >();
  private readonly resolvedByCoreTimeout = new Map<string, QuestionCard>();
  private readonly audits = new Map<
    string,
    {
      workspaceId: string;
      workflowId: string;
      stage: string;
      eventType: string;
      payload: unknown;
    }
  >();

  constructor(
    private readonly approvals: {
      hasPendingApproval(workspaceId: string, taskId: string): Promise<boolean>;
    } = {
      async hasPendingApproval() {
        return false;
      },
    },
  ) {}

  async claim(input: Parameters<HarnessTaskRequestRegistry['claim']>[0]) {
    const identity = JSON.stringify([input.request.workspaceId, input.taskId]);
    const existing = this.tasks.get(identity);
    if (!existing) {
      this.tasks.set(identity, {
        fingerprint: input.fingerprint,
        request: structuredClone(input.request),
        workspaceId: input.request.workspaceId,
      });
      return { kind: 'created' as const };
    }
    return existing.fingerprint === input.fingerprint
      ? {
          kind: 'existing' as const,
          workflowId: input.taskId,
          request: structuredClone(existing.request),
        }
      : { kind: 'conflict' as const };
  }

  async taskBelongsToWorkspace(taskId: string, workspaceId: string) {
    return (
      this.tasks.get(JSON.stringify([workspaceId, taskId]))?.workspaceId ===
      workspaceId
    );
  }


  async readTodayRecommendation(workspaceId: string) {
    return {
      workspaceId,
      currentFactsRevision: 0,
      recommendation: null,
      stale: false,
    } as const;
  }

  async registerPending(
    workspaceId: string,
    question: QuestionCard,
    projection?: HarnessPendingDecisionProjection,
  ) {
    if (
      await this.approvals.hasPendingApproval(
        workspaceId,
        question.workflowId,
      )
    ) {
      throw new TaskBlockingNodeConflictError(question.workflowId);
    }
    const identity = JSON.stringify([workspaceId, question.workflowId]);
    this.pending.set(identity, structuredClone(question));
    if (projection) {
      this.pendingProjections.set(identity, structuredClone(projection));
    }
    return projection ? structuredClone(projection) : undefined;
  }

  async readPending(workspaceId: string, taskId: string) {
    const question = this.pending.get(JSON.stringify([workspaceId, taskId]));
    return question ? structuredClone(question) : null;
  }

  async readDecisionTarget(workspaceId: string, taskId: string) {
    const identity = JSON.stringify([workspaceId, taskId]);
    const question =
      this.pending.get(identity) ?? this.resolvedByCoreTimeout.get(identity);
    const request = this.tasks.get(identity)?.request;
    if (!question || !request) return null;
    const projection = this.pendingProjections.get(identity);
    return {
      question: structuredClone(question),
      request: structuredClone(request),
      resolutionSource: this.resolvedByCoreTimeout.has(identity)
        ? ('core_timeout' as const)
        : null,
      status: this.pending.has(identity)
        ? ('pending' as const)
        : ('resolved' as const),
      ...(projection
        ? { timeoutSeconds: projection.timeoutSeconds }
        : {}),
    };
  }

  async submit(input: Parameters<HarnessDecisionStore['submit']>[0]) {
    const identity = JSON.stringify([
      input.workspaceId,
      input.taskId,
      input.command.idempotencyKey,
    ]);
    const existing = this.decisions.get(identity);
    if (existing) {
      return {
        outcome:
          input.mode === 'late_answer' ||
          existing.fingerprint === input.event.payloadFingerprint
            ? ('replayed' as const)
            : ('idempotency_conflict' as const),
        command: structuredClone(existing.command),
        resumeRequired: !this.resumedEvents.has(
          JSON.stringify([input.workspaceId, input.event.id]),
        ),
      };
    }
    const pendingIdentity = JSON.stringify([input.workspaceId, input.taskId]);
    const pending = this.pending.get(pendingIdentity);
    if (
      input.mode === 'late_answer' &&
      this.resolvedByCoreTimeout.get(pendingIdentity)?.questionId ===
        input.command.questionId
    ) {
      this.decisions.set(identity, {
        command: structuredClone(input.command),
        fingerprint: input.event.payloadFingerprint,
      });
      return {
        command: structuredClone(input.command),
        outcome: 'created' as const,
        resumeRequired: true,
      };
    }
    if (
      pending?.questionId !== input.command.questionId ||
      pending.workflowId !== input.taskId
    ) {
      return { outcome: 'stale_question' as const, resumeRequired: false };
    }
    if (pending.workflowRevision !== input.command.workflowRevision) {
      return { outcome: 'stale_revision' as const, resumeRequired: false };
    }
    this.decisions.set(identity, {
      command: structuredClone(input.command),
      fingerprint: input.event.payloadFingerprint,
    });
    this.pending.delete(pendingIdentity);
    if (input.mode === 'core_timeout') {
      this.resolvedByCoreTimeout.set(
        pendingIdentity,
        structuredClone(pending),
      );
    }
    return {
      outcome: 'created' as const,
      resumeRequired:
        input.mode !== 'core_timeout' &&
        input.mode !== 'core_hold_expired',
    };
  }

  async markDecisionResumed(
    workspaceId: string,
    _taskId: string,
    eventId: string,
    claimId: string,
  ) {
    const identity = JSON.stringify([workspaceId, eventId]);
    if (this.resumeClaims.get(identity) !== claimId) return false;
    this.resumeClaims.delete(identity);
    this.resumedEvents.add(identity);
    return true;
  }

  async claimDecisionResume(
    workspaceId: string,
    _taskId: string,
    eventId: string,
    claimId: string,
  ) {
    const identity = JSON.stringify([workspaceId, eventId]);
    if (
      this.resumeClaims.has(identity) ||
      this.resumedEvents.has(identity)
    ) {
      return false;
    }
    this.resumeClaims.set(identity, claimId);
    return true;
  }

  async releaseDecisionResume(
    workspaceId: string,
    _taskId: string,
    eventId: string,
    claimId: string,
  ) {
    const identity = JSON.stringify([workspaceId, eventId]);
    if (this.resumeClaims.get(identity) === claimId) {
      this.resumeClaims.delete(identity);
    }
  }

  async appendAudit(event: {
    workspaceId: string;
    id: string;
    workflowId: string;
    stage: string;
    eventType: string;
    payload: unknown;
  }) {
    if (this.audits.has(event.id)) return;
    const { id: _id, ...stored } = structuredClone(event);
    this.audits.set(event.id, stored);
  }

  auditEvents() {
    return [...this.audits.values()].map((event) => structuredClone(event));
  }
}

function taskRequest(taskId = 'task-http-1') {
  return {
    taskId,
    packageId: 'package-1',
    expectedRevision: 0,
    workflowRevision: 1,
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

function question(workflowId = 'task-http-1'): QuestionCard {
  return {
    questionId: 'question-1',
    workflowId,
    workflowRevision: 1,
    question: '当前团购价是多少？',
    options: [],
    freeText: { enabled: true },
    response: {
      field: 'offer_price',
      reason: '补充当前任务所需的权威事实',
    },
    unattended: 'continue',
    scope: 'current_task',
  };
}

function coreTimeoutDecision() {
  return {
    ...decisionInput(),
    idempotencyKey: 'question-1:r1:core_timeout',
    patch: {
      ...decisionInput().patch,
      value: '超时未作答，已按通用口径继续',
    },
    decision: {
      state: 'ignored' as const,
      value: '超时未作答，已按通用口径继续',
    },
  };
}

function decisionInput() {
  return {
    idempotencyKey: 'decision-http-1',
    questionId: 'question-1',
    workflowRevision: 1,
    patch: {
      field: 'offer_price',
      value: '当前团购价 398 元',
      reason: '补充当前任务所需的权威事实',
    },
    decision: { state: 'accepted', value: '当前团购价 398 元' },
  };
}

function resultSnapshot() {
  return {
    delivery: {
      packageId: 'package-1',
      versionId: 'version-1',
      revision: 1,
    },
    recommendation: {
      recommendedCandidateId: 'c02',
      decisionTrace: {
        whyPost: 'promotion_groupbuy_conversion',
        expressionIdentity: 'identity-1',
        factReferences: ['fact-1'],
        platforms: ['xiaohongshu'],
        customerAction: '私信预约',
        complianceStatus: 'seven_gates_passed',
        deliverables: ['copy_revision:1'],
      },
    },
  };
}
