import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { EvalRun } from '@meiye/contracts';

import {
  nameHarnessIntent,
  type StructuredNodeRunner,
} from '../harness/structured-nodes.js';
import { P1DomainError } from '../foundation/domain.js';
import { LangfuseHarnessPromptResolver } from '../harness/langfuse-prompts.js';
import type { HarnessFrozenPrompt } from '../harness/langfuse-prompts.js';
import {
  MemorySkillRepository,
  RegistrySkillOutputValidator,
  SkillFoundationModule,
  SkillService,
  StaticSkillToolExecutionAuthorizer,
  type SkillBinding,
  type SkillChildEffectExecutor,
  type SkillInvocationExecutor,
  type SkillInvocationResultPublisher,
} from './index.js';

const NOW = '2026-07-26T02:00:00.000Z';
const PROMPT_CONTENT =
  'When the merchant asks for a daily post, prefer useful industry context.';
const testPromptSnapshotsByReference = new Map<
  string,
  HarnessFrozenPrompt
>();
const testPromptSnapshots = {
  async capture(reference: {
    contentHash: string;
    name: string;
    version: string;
  }) {
    const snapshot = testPromptSnapshotsByReference.get(
      promptKey(reference),
    );
    assert.ok(snapshot, 'Test prompt snapshot must be registered.');
    return snapshot;
  },
};
const discardResultPublisher: SkillInvocationResultPublisher = {
  async publishOnce(input) {
    return input.result;
  },
};

function createEffectTestService(repository: MemorySkillRepository) {
  return new SkillService(
    repository,
    () => NOW,
    testPromptSnapshots,
    new StaticSkillToolExecutionAuthorizer(
      ['tool.fact.read', 'tool.quality.score'].map((toolId) => ({
        caller: 'skill.effect-boundary@1',
        toolId,
      })),
    ),
  );
}

test('only an evaluated and frozen Skill revision enters a stage allowlist', async () => {
  const service = new SkillService(
    new MemorySkillRepository(),
    () => NOW,
    testPromptSnapshots,
  );
  await service.defineCatalogEntry({
    actorId: 'operator-1',
    name: 'Daily industry context',
    presentationPolicy: 'explainable',
    skillId: 'skill.daily-industry',
  });
  const prompts = await new LangfuseHarnessPromptResolver({
    baseUrl: 'http://langfuse.fixture',
    fetch: async () =>
      new Response(
        JSON.stringify({
          prompt: PROMPT_CONTENT,
          type: 'text',
          version: 42,
        }),
        { status: 200 },
      ),
    publicKey: 'fixture-public',
    secretKey: 'fixture-secret',
    policy: 'pilot',
    versions: { intentNaming: 42 },
  }).resolve();
  const draft = await service.draftRevision({
    actorId: 'operator-1',
    expectedRevision: null,
    governance: {
      ...governance(),
      budget: {
        maxChildEffects: 2,
        maxCostCents: 5,
        timeoutMs: 10_000,
      },
      workflowRevisionRefs: ['workflow.daily-copy@1'],
    },
    instruction: PROMPT_CONTENT,
    manifest: {
      description: 'Adds grounded daily industry context.',
      name: 'daily-industry',
    },
    promptReference: registerPrompt(prompts.intentNaming),
    skillId: 'skill.daily-industry',
  });
  await service.bindRevision({
    bindingId: 'binding.daily-industry',
    mode: 'required',
    skillRevisionRef: draft.skillRevisionRef,
    stage: 'intent_naming',
    workflowRevisionRef: 'workflow.daily-copy@1',
  });

  assert.deepEqual(
    await service.resolveStage({
      stage: 'intent_naming',
      userSelectedSkillRefs: [],
      workflowRevisionRef: 'workflow.daily-copy@1',
    }),
    { allowlist: [] },
  );

  const frozen = await service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRun: skillEvalRun(draft.skillRevisionRef),
    skillRevisionRef: draft.skillRevisionRef,
  });
  const resolved = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: 'workflow.daily-copy@1',
  });

  assert.equal(frozen.status, 'accepted_frozen');
  assert.deepEqual(
    resolved.allowlist.map((skill) => skill.skillRevisionRef),
    [draft.skillRevisionRef],
  );

  const receipts = await service.recordPromptMaterializationReceipts({
    instructions: resolved.allowlist,
    stage: 'intent_naming',
    taskId: 'task-daily-copy',
    workflowRevisionRef: 'workflow.daily-copy@1',
    workspaceId: 'workspace-daily-copy',
  });
  const replayedReceipts =
    await service.recordPromptMaterializationReceipts({
      instructions: resolved.allowlist,
      stage: 'intent_naming',
      taskId: 'task-daily-copy',
      workflowRevisionRef: 'workflow.daily-copy@1',
      workspaceId: 'workspace-daily-copy',
    });
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.skillRevisionRef, draft.skillRevisionRef);
  assert.deepEqual(receipts[0]?.childEffectIds, []);
  assert.deepEqual(replayedReceipts, receipts);
  assert.deepEqual(
    await service.resolveExecutedSelection(receipts[0]!.invocationId),
    [],
  );
});

test('retired planner-selected bindings remain auditable but never enter the real stage allowlist', async () => {
  const repository = new MemorySkillRepository();
  const service = new SkillService(repository, () => NOW, testPromptSnapshots);
  const revisions = new Map<string, string>();
  for (const mode of [
    'required',
    'user_selected',
    'disabled',
  ] as const) {
    const revision = await createAcceptedSkill(service, mode);
    revisions.set(mode, revision.skillRevisionRef);
    await service.bindRevision({
      bindingId: `binding.${mode}`,
      mode,
      skillRevisionRef: revision.skillRevisionRef,
      stage: 'intent_naming',
      workflowRevisionRef: 'workflow.binding-matrix@1',
    });
  }
  const retiredRevision = await createAcceptedSkill(
    service,
    'retired-planner',
  );
  await repository.putBinding({
    bindingId: 'binding.retired-planner',
    workflowRevisionRef: 'workflow.binding-matrix@1',
    stage: 'intent_naming',
    skillId: retiredRevision.skillId,
    skillRevisionRef: retiredRevision.skillRevisionRef,
    mode: 'planner_selected',
    status: 'active',
    supersededAt: null,
    supersededByBindingId: null,
    createdAt: NOW,
  } as unknown as SkillBinding);
  assert.equal(await service.retireLegacyPlannerSelectedBindings(), 1);

  const unresolved = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: 'workflow.binding-matrix@1',
  });
  assert.deepEqual(
    unresolved.allowlist.map((skill) => skill.skillRevisionRef),
    [revisions.get('required')],
  );
  assert.deepEqual(
    await repository.getBinding('binding.retired-planner'),
    {
      bindingId: 'binding.retired-planner',
      workflowRevisionRef: 'workflow.binding-matrix@1',
      stage: 'intent_naming',
      skillId: retiredRevision.skillId,
      skillRevisionRef: retiredRevision.skillRevisionRef,
      mode: 'planner_selected',
      status: 'superseded',
      supersededAt: NOW,
      supersededByBindingId: null,
      createdAt: NOW,
    },
  );

  const selected = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [revisions.get('user_selected')!],
    workflowRevisionRef: 'workflow.binding-matrix@1',
  });
  assert.deepEqual(
    selected.allowlist.map((skill) => skill.skillRevisionRef),
    [
      revisions.get('required'),
      revisions.get('user_selected'),
    ],
  );
  assert.equal(
    selected.allowlist.some(
      (skill) => skill.skillRevisionRef === revisions.get('disabled'),
    ),
    false,
  );
});

test('an accepted prompt Skill changes the fixture judgment at its declared Harness stage', async () => {
  const service = new SkillService(
    new MemorySkillRepository(),
    () => NOW,
    testPromptSnapshots,
  );
  const revision = await createAcceptedSkill(service, 'required');
  await service.bindRevision({
    bindingId: 'binding.fixture-judgment',
    mode: 'required',
    skillRevisionRef: revision.skillRevisionRef,
    stage: 'intent_naming',
    workflowRevisionRef: 'workflow.binding-matrix@1',
  });
  const resolved = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: 'workflow.binding-matrix@1',
  });
  const runner: StructuredNodeRunner = {
    async run(request) {
      const enhanced = request.instructions.includes(
        revision.skillRevisionRef,
      );
      return {
        attempts: 1,
        output: request.schema.parse({
          blockingGap: enhanced
            ? null
            : {
                allowFreeText: true,
                field: 'industry',
                options: [],
                question: '你主要做哪个美业项目？',
                scope: 'current_task',
              },
          deliveryLayer: 'copy',
          implicitConstraints: [],
          normalizedIntent: '写一条护理日常',
          relevantAssetCategories: ['industry_category'],
          route: enhanced ? 'customized' : 'guidance',
          taskType: 'daily_service_exposure',
          usedAssetCategories: enhanced ? ['industry_category'] : [],
        }),
        providerTaskRef: 'fixture-skill-judgment',
        replayed: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
  const input = {
    intent: {
      assetReferences: [],
      context: {
        intent: '写一条护理日常',
        sourceSummaries: [],
        workId: 'work-skill-fixture',
      },
    },
    workflowId: 'workflow-skill-fixture',
    workflowRevision: 1,
  };

  const baseline = await nameHarnessIntent(input, runner);
  const enhanced = await nameHarnessIntent(
    { ...input, skillInstructions: resolved.allowlist },
    runner,
  );

  assert.equal(baseline.declaration.route, 'guidance');
  assert.equal(enhanced.declaration.route, 'customized');
});

test('one Skill invocation settles two child effects independently and replay does not duplicate either settlement', async () => {
  const repository = new MemorySkillRepository();
  const service = createEffectTestService(repository);
  const revision = await createAcceptedEffectSkill(service);
  const executions: string[] = [];
  const executor: SkillChildEffectExecutor = {
    async execute(effect) {
      executions.push(effect.idempotencyKey);
      return {
        acceptanceStatus: 'accepted',
        costCents: 2,
        providerReceipt: {
          accepted: true,
          providerTaskRef: `provider-${effect.callId}`,
        },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
        },
      };
    },
  };
  const input = {
    calls: [
      {
        declaredBudgetCapCents: 2,
        callId: 'read-facts',
        contextRefs: ['facts:current-offer'],
        payload: { factType: 'campaign_offer' },
        toolId: 'tool.fact.read',
      },
      {
        declaredBudgetCapCents: 2,
        callId: 'score-output',
        contextRefs: ['facts:current-offer'],
        payload: { candidateRef: 'candidate-1' },
        toolId: 'tool.quality.score',
      },
    ],
    input: dailyIndustrySkillInput(),
    invocationId: 'invocation-two-effects',
    output: {
      schemaRevision: 'skill-output.intent-decision@1',
      target: 'workflow_artifact' as const,
    },
    productUsageTaskId: 'task-one-product-usage',
    skillRevisionRef: revision.skillRevisionRef,
    taskId: 'task-skill-invocation',
    workspaceId: 'workspace-skill-invocation',
  };

  assert.deepEqual(
    await service.resolveExecutedSelection(input.invocationId),
    [],
  );
  const first = await service.invoke(
    input,
    withGeneratedOutput(executor),
    discardResultPublisher,
    {
      validate() {
        return { qualityPassed: true, schemaValid: true };
      },
    },
  );
  const replay = await service.invoke(
    input,
    withGeneratedOutput(executor),
    discardResultPublisher,
    {
      validate() {
        return { qualityPassed: true, schemaValid: true };
      },
    },
  );

  assert.deepEqual(executions, [
    'skill:invocation-two-effects:read-facts',
    'skill:invocation-two-effects:score-output',
  ]);
  assert.deepEqual(replay, first);
  assert.equal(first.childEffectIds.length, 2);
  assert.equal(first.totalCostCents, 4);
  assert.equal(first.totalInputTokens, 20);
  assert.equal(first.totalOutputTokens, 10);
  assert.deepEqual(first.output.value, intentDecisionOutput());
  assert.deepEqual(
    first.selected.map((skill) => skill.skillRevisionRef),
    [revision.skillRevisionRef],
  );
  assert.deepEqual(
    (
      await service.resolveExecutedSelection(input.invocationId)
    ).map((skill) => skill.skillRevisionRef),
    [revision.skillRevisionRef],
  );
  const effects = await Promise.all(
    first.childEffectIds.map((effectId) =>
      repository.getChildEffect(effectId),
    ),
  );
  assert.deepEqual(
    effects.map((effect) => ({
      acceptanceStatus: effect?.acceptanceStatus,
      declaredBudgetCapCents: effect?.declaredBudgetCapCents,
      providerTaskRef: effect?.providerReceipt.providerTaskRef,
      retryStatus: effect?.retryStatus,
      settlementStatus: effect?.settlementStatus,
    })),
    [
      {
        acceptanceStatus: 'accepted',
        declaredBudgetCapCents: 2,
        providerTaskRef: 'provider-read-facts',
        retryStatus: 'replayed',
        settlementStatus: 'settled',
      },
      {
        acceptanceStatus: 'accepted',
        declaredBudgetCapCents: 2,
        providerTaskRef: 'provider-score-output',
        retryStatus: 'replayed',
        settlementStatus: 'settled',
      },
    ],
  );
});

test('Skill output cannot write ContentPackage and never reaches a child effect', async () => {
  const service = new SkillService(
    new MemorySkillRepository(),
    () => NOW,
    testPromptSnapshots,
  );
  const revision = await createAcceptedEffectSkill(service);
  let executions = 0;

  await assert.rejects(
    service.invoke(
      {
        calls: [
          {
            declaredBudgetCapCents: 1,
            callId: 'forbidden-write',
            contextRefs: ['facts:current-offer'],
            payload: {},
            toolId: 'tool.fact.read',
          },
        ],
        input: dailyIndustrySkillInput(),
        invocationId: 'invocation-forbidden-content-package',
        output: {
          schemaRevision: 'content-package@1',
          target: 'content_package',
        },
        productUsageTaskId: 'task-one-product-usage',
        skillRevisionRef: revision.skillRevisionRef,
        taskId: 'task-forbidden-content-package',
        workspaceId: 'workspace-skill-invocation',
      },
      {
        async execute() {
          executions += 1;
          throw new Error('must not execute');
        },
        async generate() {
          executions += 1;
          throw new Error('must not generate');
        },
      },
      discardResultPublisher,
      {
        validate() {
          return { qualityPassed: true, schemaValid: true };
        },
      },
    ),
    /不能写入 ContentPackage/u,
  );
  assert.equal(executions, 0);
});

test('manifest admission rejects unknown schema refs before persisting a revision', async () => {
  const repository = new MemorySkillRepository();
  const service = new SkillService(
    repository,
    () => NOW,
    testPromptSnapshots,
  );
  await service.defineCatalogEntry({
    actorId: 'operator-1',
    name: 'Invalid schema fixture',
    presentationPolicy: 'backend_only',
    skillId: 'skill.invalid-schema',
  });

  await assert.rejects(
    service.draftRevision({
      actorId: 'operator-1',
      expectedRevision: null,
      governance: {
        ...governance(),
        outputSchemaRef: 'skill-output.not-registered@1',
        workflowRevisionRefs: ['workflow.invalid-schema@1'],
      },
      instruction: PROMPT_CONTENT,
      manifest: {
        description: 'Invalid output schema fixture.',
        name: 'invalid-schema',
      },
      promptReference: registerPrompt({
        content: PROMPT_CONTENT,
        contentHash: sha256(PROMPT_CONTENT),
        isFallback: false,
        label: 'production',
        name: 'skills/invalid-schema',
        source: 'langfuse',
        version: '1',
      }),
      skillId: 'skill.invalid-schema',
    }),
    /schema ref/u,
  );
  assert.equal(
    await repository.getRevision('skill.invalid-schema@1'),
    null,
  );
});

test('invalid Skill input fails before any child executor call', async () => {
  const repository = new MemorySkillRepository();
  const service = new SkillService(repository, () => NOW, testPromptSnapshots);
  const revision = await createAcceptedEffectSkill(service);
  let executions = 0;

  await assert.rejects(
    service.invoke(
      {
        calls: [
          {
            callId: 'read-facts',
            contextRefs: ['facts:current-offer'],
            declaredBudgetCapCents: 1,
            payload: {},
            toolId: 'tool.fact.read',
          },
        ],
        input: { context: null, assetReferences: [] },
        invocationId: 'invocation-invalid-input',
        output: {
          schemaRevision: 'skill-output.intent-decision@1',
          target: 'workflow_artifact',
        },
        productUsageTaskId: 'task-one-product-usage',
        skillRevisionRef: revision.skillRevisionRef,
        taskId: 'task-invalid-input',
        workspaceId: 'workspace-skill-invocation',
      },
      {
        async execute() {
          executions += 1;
          throw new Error('must not execute');
        },
        async generate() {
          executions += 1;
          throw new Error('must not generate');
        },
      },
      discardResultPublisher,
    ),
    /Skill input does not match/u,
  );
  assert.equal(executions, 0);
  assert.equal(
    await repository.getInvocationReceipt('invocation-invalid-input'),
    null,
  );
});

test('invalid Skill input is rejected before the invocation receipt replay fast path', async () => {
  class ReceiptReadTrackingRepository extends MemorySkillRepository {
    receiptReads = 0;

    override async getInvocationReceipt(invocationId: string) {
      this.receiptReads += 1;
      return super.getInvocationReceipt(invocationId);
    }
  }

  const repository = new ReceiptReadTrackingRepository();
  const service = new SkillService(repository, () => NOW, testPromptSnapshots);
  const revision = await createAcceptedEffectSkill(service);
  const invocation = {
    calls: [],
    input: dailyIndustrySkillInput(),
    invocationId: 'invocation-input-replay-order',
    output: {
      schemaRevision: 'skill-output.intent-decision@1',
      target: 'workflow_artifact' as const,
    },
    productUsageTaskId: 'task-one-product-usage',
    skillRevisionRef: revision.skillRevisionRef,
    taskId: 'task-input-replay-order',
    workspaceId: 'workspace-skill-invocation',
  };
  const executor: SkillChildEffectExecutor = {
    async execute() {
      throw new Error('No child effects are expected.');
    },
  };

  await service.invoke(
    invocation,
    withGeneratedOutput(executor),
    discardResultPublisher,
  );
  repository.receiptReads = 0;

  await assert.rejects(
    service.invoke(
      {
        ...invocation,
        input: { context: null, assetReferences: [] },
      },
      withGeneratedOutput(executor),
      discardResultPublisher,
    ),
    /Skill input does not match/u,
  );
  assert.equal(repository.receiptReads, 0);
});

test('registry-backed validation rejects the actual generated output before business publication and receipt persistence', async () => {
  const repository = new MemorySkillRepository();
  const service = createEffectTestService(repository);
  const revision = await createAcceptedEffectSkill(service);
  let executions = 0;
  let generations = 0;
  let publications = 0;
  const order: string[] = [];
  const registryValidator = new RegistrySkillOutputValidator();

  await assert.rejects(
    service.invoke(
      {
        calls: [
          {
            callId: 'read-facts',
            contextRefs: ['facts:current-offer'],
            declaredBudgetCapCents: 1,
            payload: {},
            toolId: 'tool.fact.read',
          },
        ],
        input: dailyIndustrySkillInput(),
        invocationId: 'invocation-invalid-output',
        output: {
          schemaRevision: 'skill-output.intent-decision@1',
          target: 'workflow_artifact',
        },
        productUsageTaskId: 'task-one-product-usage',
        skillRevisionRef: revision.skillRevisionRef,
        taskId: 'task-invalid-output',
        workspaceId: 'workspace-skill-invocation',
      },
      {
        async execute() {
          executions += 1;
          order.push('child-effect');
          return {
            acceptanceStatus: 'accepted',
            costCents: 1,
            providerReceipt: {
              accepted: true,
              providerTaskRef: 'provider-invalid-output-audit',
            },
            usage: { inputTokens: 5, outputTokens: 2 },
          };
        },
        async generate() {
          generations += 1;
          order.push('generate');
          return { value: { route: 'customized' } };
        },
      },
      {
        async publishOnce(input) {
          publications += 1;
          order.push('publish');
          return input.result;
        },
      },
      {
        validate(input) {
          order.push('validate');
          return registryValidator.validate(input);
        },
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof P1DomainError);
      assert.equal(error.code, 'INVALID_STATE');
      assert.match(error.message, /Schema 或质量门/u);
      return true;
    },
  );
  assert.equal(executions, 1);
  assert.equal(generations, 1);
  assert.equal(publications, 0);
  assert.deepEqual(order, ['child-effect', 'generate', 'validate']);
  assert.equal(
    (
      await repository.getChildEffect(
        'invocation-invalid-output:read-facts',
      )
    )?.providerReceipt.providerTaskRef,
    'provider-invalid-output-audit',
  );
  assert.equal(
    await repository.getInvocationReceipt('invocation-invalid-output'),
    null,
  );
});

test('receipt persistence retry reuses child effects and publishes the business result once', async () => {
  class FailFirstReceiptRepository extends MemorySkillRepository {
    failNextReceipt = true;

    override async putInvocationReceipt(
      receipt: Parameters<MemorySkillRepository['putInvocationReceipt']>[0],
    ) {
      if (
        receipt.invocationId === 'invocation-receipt-retry' &&
        this.failNextReceipt
      ) {
        this.failNextReceipt = false;
        throw new Error('fixture receipt persistence failure');
      }
      return super.putInvocationReceipt(receipt);
    }
  }

  const repository = new FailFirstReceiptRepository();
  const service = createEffectTestService(repository);
  const revision = await createAcceptedEffectSkill(service);
  const published = new Map<
    string,
    Parameters<SkillInvocationResultPublisher['publishOnce']>[0]['result']
  >();
  let childExecutions = 0;
  let generations = 0;
  let publicationAttempts = 0;
  const invocation = {
    calls: [
      {
        callId: 'read-facts',
        contextRefs: ['facts:current-offer'],
        declaredBudgetCapCents: 1,
        payload: {},
        toolId: 'tool.fact.read',
      },
    ],
    input: dailyIndustrySkillInput(),
    invocationId: 'invocation-receipt-retry',
    output: {
      schemaRevision: 'skill-output.intent-decision@1',
      target: 'workflow_artifact' as const,
    },
    productUsageTaskId: 'task-one-product-usage',
    skillRevisionRef: revision.skillRevisionRef,
    taskId: 'task-receipt-retry',
    workspaceId: 'workspace-skill-invocation',
  };
  const executor: SkillInvocationExecutor = {
    async execute() {
      childExecutions += 1;
      return {
        acceptanceStatus: 'accepted',
        costCents: 1,
        providerReceipt: {
          accepted: true,
          providerTaskRef: 'provider-receipt-retry',
        },
        usage: { inputTokens: 3, outputTokens: 1 },
      };
    },
    async generate() {
      generations += 1;
      return {
        value: {
          ...intentDecisionOutput(),
          normalizedIntent:
            generations === 1
              ? '首次生成的权威结果'
              : '重试生成的不同结果',
        },
      };
    },
  };
  const publisher: SkillInvocationResultPublisher = {
    async publishOnce(input) {
      publicationAttempts += 1;
      const existing = published.get(input.idempotencyKey);
      if (existing !== undefined) {
        return structuredClone(existing);
      }
      published.set(input.idempotencyKey, structuredClone(input.result));
      return structuredClone(input.result);
    },
  };

  await assert.rejects(
    service.invoke(invocation, executor, publisher),
    /fixture receipt persistence failure/u,
  );
  assert.equal(
    await repository.getInvocationReceipt(invocation.invocationId),
    null,
  );

  const recovered = await service.invoke(invocation, executor, publisher);
  assert.deepEqual(recovered.output.value, {
    ...intentDecisionOutput(),
    normalizedIntent: '首次生成的权威结果',
  });
  assert.equal(childExecutions, 1);
  assert.equal(generations, 2);
  assert.equal(publicationAttempts, 2);
  assert.equal(published.size, 1);
  assert.deepEqual(
    published.get(invocation.invocationId)?.value,
    {
      ...intentDecisionOutput(),
      normalizedIntent: '首次生成的权威结果',
    },
  );
});

test('replay fails closed before mutating any effect when one recorded effect is missing', async () => {
  class MissingEffectRepository extends MemorySkillRepository {
    readonly missingEffectIds = new Set<string>();
    updates = 0;

    override async getChildEffect(effectId: string) {
      if (this.missingEffectIds.has(effectId)) return null;
      return super.getChildEffect(effectId);
    }

    override async updateChildEffect(
      effect: Parameters<MemorySkillRepository['updateChildEffect']>[0],
    ) {
      this.updates += 1;
      return super.updateChildEffect(effect);
    }
  }

  const repository = new MissingEffectRepository();
  const service = createEffectTestService(repository);
  const revision = await createAcceptedEffectSkill(service);
  const invocation = {
    calls: [
      {
        callId: 'read-facts',
        contextRefs: ['facts:current-offer'],
        declaredBudgetCapCents: 1,
        payload: {},
        toolId: 'tool.fact.read',
      },
      {
        callId: 'score-output',
        contextRefs: ['facts:current-offer'],
        declaredBudgetCapCents: 1,
        payload: {},
        toolId: 'tool.quality.score',
      },
    ],
    input: dailyIndustrySkillInput(),
    invocationId: 'invocation-missing-effect-replay',
    output: {
      schemaRevision: 'skill-output.intent-decision@1',
      target: 'workflow_artifact' as const,
    },
    productUsageTaskId: 'task-one-product-usage',
    skillRevisionRef: revision.skillRevisionRef,
    taskId: 'task-missing-effect-replay',
    workspaceId: 'workspace-skill-invocation',
  };
  const executor: SkillInvocationExecutor = {
    async execute(effect) {
      return {
        acceptanceStatus: 'accepted',
        costCents: 1,
        providerReceipt: {
          accepted: true,
          providerTaskRef: `provider-${effect.callId}`,
        },
        usage: { inputTokens: 2, outputTokens: 1 },
      };
    },
    async generate() {
      return { value: intentDecisionOutput() };
    },
  };

  await service.invoke(invocation, executor, discardResultPublisher);
  repository.missingEffectIds.add(
    'invocation-missing-effect-replay:score-output',
  );

  await assert.rejects(
    service.invoke(invocation, executor, discardResultPublisher),
    /工具调用记录不完整/u,
  );
  assert.equal(repository.updates, 0);
});

test('an observed over-budget child effect is persisted before invocation rejection', async () => {
  const repository = new MemorySkillRepository();
  const service = createEffectTestService(repository);
  const revision = await createAcceptedEffectSkill(service);

  await assert.rejects(
    service.invoke(
      {
        calls: [
          {
            callId: 'read-facts',
            contextRefs: ['facts:current-offer'],
            declaredBudgetCapCents: 1,
            payload: {},
            toolId: 'tool.fact.read',
          },
        ],
        input: dailyIndustrySkillInput(),
        invocationId: 'invocation-over-budget',
        output: {
          schemaRevision: 'skill-output.intent-decision@1',
          target: 'workflow_artifact',
        },
        productUsageTaskId: 'task-one-product-usage',
        skillRevisionRef: revision.skillRevisionRef,
        taskId: 'task-over-budget',
        workspaceId: 'workspace-skill-invocation',
      },
      {
        async execute() {
          return {
            acceptanceStatus: 'accepted',
            costCents: 3,
            providerReceipt: {
              accepted: true,
              providerTaskRef: 'provider-spent-three',
            },
            usage: { inputTokens: 12, outputTokens: 4 },
          };
        },
        async generate() {
          throw new Error('over-budget effects must stop before generation');
        },
      },
      discardResultPublisher,
      {
        validate() {
          return { qualityPassed: true, schemaValid: true };
        },
      },
    ),
    /实际成本超过声明的预算上限/u,
  );

  const effect = await repository.getChildEffect(
    'invocation-over-budget:read-facts',
  );
  assert.equal(effect?.settlementStatus, 'over_budget');
  assert.equal(effect?.acceptanceStatus, 'rejected');
  assert.equal(effect?.costCents, 3);
  assert.equal(effect?.providerReceipt.providerTaskRef, 'provider-spent-three');
});

test('retry after a mid-invocation crash replays each settled effect and executes only the missing effect', async () => {
  const repository = new MemorySkillRepository();
  const service = createEffectTestService(repository);
  const revision = await createAcceptedEffectSkill(service);
  const attempts = new Map<string, number>();
  const input = {
    calls: [
      {
        callId: 'read-facts',
        contextRefs: ['facts:current-offer'],
        declaredBudgetCapCents: 2,
        payload: {},
        toolId: 'tool.fact.read',
      },
      {
        callId: 'score-output',
        contextRefs: ['facts:current-offer'],
        declaredBudgetCapCents: 2,
        payload: {},
        toolId: 'tool.quality.score',
      },
    ],
    input: dailyIndustrySkillInput(),
    invocationId: 'invocation-mid-crash',
    output: {
      schemaRevision: 'skill-output.intent-decision@1',
      target: 'workflow_artifact' as const,
    },
    productUsageTaskId: 'task-one-product-usage',
    skillRevisionRef: revision.skillRevisionRef,
    taskId: 'task-mid-crash',
    workspaceId: 'workspace-skill-invocation',
  };
  const executor: SkillInvocationExecutor = {
    async execute(effect) {
      const attempt = (attempts.get(effect.callId) ?? 0) + 1;
      attempts.set(effect.callId, attempt);
      if (effect.callId === 'score-output' && attempt === 1) {
        throw new Error('fixture crash after first effect');
      }
      return {
        acceptanceStatus: 'accepted',
        costCents: 2,
        providerReceipt: {
          accepted: true,
          providerTaskRef: `provider-${effect.callId}`,
        },
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
    async generate() {
      return { value: intentDecisionOutput() };
    },
  };
  const validator = {
    validate() {
      return { qualityPassed: true, schemaValid: true };
    },
  };

  await assert.rejects(
    service.invoke(input, executor, discardResultPublisher, validator),
    /fixture crash/u,
  );
  const receipt = await service.invoke(
    input,
    executor,
    discardResultPublisher,
    validator,
  );

  assert.deepEqual(Object.fromEntries(attempts), {
    'read-facts': 1,
    'score-output': 2,
  });
  assert.equal(
    (await repository.getChildEffect(receipt.childEffectIds[0]!))?.retryStatus,
    'replayed',
  );
  assert.equal(receipt.childEffectIds.length, 2);
});

test('SkillDeployment maps one canonical frozen revision to a provider native version without replacing product truth', async () => {
  const repository = new MemorySkillRepository();
  const service = new SkillService(repository, () => NOW, testPromptSnapshots);
  const revision = await createAcceptedEffectSkill(service);

  await assert.rejects(
    service.registerDeployment({
      artifactType: 'instruction',
      channel: 'official-direct',
      deploymentId: 'skill-deployment-effect-boundary',
      executionMode: 'harness_native',
      nativeSkillId: 'provider-skill-88',
      nativeVersion: 'provider-revision-5',
      provider: 'fixture-provider',
      skillRevisionRef: revision.skillRevisionRef,
    }),
    /首发部署只开放/u,
  );

  assert.equal(
    await repository.getDeployment('skill-deployment-effect-boundary'),
    null,
  );
  assert.equal(
    (await repository.getRevision(revision.skillRevisionRef))
      ?.skillRevisionRef,
    revision.skillRevisionRef,
  );
});

test('provider-native deployment requires an explicit gate and evidence reference', async () => {
  const repository = new MemorySkillRepository();
  const service = new SkillService(repository, () => NOW, testPromptSnapshots);
  const revision = await createAcceptedEffectSkill(service);

  await assert.rejects(
    service.registerDeployment({
      artifactType: 'reference',
      channel: 'official-direct',
      deploymentId: 'skill-deployment-provider-native',
      executionMode: 'provider_native',
      nativeSkillId: 'provider-skill-89',
      nativeVersion: 'provider-revision-6',
      provider: 'fixture-provider',
      skillRevisionRef: revision.skillRevisionRef,
    }),
    /显式开关和证据引用/u,
  );

  const providerService = new SkillService(
    new MemorySkillRepository(),
    () => NOW,
    testPromptSnapshots,
  );
  const providerRevision = await createAcceptedEffectSkill(
    providerService,
    'provider_native',
  );
  const gated = await providerService.registerDeployment({
    artifactType: 'reference',
    channel: 'official-direct',
    deploymentId: 'skill-deployment-provider-native-gated',
    executionMode: 'provider_native',
    experimentalGate: {
      enabled: true,
      evidenceRef: 'evidence://provider-native/fixture-verified',
    },
    nativeSkillId: 'provider-skill-90',
    nativeVersion: 'provider-revision-7',
    provider: 'fixture-provider',
    skillRevisionRef: providerRevision.skillRevisionRef,
  });
  assert.equal(
    gated.rolloutEvidenceRef,
    'evidence://provider-native/fixture-verified',
  );
});

test('Foundation commands reach define, accept, bind, rollback, and deployment operations', async () => {
  const repository = new MemorySkillRepository();
  const service = new SkillService(
    repository,
    () => NOW,
    testPromptSnapshots,
  );
  const module = new SkillFoundationModule(service);
  const context = {
    actor: 'admin' as const,
    correlationId: 'corr-skill-foundation',
    userId: 'operator-foundation',
    workspaceId: 'workspace-foundation',
  };
  const skillId = 'skill.foundation-chain';
  const workflowRevisionRef = 'workflow.foundation-chain@1';
  const instructionV1 = 'Use the first accepted instruction.';
  const instructionV2 = 'Use the second accepted instruction.';
  const definition = (
    instruction: string,
    expectedRevision: number | null,
    version: string,
  ) => ({
    expectedRevision,
    frontmatter: {
      description: 'Exercises the Foundation Skill command chain.',
      name: 'foundation-chain',
    },
    governance: {
      ...governance(),
      workflowRevisionRefs: [workflowRevisionRef],
    },
    instruction,
    name: 'Foundation chain',
    presentationPolicy: 'explainable',
    promptReference: registerPrompt({
      content: instruction,
      contentHash: sha256(instruction),
      isFallback: false as const,
      label: 'production' as const,
      name: 'skills/foundation-chain',
      source: 'langfuse' as const,
      version,
    }),
    skillId,
  });
  const execute = (
    action: string,
    payload: Record<string, unknown>,
  ) =>
    module.execute({
      context,
      idempotencyKey: `${action}-${String(payload.skillRevisionRef ?? payload.bindingId ?? 'define')}`,
      input: { action, payload },
    });
  const evalFor = (skillRevisionRef: string, version: string): EvalRun => ({
    ...skillEvalRun(skillRevisionRef),
    results: [
      {
        ...skillEvalRun(skillRevisionRef).results[0]!,
        promptRevision: `skills/foundation-chain@${version}`,
      },
    ],
    runId: `skills-foundation-chain-${version}`,
    suiteId: 'skills-foundation-chain',
    suiteRevision: 'skills-foundation-chain@1',
  });

  const definedV1 = (await execute(
    'skill_define',
    definition(instructionV1, null, '1'),
  )) as { revision: { skillRevisionRef: string } };
  await execute('skill_accept', {
    evalRun: evalFor(definedV1.revision.skillRevisionRef, '1'),
    skillRevisionRef: definedV1.revision.skillRevisionRef,
  });
  const definedV2 = (await execute(
    'skill_define',
    definition(instructionV2, 1, '2'),
  )) as { revision: { skillRevisionRef: string } };
  await execute('skill_accept', {
    evalRun: evalFor(definedV2.revision.skillRevisionRef, '2'),
    skillRevisionRef: definedV2.revision.skillRevisionRef,
  });
  await assert.rejects(
    execute('skill_bind', {
      bindingId: 'binding-foundation-retired-planner',
      mode: 'planner_selected',
      skillRevisionRef: definedV2.revision.skillRevisionRef,
      stage: 'intent_naming',
      workflowRevisionRef,
    }),
    /绑定模式或阶段不受支持/u,
  );
  await execute('skill_bind', {
    bindingId: 'binding-foundation-v2',
    mode: 'required',
    skillRevisionRef: definedV2.revision.skillRevisionRef,
    stage: 'intent_naming',
    workflowRevisionRef,
  });
  await execute('skill_rollback', {
    bindingId: 'binding-foundation-v1',
    sourceBindingId: 'binding-foundation-v2',
    targetSkillRevisionRef: definedV1.revision.skillRevisionRef,
    workflowRevisionRef,
  });
  const deployment = (await execute('skill_deployment', {
    artifactType: 'instruction',
    channel: 'prompt-materialization',
    deploymentId: 'deployment-foundation-v1',
    executionMode: 'prompt_materialized',
    nativeSkillId: 'materialized-foundation-v1',
    nativeVersion: '1',
    provider: 'core-harness',
    skillRevisionRef: definedV1.revision.skillRevisionRef,
  })) as { skillRevisionRef: string };

  assert.equal(
    (
      await service.resolveStage({
        stage: 'intent_naming',
        userSelectedSkillRefs: [],
        workflowRevisionRef,
      })
    ).allowlist[0]?.skillRevisionRef,
    definedV1.revision.skillRevisionRef,
  );
  assert.equal(
    deployment.skillRevisionRef,
    definedV1.revision.skillRevisionRef,
  );
});

test('skill_define rejects inline prompt content before a revision write', async () => {
  const repository = new MemorySkillRepository();
  const promptContent = 'Trusted prompt snapshot from Langfuse.';
  const service = new SkillService(repository, () => NOW, {
    async capture() {
      return {
        content: promptContent,
        contentHash: sha256(promptContent),
        isFallback: false,
        label: 'production',
        name: 'harness/intent-naming',
        source: 'langfuse',
        version: '42',
      };
    },
  });
  const module = new SkillFoundationModule(service);

  await assert.rejects(
    module.execute({
      context: {
        actor: 'admin',
        correlationId: 'corr-inline-prompt-rejected',
        userId: 'operator-inline-prompt-rejected',
        workspaceId: 'workspace-inline-prompt-rejected',
      },
      idempotencyKey: 'skill-define-inline-prompt-rejected',
      input: {
        action: 'skill_define',
        payload: {
          expectedRevision: null,
          frontmatter: {
            description:
              'Grounds daily beauty content. Use for daily merchant posts.',
            name: 'inline-prompt-rejected',
          },
          governance: governance(),
          instruction: 'Use grounded daily context.',
          name: 'Inline prompt rejection',
          presentationPolicy: 'backend_only',
          promptReference: {
            content: 'Caller-controlled prompt body.',
            contentHash: sha256(promptContent),
            name: 'harness/intent-naming',
            version: '42',
          },
          skillId: 'skill.inline-prompt-rejected',
        },
      },
    }),
    /prompt reference must not include content/u,
  );
  assert.equal(
    await repository.getRevisionHead('skill.inline-prompt-rejected'),
    null,
  );
});

test('skill_define separates frontmatter, governance, and trusted prompt fallback while redacting content from its response', async () => {
  const repository = new MemorySkillRepository();
  const promptContent = 'Trusted prompt snapshot from Langfuse.';
  const service = new SkillService(repository, () => NOW, {
    async capture() {
      return {
        content: promptContent,
        contentHash: sha256(promptContent),
        isFallback: false,
        label: 'production',
        name: 'harness/intent-naming',
        source: 'langfuse',
        version: '42',
      };
    },
  });
  const module = new SkillFoundationModule(service);
  const result = (await module.execute({
    context: {
      actor: 'admin',
      correlationId: 'corr-sidecar-definition',
      userId: 'operator-sidecar-definition',
      workspaceId: 'workspace-sidecar-definition',
    },
    idempotencyKey: 'skill-define-sidecar-definition',
    input: {
      action: 'skill_define',
      payload: {
        expectedRevision: null,
        frontmatter: {
          'allowed-tools': 'read_context check',
          description:
            'Grounds daily beauty content. Use for daily merchant posts.',
          metadata: { author: 'meiye' },
          name: 'daily-beauty-context',
        },
        governance: governance(),
        instruction: 'Use grounded daily context.',
        name: 'Daily beauty context',
        presentationPolicy: 'backend_only',
        promptReference: {
          contentHash: sha256(promptContent),
          name: 'harness/intent-naming',
          version: '42',
        },
        skillId: 'skill.sidecar-definition',
      },
    },
  })) as {
    revision: {
      skillRevisionRef: string;
    };
  };

  assert.equal(JSON.stringify(result).includes(promptContent), false);
  const stored = await repository.getRevision(
    result.revision.skillRevisionRef,
  );
  assert.deepEqual(stored?.manifest, {
    'allowed-tools': 'read_context check',
    description:
      'Grounds daily beauty content. Use for daily merchant posts.',
    metadata: { author: 'meiye' },
    name: 'daily-beauty-context',
  });
  assert.deepEqual(stored?.governance, governance());
  assert.equal(stored?.prompt.fallbackContent, promptContent);
});

test('backend-only Skill cannot be bound as user-selected', async () => {
  const service = new SkillService(
    new MemorySkillRepository(),
    () => NOW,
    testPromptSnapshots,
  );
  const revision = await createAcceptedSkill(service, 'backend-binding');

  await assert.rejects(
    service.bindRevision({
      bindingId: 'binding.backend-user-selected',
      mode: 'user_selected',
      skillRevisionRef: revision.skillRevisionRef,
      stage: 'intent_naming',
      workflowRevisionRef: 'workflow.binding-matrix@1',
    }),
    /后台专用 Skill 不能由用户选择/u,
  );
});

test('rolling a binding back to the previous frozen revision restores the fixture judgment', async () => {
  const service = new SkillService(
    new MemorySkillRepository(),
    () => NOW,
    testPromptSnapshots,
  );
  const skillId = 'skill.rollback';
  await service.defineCatalogEntry({
    actorId: 'operator-1',
    name: 'Rollback Skill',
    presentationPolicy: 'explainable',
    skillId,
  });
  const first = await draftAndAcceptRevision(
    service,
    skillId,
    null,
    'Keep the intent in guidance until the merchant supplies industry context.',
    '1',
  );
  const second = await draftAndAcceptRevision(
    service,
    skillId,
    1,
    'Use the declared industry context and continue customized creation.',
    '2',
  );
  await service.bindRevision({
    bindingId: 'binding.rollback-current',
    mode: 'required',
    skillRevisionRef: second.skillRevisionRef,
    stage: 'intent_naming',
    workflowRevisionRef: 'workflow.rollback@2',
  });

  const current = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: 'workflow.rollback@2',
  });
  await service.rollbackBinding({
    bindingId: 'binding.rollback-restored',
    sourceBindingId: 'binding.rollback-current',
    targetSkillRevisionRef: first.skillRevisionRef,
    workflowRevisionRef: 'workflow.rollback@3',
  });
  const restored = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: 'workflow.rollback@3',
  });
  const runner: StructuredNodeRunner = {
    async run(request) {
      const customized = request.instructions.includes('continue customized');
      return {
        attempts: 1,
        output: request.schema.parse({
          blockingGap: customized
            ? null
            : {
                allowFreeText: true,
                field: 'industry',
                options: [],
                question: '你主要做哪个美业项目？',
                scope: 'current_task',
              },
          deliveryLayer: 'copy',
          implicitConstraints: [],
          normalizedIntent: '写一条护理日常',
          relevantAssetCategories: ['industry_category'],
          route: customized ? 'customized' : 'guidance',
          taskType: 'daily_service_exposure',
          usedAssetCategories: customized ? ['industry_category'] : [],
        }),
        providerTaskRef: 'fixture-skill-rollback',
        replayed: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
  const intentInput = {
    intent: {
      assetReferences: [],
      context: {
        intent: '写一条护理日常',
        sourceSummaries: [],
        workId: 'work-skill-rollback',
      },
    },
    workflowId: 'workflow-skill-rollback',
    workflowRevision: 1,
  };
  const currentJudgment = await nameHarnessIntent(
    { ...intentInput, skillInstructions: current.allowlist },
    runner,
  );
  const restoredJudgment = await nameHarnessIntent(
    { ...intentInput, skillInstructions: restored.allowlist },
    runner,
  );

  assert.equal(currentJudgment.declaration.route, 'customized');
  assert.equal(restoredJudgment.declaration.route, 'guidance');
});

test('rollback rejects the same revision and supersedes a binding on the same workflow stage', async () => {
  const repository = new MemorySkillRepository();
  const service = new SkillService(repository, () => NOW, testPromptSnapshots);
  const skillId = 'skill.rollback-same-workflow';
  await service.defineCatalogEntry({
    actorId: 'operator-1',
    name: 'Same workflow rollback Skill',
    presentationPolicy: 'explainable',
    skillId,
  });
  const first = await draftAndAcceptRevision(
    service,
    skillId,
    null,
    'Use the stable v1 behavior.',
    '1',
  );
  const second = await draftAndAcceptRevision(
    service,
    skillId,
    1,
    'Use the changed v2 behavior.',
    '2',
  );
  await service.bindRevision({
    bindingId: 'binding.rollback-v2',
    mode: 'required',
    skillRevisionRef: second.skillRevisionRef,
    stage: 'intent_naming',
    workflowRevisionRef: 'workflow.rollback@2',
  });

  await assert.rejects(
    service.rollbackBinding({
      bindingId: 'binding.rollback-same-ref',
      sourceBindingId: 'binding.rollback-v2',
      targetSkillRevisionRef: second.skillRevisionRef,
      workflowRevisionRef: 'workflow.rollback@2',
    }),
    /目标版本必须不同于当前版本/u,
  );

  await service.rollbackBinding({
    bindingId: 'binding.rollback-v1',
    sourceBindingId: 'binding.rollback-v2',
    targetSkillRevisionRef: first.skillRevisionRef,
    workflowRevisionRef: 'workflow.rollback@2',
  });
  const resolved = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: 'workflow.rollback@2',
  });

  assert.deepEqual(
    resolved.allowlist.map((skill) => skill.skillRevisionRef),
    [first.skillRevisionRef],
  );
});

function governance() {
  return {
    allowedTools: ['read_context', 'check'],
    budget: {
      maxChildEffects: 2,
      maxCostCents: 5,
      timeoutMs: 10_000,
    },
    contextScopes: ['industry_category'],
    executionMode: 'prompt_materialized' as const,
    fallback: 'skip' as const,
    inputSchemaRef: 'skill-input.daily-industry@1',
    outputSchemaRef: 'skill-output.intent-decision@1',
    requiredModelCapabilities: ['structured_output'],
    sideEffectClass: 'none' as const,
    workflowRevisionRefs: ['workflow.daily-copy@1'],
  };
}

function skillEvalRun(skillRevisionRef: string): EvalRun {
  return {
    createdAt: NOW,
    mode: 'recorded_fixture',
    passed: true,
    results: [
      {
        caseId: 'daily-industry-context',
        gateId: 'skill_revision_acceptance',
        memoryDiff: null,
        passed: true,
        promptRevision: 'harness/intent-naming@42',
        reason: 'The accepted fixture selects only the declared context.',
        scorerRevision: 'skill-routing-scorer@1',
        skillRevisionRef,
      },
    ],
    runId: 'skills-intent-routing-recorded-1',
    schemaVersion: 'eval-run/v1',
    suiteId: 'skills-intent-routing',
    suiteRevision: 'skills-intent-routing@1',
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function promptKey(reference: {
  contentHash: string;
  name: string;
  version: string;
}) {
  return `${reference.name}\u0000${reference.version}\u0000${reference.contentHash}`;
}

function registerPrompt(prompt: HarnessFrozenPrompt) {
  testPromptSnapshotsByReference.set(promptKey(prompt), prompt);
  return {
    contentHash: prompt.contentHash,
    name: prompt.name,
    version: prompt.version,
  };
}

function dailyIndustrySkillInput() {
  return {
    context: {
      workId: 'work-skill-invocation',
      intent: '为今天的团购写一条行业内容',
      scene: '日常项目曝光',
      sourceSummaries: ['门店价目表'],
    },
    assetReferences: ['asset-price-list'],
  };
}

function intentDecisionOutput() {
  return {
    normalizedIntent: '为今天的团购写一条行业内容',
    taskType: 'daily_service_exposure',
    deliveryLayer: 'copy',
    relevantAssetCategories: [
      'product_service',
      'industry_category',
    ],
    usedAssetCategories: ['industry_category'],
    route: 'customized',
    implicitConstraints: ['只使用已确认的行业事实'],
    blockingGap: null,
  };
}

function withGeneratedOutput(
  executor: SkillChildEffectExecutor,
  value: unknown = intentDecisionOutput(),
): SkillInvocationExecutor {
  return {
    ...executor,
    async generate() {
      return { value: structuredClone(value) };
    },
  };
}

async function createAcceptedSkill(
  service: SkillService,
  suffix: string,
) {
  const skillId = `skill.${suffix}`;
  const instruction = `Apply the ${suffix} instruction only in the declared stage.`;
  await service.defineCatalogEntry({
    actorId: 'operator-1',
    name: `${suffix} skill`,
    presentationPolicy:
      suffix === 'user_selected' ? 'user_selectable' : 'backend_only',
    skillId,
  });
  const draft = await service.draftRevision({
    actorId: 'operator-1',
    expectedRevision: null,
    governance: {
      ...governance(),
      workflowRevisionRefs: ['workflow.binding-matrix@1'],
    },
    instruction,
    manifest: {
      description: `Fixture for the ${suffix} Skill behavior.`,
      name: suffix.replaceAll('_', '-'),
    },
    promptReference: registerPrompt({
      content: instruction,
      contentHash: sha256(instruction),
      isFallback: false,
      label: 'production',
      name: `skills/${suffix}`,
      source: 'langfuse',
      version: '1',
    }),
    skillId,
  });
  return service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRun: {
      ...skillEvalRun(draft.skillRevisionRef),
      results: [
        {
          ...skillEvalRun(draft.skillRevisionRef).results[0]!,
          promptRevision: `skills/${suffix}@1`,
        },
      ],
      runId: `skills-${suffix}-run-1`,
      suiteId: `skills-${suffix}`,
      suiteRevision: `skills-${suffix}@1`,
    },
    skillRevisionRef: draft.skillRevisionRef,
  });
}

async function createAcceptedEffectSkill(
  service: SkillService,
  executionMode: 'harness_native' | 'provider_native' = 'harness_native',
) {
  const skillId =
    executionMode === 'provider_native'
      ? 'skill.effect-boundary-provider-native'
      : 'skill.effect-boundary';
  const instruction =
    'Read declared facts and score the candidate without writing product state.';
  await service.defineCatalogEntry({
    actorId: 'operator-1',
    name: 'Effect boundary',
    presentationPolicy: 'backend_only',
    skillId,
  });
  const draft = await service.draftRevision({
    actorId: 'operator-1',
    expectedRevision: null,
    governance: {
      ...governance(),
      allowedTools: ['tool.fact.read', 'tool.quality.score'],
      budget: {
        maxChildEffects: 2,
        maxCostCents: 4,
        timeoutMs: 10_000,
      },
      contextScopes: ['facts'],
      executionMode,
      fallback: 'fail_closed',
      requiredModelCapabilities: [
        'structured_output',
        'tool_calling',
      ],
      sideEffectClass: 'read',
      workflowRevisionRefs: ['workflow.effects@1'],
    },
    instruction,
    manifest: {
      description: 'Exercises the bounded Skill effect contract.',
      name:
        executionMode === 'provider_native'
          ? 'effect-boundary-provider-native'
          : 'effect-boundary',
    },
    promptReference: registerPrompt({
      content: instruction,
      contentHash: sha256(instruction),
      isFallback: false,
      label: 'production',
      name: 'skills/effect-boundary',
      source: 'langfuse',
      version: '1',
    }),
    skillId,
  });
  return service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRun: {
      ...skillEvalRun(draft.skillRevisionRef),
      results: [
        {
          ...skillEvalRun(draft.skillRevisionRef).results[0]!,
          promptRevision: 'skills/effect-boundary@1',
        },
      ],
      runId: 'skills-effect-boundary-run-1',
      suiteId: 'skills-effect-boundary',
      suiteRevision: 'skills-effect-boundary@1',
    },
    skillRevisionRef: draft.skillRevisionRef,
  });
}

async function draftAndAcceptRevision(
  service: SkillService,
  skillId: string,
  expectedRevision: number | null,
  instruction: string,
  version: string,
) {
  const draft = await service.draftRevision({
    actorId: 'operator-1',
    expectedRevision,
    governance: {
      ...governance(),
      workflowRevisionRefs: [
        'workflow.rollback@2',
        'workflow.rollback@3',
      ],
    },
    instruction,
    manifest: {
      description: 'Exercises deterministic Skill rollback behavior.',
      name: 'rollback',
    },
    promptReference: registerPrompt({
      content: instruction,
      contentHash: sha256(instruction),
      isFallback: false,
      label: 'production',
      name: 'skills/rollback',
      source: 'langfuse',
      version,
    }),
    skillId,
  });
  return service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRun: {
      ...skillEvalRun(draft.skillRevisionRef),
      results: [
        {
          ...skillEvalRun(draft.skillRevisionRef).results[0]!,
          promptRevision: `skills/rollback@${version}`,
        },
      ],
      runId: `skills-rollback-run-${version}`,
      suiteId: 'skills-rollback',
      suiteRevision: `skills-rollback@${version}`,
    },
    skillRevisionRef: draft.skillRevisionRef,
  });
}
