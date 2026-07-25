import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { DiagnosticRun, QuestionCard } from '@meiye/contracts';

import type { DiagnosticRepository } from '../../diagnostics/repository.js';
import { createCoreServer } from '../../server.js';
import { WorkflowEventApplicationService } from '../workflow-events.js';
import { TaskBlockingNodeConflictError } from '../operations/repository.js';
import { HarnessApplicationService } from './application-service.js';
import {
  HarnessDecisionService,
  type HarnessDecisionStore,
} from './decision-service.js';
import {
  HarnessTaskAdmissionService,
  type HarnessTaskRequestRegistry,
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
  const resumed: string[] = [];
  let resumeAttempts = 0;
  const decisions = new HarnessDecisionService(registry, {
    async resume(_workspaceId, _taskId, command) {
      resumeAttempts += 1;
      if (resumeAttempts === 1) throw new Error('DBOS unavailable');
      resumed.push(command.questionId);
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

  await registry.registerPending('workspace-1', question());
  const pending = await fetch(`${base}/task-http-1/decision`, { headers });
  assert.equal(pending.status, 200);
  assert.equal((await pending.json()).data.question.questionId, 'question-1');

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

class MemoryHarnessStore
  implements HarnessTaskRequestRegistry, HarnessDecisionStore
{
  private readonly tasks = new Map<
    string,
    { fingerprint: string; workspaceId: string }
  >();
  private readonly decisions = new Map<string, string>();
  private readonly resumedEvents = new Set<string>();
  private readonly pending = new Map<string, QuestionCard>();
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
        workspaceId: input.request.workspaceId,
      });
      return { kind: 'created' as const };
    }
    return existing.fingerprint === input.fingerprint
      ? { kind: 'existing' as const, workflowId: input.taskId }
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

  async registerPending(workspaceId: string, question: QuestionCard) {
    if (
      await this.approvals.hasPendingApproval(
        workspaceId,
        question.workflowId,
      )
    ) {
      throw new TaskBlockingNodeConflictError(question.workflowId);
    }
    this.pending.set(
      JSON.stringify([workspaceId, question.workflowId]),
      structuredClone(question),
    );
  }

  async readPending(workspaceId: string, taskId: string) {
    const question = this.pending.get(JSON.stringify([workspaceId, taskId]));
    return question ? structuredClone(question) : null;
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
          existing === input.event.payloadFingerprint
            ? ('replayed' as const)
            : ('idempotency_conflict' as const),
        resumeRequired: !this.resumedEvents.has(
          JSON.stringify([input.workspaceId, input.event.id]),
        ),
      };
    }
    const pendingIdentity = JSON.stringify([input.workspaceId, input.taskId]);
    const pending = this.pending.get(pendingIdentity);
    if (
      pending?.questionId !== input.command.questionId ||
      pending.workflowId !== input.taskId
    ) {
      return { outcome: 'stale_question' as const, resumeRequired: false };
    }
    if (pending.workflowRevision !== input.command.workflowRevision) {
      return { outcome: 'stale_revision' as const, resumeRequired: false };
    }
    this.decisions.set(identity, input.event.payloadFingerprint);
    this.pending.delete(pendingIdentity);
    return { outcome: 'created' as const, resumeRequired: true };
  }

  async markDecisionResumed(
    workspaceId: string,
    _taskId: string,
    eventId: string,
  ) {
    this.resumedEvents.add(JSON.stringify([workspaceId, eventId]));
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

function question(): QuestionCard {
  return {
    questionId: 'question-1',
    workflowId: 'task-http-1',
    workflowRevision: 1,
    question: '当前团购价是多少？',
    options: [],
    freeText: { enabled: true },
    response: {
      field: 'offer_price',
      reason: '补充当前任务所需的权威事实',
    },
    scope: 'current_task',
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
