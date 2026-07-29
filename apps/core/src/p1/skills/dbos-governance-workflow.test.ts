import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { HarnessFrozenPrompt } from '../harness/langfuse-prompts.js';
import {
  createSkillGovernanceDbosRuntime,
  skillGovernanceWorkflowId,
  type SkillGovernanceDbosAdapter,
  type SkillGovernanceWorkflowResult,
} from './dbos-governance-workflow.js';
import {
  SkillFoundationModule,
  type SkillGovernanceRuntimePort,
} from './foundation-module.js';
import { MemorySkillRepository } from './repository.js';
import { SkillService } from './service.js';

const BASE_TIME = '2026-07-30T02:00:00.000Z';
const APPLY_TIME = '2026-07-30T02:01:00.000Z';
const PROMPT_CONTENT = 'Use grounded industry facts.';
const PROMPT: HarnessFrozenPrompt = {
  content: PROMPT_CONTENT,
  contentHash: createHash('sha256').update(PROMPT_CONTENT).digest('hex'),
  isFallback: false,
  label: 'production',
  name: 'harness/intent-naming',
  source: 'langfuse',
  version: '42',
};

test('a stable workspace-scoped governance run suspends until approval and applies once', async () => {
  const { repository, service } = await seedSkill();
  const dbos = new FakeSkillGovernanceDbosAdapter();
  const runtime = createSkillGovernanceDbosRuntime({ dbos, service });
  const request = governanceRequest('run-approval');

  const started = await runtime.start(request);

  assert.deepEqual(started, {
    runId: 'run-approval',
    workflowId:
      'skill-governance:platform-operations:run-approval',
  });
  assert.equal(
    skillGovernanceWorkflowId('another-workspace', request.runId),
    'skill-governance:another-workspace:run-approval',
  );
  assert.deepEqual(
    (await runtime.inspect(request.workspaceId, request.runId)).state,
    {
      runId: request.runId,
      status: 'awaiting_approval',
      workspaceId: request.workspaceId,
    },
  );
  assert.equal(
    await service.inspectGovernanceRun(request.runId),
    null,
  );
  assert.deepEqual(
    (await repository.listReferenceEdges(request.baseSkillRevisionRef)).map(
      (edge) => ({
        consumerId: edge.consumerId,
        consumerKind: edge.consumerKind,
        scope: edge.scope,
      }),
    ),
    [
      {
        consumerId: request.runId,
        consumerKind: 'governance_run',
        scope: {
          kind: 'workspace',
          workspaceId: request.workspaceId,
        },
      },
    ],
  );

  await runtime.approve({
    actorId: 'operator-approver',
    idempotencyKey: 'approve-1',
    runId: request.runId,
    workspaceId: request.workspaceId,
  });
  const result = await dbos.result<SkillGovernanceWorkflowResult>(
    started.workflowId,
  );

  assert.equal(result.success, true);
  assert.equal(result.applied, true);
  assert.equal(
    (await service.inspectGovernanceRun(request.runId))?.status,
    'completed',
  );
  assert.equal(
    await service.inspectGovernanceRun(request.runId).then((run) =>
      run?.draftSkillRevisionRef
    ),
    'skills/daily-industry@2',
  );
  assert.deepEqual(
    await service.inspectGovernanceRun(request.runId).then((run) => ({
      actorId: run?.actorId,
      auditActorIds: run?.auditEntries.map((entry) => entry.actorId),
    })),
    {
      actorId: 'operator-approver',
      auditActorIds: ['operator-approver'],
    },
  );
  assert.equal(
    (
      await repository.listReferenceEdges('skills/daily-industry@2')
    ).filter((edge) => edge.consumerKind === 'governance_run').length,
    1,
  );
});

test('business cancellation is audited as a stable terminal result and never applies a revision', async () => {
  const { repository, service } = await seedSkill();
  const dbos = new FakeSkillGovernanceDbosAdapter();
  const runtime = createSkillGovernanceDbosRuntime({ dbos, service });
  const request = governanceRequest('run-cancel');
  const started = await runtime.start(request);

  await runtime.businessCancel({
    actorId: 'operator-canceller',
    idempotencyKey: 'cancel-1',
    runId: request.runId,
    workspaceId: request.workspaceId,
  });
  await runtime.businessCancel({
    actorId: 'operator-canceller',
    idempotencyKey: 'cancel-1',
    runId: request.runId,
    workspaceId: request.workspaceId,
  });

  assert.deepEqual(await dbos.result(started.workflowId), {
    applied: false,
    runId: request.runId,
    success: true,
    validationResults: [
      {
        fieldPath: '$workflow',
        reasonCode: 'governance_cancelled',
        status: 'not_applied',
      },
    ],
  });
  assert.equal(
    await repository.getRevision('skills/daily-industry@2'),
    null,
  );
  assert.deepEqual(
    await service.inspectGovernanceRun(request.runId).then((run) => ({
      result: run?.result,
      status: run?.status,
    })),
    {
      result: {
        applied: false,
        runId: request.runId,
        success: true,
        validationResults: [
          {
            fieldPath: '$workflow',
            reasonCode: 'governance_cancelled',
            status: 'not_applied',
          },
        ],
      },
      status: 'completed',
    },
  );
  assert.equal(
    (await runtime.inspect(request.workspaceId, request.runId)).state?.status,
    'cancelled',
  );
});

test('the same run ID rejects different facts before approval', async () => {
  const { service } = await seedSkill();
  const dbos = new FakeSkillGovernanceDbosAdapter();
  const runtime = createSkillGovernanceDbosRuntime({ dbos, service });
  const request = governanceRequest('run-fingerprint');

  await runtime.start(request);
  await assert.rejects(
    runtime.start({
      ...request,
      patch: { instruction: 'Different governed instruction.' },
    }),
    /already bound to different facts/u,
  );
});

test('an operationally cancelled run resumes at the same ID and does not reapply on replay', async () => {
  const { repository, service } = await seedSkill();
  const dbos = new FakeSkillGovernanceDbosAdapter();
  const runtime = createSkillGovernanceDbosRuntime({ dbos, service });
  const request = governanceRequest('run-resume');
  const first = await runtime.start(request);
  const replay = await runtime.start(structuredClone(request));

  assert.deepEqual(replay, first);
  await runtime.cancel({
    actorId: 'operator-canceller',
    runId: request.runId,
    workspaceId: request.workspaceId,
  });
  assert.equal(
    (await runtime.inspect(request.workspaceId, request.runId)).workflowStatus,
    'CANCELLED',
  );

  assert.deepEqual(
    await runtime.resume({
      actorId: 'operator-resumer',
      runId: request.runId,
      workspaceId: request.workspaceId,
    }),
    first,
  );
  assert.equal(
    (await runtime.inspect(request.workspaceId, request.runId)).workflowStatus,
    'PENDING',
  );
  await runtime.approve({
    actorId: 'operator-approver',
    idempotencyKey: 'approve-resume',
    runId: request.runId,
    workspaceId: request.workspaceId,
  });
  await runtime.approve({
    actorId: 'operator-approver',
    idempotencyKey: 'approve-resume',
    runId: request.runId,
    workspaceId: request.workspaceId,
  });
  await dbos.result(first.workflowId);

  assert.equal(
    (await repository.listRevisions('skills/daily-industry', 10)).length,
    2,
  );
});

test('workspace-scoped controls cannot approve another workspace run', async () => {
  const { repository, service } = await seedSkill();
  const dbos = new FakeSkillGovernanceDbosAdapter();
  const runtime = createSkillGovernanceDbosRuntime({ dbos, service });
  const request = governanceRequest('run-isolated');
  const started = await runtime.start(request);

  await runtime.approve({
    actorId: 'operator-foreign',
    idempotencyKey: 'approve-wrong-workspace',
    runId: request.runId,
    workspaceId: 'another-workspace',
  });

  assert.equal(
    (await runtime.inspect(request.workspaceId, request.runId)).state?.status,
    'awaiting_approval',
  );
  assert.equal(
    (await runtime.inspect('another-workspace', request.runId)).state,
    null,
  );
  assert.equal(
    await repository.getRevision('skills/daily-industry@2'),
    null,
  );

  await runtime.businessCancel({
    actorId: 'operator-correct',
    idempotencyKey: 'cancel-correct-workspace',
    runId: request.runId,
    workspaceId: request.workspaceId,
  });
  await dbos.result(started.workflowId);
});

test('inspect never returns a completed governance run owned by another workspace', async () => {
  const { service } = await seedSkill();
  const dbos = new FakeSkillGovernanceDbosAdapter();
  const runtime = createSkillGovernanceDbosRuntime({ dbos, service });
  const request = governanceRequest('run-private');
  const started = await runtime.start(request);
  await runtime.approve({
    actorId: 'operator-private',
    idempotencyKey: 'approve-private',
    runId: request.runId,
    workspaceId: request.workspaceId,
  });
  await dbos.result(started.workflowId);

  const foreign = await runtime.inspect('another-workspace', request.runId);

  assert.equal(foreign.state, null);
  assert.equal(foreign.run, null);
});

test('Foundation routes governance lifecycle actions with trusted context', async () => {
  const { service } = await seedSkill();
  const calls: Array<{ action: string; input: unknown }> = [];
  const runtime: SkillGovernanceRuntimePort = {
    async approve(input: unknown) {
      calls.push({ action: 'approve', input });
      return { ok: true };
    },
    async businessCancel(input: unknown) {
      calls.push({ action: 'businessCancel', input });
      return { ok: true };
    },
    async inspect(workspaceId: string, runId: string) {
      calls.push({ action: 'inspect', input: { runId, workspaceId } });
      return { runId, workflowStatus: 'PENDING' };
    },
    async resume(input: unknown) {
      calls.push({ action: 'resume', input });
      return { ok: true };
    },
    async start(input: unknown) {
      calls.push({ action: 'start', input });
      return { runId: 'run-foundation', workflowId: 'workflow-foundation' };
    },
  };
  const module = new SkillFoundationModule(service, runtime);
  const context = {
    actor: 'admin' as const,
    correlationId: 'corr-foundation-governance',
    userId: 'operator-foundation',
    workspaceId: 'workspace-foundation',
  };

  await module.execute({
    context,
    idempotencyKey: 'start-foundation',
    input: {
      action: 'skill_governance_start',
      payload: {
        baseSkillRevisionRef: 'skills/daily-industry@1',
        expectedHeadRevision: 1,
        patch: { instruction: 'Foundation governed instruction.' },
        runId: 'run-foundation',
      },
    },
  });
  await module.execute({
    context,
    idempotencyKey: 'approve-foundation',
    input: {
      action: 'skill_governance_approve',
      payload: { runId: 'run-foundation' },
    },
  });
  await module.execute({
    context,
    idempotencyKey: 'cancel-foundation',
    input: {
      action: 'skill_governance_cancel',
      payload: { runId: 'run-foundation' },
    },
  });
  await module.execute({
    context,
    idempotencyKey: 'resume-foundation',
    input: {
      action: 'skill_governance_resume',
      payload: { runId: 'run-foundation' },
    },
  });
  await module.query({
    context,
    input: {
      action: 'skill_governance_run_get',
      payload: { runId: 'run-foundation' },
    },
  });

  assert.deepEqual(calls, [
    {
      action: 'start',
      input: {
        actorId: 'operator-foundation',
        baseSkillRevisionRef: 'skills/daily-industry@1',
        expectedHeadRevision: 1,
        patch: { instruction: 'Foundation governed instruction.' },
        runId: 'run-foundation',
        workspaceId: 'workspace-foundation',
      },
    },
    {
      action: 'approve',
      input: {
        actorId: 'operator-foundation',
        idempotencyKey: 'approve-foundation',
        runId: 'run-foundation',
        workspaceId: 'workspace-foundation',
      },
    },
    {
      action: 'businessCancel',
      input: {
        actorId: 'operator-foundation',
        idempotencyKey: 'cancel-foundation',
        runId: 'run-foundation',
        workspaceId: 'workspace-foundation',
      },
    },
    {
      action: 'resume',
      input: {
        actorId: 'operator-foundation',
        runId: 'run-foundation',
        workspaceId: 'workspace-foundation',
      },
    },
    {
      action: 'inspect',
      input: {
        runId: 'run-foundation',
        workspaceId: 'workspace-foundation',
      },
    },
  ]);
});

type RegisteredWorkflow<Input, Output> = (
  input: Input,
) => Promise<Output>;

class FakeSkillGovernanceDbosAdapter implements SkillGovernanceDbosAdapter {
  private activeWorkflowId: string | undefined;
  private readonly events = new Map<string, Map<string, unknown>>();
  private readonly messages = new Map<
    string,
    Array<{ message: unknown; topic: string }>
  >();
  private readonly waiters = new Map<
    string,
    Array<(message: unknown) => void>
  >();
  private readonly workflows = new Map<
    string,
    { promise: Promise<unknown>; status: string }
  >();
  private readonly deliveredMessageKeys = new Set<string>();

  currentWorkflowId() {
    return this.activeWorkflowId;
  }

  registerWorkflow<Input, Output>(
    workflow: RegisteredWorkflow<Input, Output>,
  ) {
    return workflow;
  }

  async startWorkflow<Input, Output>(
    workflow: RegisteredWorkflow<Input, Output>,
    options: { workflowId: string },
    input: Input,
  ) {
    if (!this.workflows.has(options.workflowId)) {
      const promise = Promise.resolve().then(async () => {
        this.activeWorkflowId = options.workflowId;
        try {
          const output = await workflow(structuredClone(input));
          this.workflows.get(options.workflowId)!.status = 'SUCCESS';
          return output;
        } catch (error) {
          this.workflows.get(options.workflowId)!.status = 'ERROR';
          throw error;
        } finally {
          this.activeWorkflowId = undefined;
        }
      });
      this.workflows.set(options.workflowId, {
        promise,
        status: 'PENDING',
      });
    }
    return { workflowId: options.workflowId };
  }

  async runStep<Output>(
    operation: () => Promise<Output>,
    _options: { name: string },
  ) {
    return operation();
  }

  async setEvent<Value>(key: string, value: Value) {
    assert.ok(this.activeWorkflowId);
    const events =
      this.events.get(this.activeWorkflowId) ?? new Map<string, unknown>();
    events.set(key, structuredClone(value));
    this.events.set(this.activeWorkflowId, events);
  }

  async getEvent<Value>(workflowId: string, key: string) {
    return (structuredClone(
      this.events.get(workflowId)?.get(key),
    ) ?? null) as Value | null;
  }

  async recv<Value>(
    topic: string,
    _options: { timeoutSeconds: number },
  ) {
    assert.ok(this.activeWorkflowId);
    const key = `${this.activeWorkflowId}:${topic}`;
    const queued = this.messages.get(key)?.shift();
    if (queued) return structuredClone(queued.message) as Value;
    return new Promise<Value>((resolve) => {
      const waiters = this.waiters.get(key) ?? [];
      waiters.push((message) => resolve(structuredClone(message) as Value));
      this.waiters.set(key, waiters);
    });
  }

  async send<Value>(
    workflowId: string,
    message: Value,
    topic: string,
    idempotencyKey: string,
  ) {
    if (this.deliveredMessageKeys.has(idempotencyKey)) return;
    this.deliveredMessageKeys.add(idempotencyKey);
    const key = `${workflowId}:${topic}`;
    const waiter = this.waiters.get(key)?.shift();
    if (waiter) {
      waiter(message);
      return;
    }
    const queued = this.messages.get(key) ?? [];
    queued.push({ message: structuredClone(message), topic });
    this.messages.set(key, queued);
  }

  async resumeWorkflow(workflowId: string) {
    const workflow = this.workflows.get(workflowId);
    if (workflow) workflow.status = 'PENDING';
  }

  async cancelWorkflow(workflowId: string) {
    const workflow = this.workflows.get(workflowId);
    if (workflow) workflow.status = 'CANCELLED';
  }

  async getWorkflowStatus(workflowId: string) {
    const workflow = this.workflows.get(workflowId);
    return workflow ? { status: workflow.status } : null;
  }

  async result<Output>(workflowId: string) {
    return (await this.workflows.get(workflowId)?.promise) as Output;
  }

}

function governanceRequest(runId: string) {
  return {
    actorId: 'platform-admin-2',
    baseSkillRevisionRef: 'skills/daily-industry@1',
    expectedHeadRevision: 1,
    patch: {
      instruction: 'Safer operator instruction',
    },
    runId,
    workspaceId: 'platform-operations',
  };
}

async function seedSkill() {
  const repository = new MemorySkillRepository();
  const authoring = new SkillService(repository, () => BASE_TIME, {
    async capture() {
      return structuredClone(PROMPT);
    },
  });
  await authoring.defineCatalogEntry({
    actorId: 'platform-admin-1',
    description: 'Original description',
    name: 'Daily industry copy',
    presentationPolicy: 'explainable',
    skillId: 'skills/daily-industry',
    sourceKind: 'authored',
    tier: 'industry',
  });
  await authoring.draftRevision({
    actorId: 'platform-admin-1',
    expectedRevision: null,
    governance: {
      budget: {
        maxChildEffects: 2,
        maxCostCents: 5,
        timeoutMs: 10_000,
      },
      contextScopes: ['industry_category'],
      executionMode: 'prompt_materialized',
      fallback: 'skip',
      inputSchemaRef: 'skill-input.daily-industry@1',
      outputSchemaRef: 'skill-output.intent-decision@1',
      requiredModelCapabilities: ['structured_output'],
      sideEffectClass: 'none',
      workflowRevisionRefs: ['workflow.daily-copy@1'],
    },
    instruction: 'Original instruction',
    manifest: {
      description: 'Original description',
      name: 'daily-industry',
    },
    promptReference: {
      contentHash: PROMPT.contentHash,
      name: PROMPT.name,
      version: PROMPT.version,
    },
    skillId: 'skills/daily-industry',
  });
  return {
    repository,
    service: new SkillService(repository, () => APPLY_TIME),
  };
}
