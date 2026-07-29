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
  materializeSkillInstructions,
  RegistrySkillOutputValidator,
  skillPromptSnapshotPortFromHarness,
  SkillFoundationModule,
  SkillPromptAuthorityUnavailableError,
  SkillService,
  StaticSkillToolExecutionAuthorizer,
  type SkillBinding,
  type SkillChildEffectExecutor,
  type SkillGovernanceSidecar,
  type SkillInvocationExecutor,
  type SkillInvocationResultPublisher,
} from './index.js';
import { DurableSkillInstructionResolver } from './runtime.js';

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
  async reference() {
    const snapshot = [...testPromptSnapshotsByReference.values()].find(
      (candidate) => candidate.name === 'harness/intent-naming',
    );
    assert.ok(snapshot, 'Test prompt reference must be registered.');
    return snapshot;
  },
};

async function registerEvalRunForTest(
  service: SkillService,
  run: EvalRun,
) {
  const repository = Reflect.get(
    service,
    'repository',
  ) as MemorySkillRepository;
  return repository.putImmutable(run.runId, run);
}
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
  let promptCaptureCount = 0;
  const service = new SkillService(
    new MemorySkillRepository(),
    () => NOW,
    {
      async capture(reference) {
        promptCaptureCount += 1;
        return testPromptSnapshots.capture(reference);
      },
    },
  );
  await service.defineCatalogEntry({
    actorId: 'operator-1',
    name: 'Daily industry context',
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
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
    triggerCondition: { harnessStage: 'intent_naming' },
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

  const evalRun = skillEvalRun(draft.skillRevisionRef);
  await registerEvalRunForTest(service, evalRun);
  const frozen = await service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRunId: evalRun.runId,
    skillRevisionRef: draft.skillRevisionRef,
  });
  const resolver = new DurableSkillInstructionResolver(
    service,
    {
      async getRecipeByRevisionId() {
        return {
          workflowRevisionRef: 'workflow.daily-copy@1',
        };
      },
    } as never,
  );
  const capturesBeforeSelection = promptCaptureCount;
  const selectedManifests = await resolver.selectManifests({
    recipeRevisionId: 'recipe.daily-copy@1',
    stage: 'intent_naming',
    workflowId: 'task-daily-copy',
    workflowRevision: 1,
    workspaceId: 'workspace-daily-copy',
  });
  assert.equal(promptCaptureCount, capturesBeforeSelection);
  assert.deepEqual(selectedManifests, [
    {
      skillRevisionRef: draft.skillRevisionRef,
      contentHash: frozen.contentHash,
      requiredModelCapabilities: ['structured_output'],
    },
  ]);
  const materializedManifests =
    await resolver.materializeManifests(selectedManifests);
  assert.equal(promptCaptureCount, capturesBeforeSelection + 1);
  assert.equal(
    materializedManifests[0]?.resolvedInstruction.skillRevisionRef,
    draft.skillRevisionRef,
  );
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
  assert.deepEqual(
    resolved.allowlist[0]?.requiredModelCapabilities,
    ['structured_output'],
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
      triggerCondition: { harnessStage: 'intent_naming' },
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
    triggerCondition: { harnessStage: 'intent_naming' },
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
      triggerCondition: {
        harnessStage: 'intent_naming',
        industryCategory: null,
        tenantId: null,
      },
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
    triggerCondition: { harnessStage: 'intent_naming' },
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
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
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
  await assert.rejects(
    service.draftRevision({
      actorId: 'operator-1',
      expectedRevision: null,
      governance: {
        ...governance(),
        inputSchemaRef: 'skill-output.intent-decision@1',
        outputSchemaRef: 'skill-input.daily-industry@1',
        workflowRevisionRefs: ['workflow.invalid-schema@1'],
      },
      instruction: PROMPT_CONTENT,
      manifest: {
        description: 'Swapped input and output schema fixture.',
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
    /inputSchemaRef must reference a skill-input schema/u,
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
  const revision = await createAcceptedEffectSkill(
    service,
    'harness_native',
    ['SKILL.md', 'assets/preview.png'],
  );

  await assert.rejects(
    service.registerDeployment({
      channel: 'official-direct',
      deploymentId: 'skill-deployment-package-drift',
      executionMode: 'harness_native',
      nativeSkillId: 'provider-skill-87',
      nativeVersion: 'provider-revision-4',
      packagePaths: ['SKILL.md'],
      provider: 'fixture-provider',
      skillRevisionRef: revision.skillRevisionRef,
    }),
    /package paths must match the frozen revision/u,
  );

  await assert.rejects(
    service.registerDeployment({
      channel: 'official-direct',
      deploymentId: 'skill-deployment-effect-boundary',
      executionMode: 'harness_native',
      nativeSkillId: 'provider-skill-88',
      nativeVersion: 'provider-revision-5',
      packagePaths: ['SKILL.md', 'assets/preview.png'],
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
  const revision = await createAcceptedEffectSkill(
    service,
    'harness_native',
    ['SKILL.md', 'references/provider.md'],
  );

  await assert.rejects(
    service.registerDeployment({
      channel: 'official-direct',
      deploymentId: 'skill-deployment-provider-native',
      executionMode: 'provider_native',
      nativeSkillId: 'provider-skill-89',
      nativeVersion: 'provider-revision-6',
      packagePaths: ['SKILL.md', 'references/provider.md'],
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
    ['SKILL.md', 'references/provider.md'],
  );
  const gated = await providerService.registerDeployment({
    channel: 'official-direct',
    deploymentId: 'skill-deployment-provider-native-gated',
    executionMode: 'provider_native',
    experimentalGate: {
      enabled: true,
      evidenceRef: 'evidence://provider-native/fixture-verified',
    },
    nativeSkillId: 'provider-skill-90',
    nativeVersion: 'provider-revision-7',
    packagePaths: ['SKILL.md', 'references/provider.md'],
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
      description: `Exercises Foundation Skill revision ${version}.`,
      name: 'foundation-chain',
    },
    governance: {
      ...governance(),
      workflowRevisionRefs: [workflowRevisionRef],
    },
    instruction,
    packagePaths: ['SKILL.md', 'assets/example.png', 'evals/evals.json'],
    name: 'Foundation chain',
    sourceKind: 'authored',
    tier: 'platform',
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
  const evalV1 = evalFor(definedV1.revision.skillRevisionRef, '1');
  await repository.putImmutable(evalV1.runId, evalV1);
  await execute('skill_accept', {
    evalRunId: evalV1.runId,
    skillRevisionRef: definedV1.revision.skillRevisionRef,
  });
  const definedV2 = (await execute(
    'skill_define',
    definition(instructionV2, 1, '2'),
  )) as { revision: { skillRevisionRef: string } };
  const evalV2 = evalFor(definedV2.revision.skillRevisionRef, '2');
  await repository.putImmutable(evalV2.runId, evalV2);
  await execute('skill_accept', {
    evalRunId: evalV2.runId,
    skillRevisionRef: definedV2.revision.skillRevisionRef,
  });
  assert.deepEqual(await service.listCatalog(), {
    items: [
      {
        activeRevisionRef: definedV2.revision.skillRevisionRef,
        description: 'Exercises Foundation Skill revision 2.',
        name: 'Foundation chain',
        presentationPolicy: 'explainable',
        skillId,
        sourceKind: 'authored',
        sourceRef: null,
        tier: 'platform',
        updatedAt: NOW,
      },
    ],
    stats: {
      industryTierCorroborated: 0,
      industryTierTotal: 0,
      total: 1,
    },
  });
  await assert.rejects(
    execute('skill_bind', {
      bindingId: 'binding-foundation-retired-planner',
      mode: 'planner_selected',
      skillRevisionRef: definedV2.revision.skillRevisionRef,
      triggerCondition: { harnessStage: 'intent_naming' },
      workflowRevisionRef,
    }),
    /绑定模式或触发条件不受支持/u,
  );
  await execute('skill_bind', {
    bindingId: 'binding-foundation-v2',
    mode: 'required',
    skillRevisionRef: definedV2.revision.skillRevisionRef,
    triggerCondition: { harnessStage: 'intent_naming' },
    workflowRevisionRef,
  });
  await execute('skill_rollback', {
    bindingId: 'binding-foundation-v1',
    sourceBindingId: 'binding-foundation-v2',
    targetSkillRevisionRef: definedV1.revision.skillRevisionRef,
    workflowRevisionRef,
  });
  const deployment = (await execute('skill_deployment', {
    channel: 'prompt-materialization',
    deploymentId: 'deployment-foundation-v1',
    executionMode: 'prompt_materialized',
    nativeSkillId: 'materialized-foundation-v1',
    nativeVersion: '1',
    packagePaths: ['SKILL.md', 'assets/example.png', 'evals/evals.json'],
    provider: 'core-harness',
    skillRevisionRef: definedV1.revision.skillRevisionRef,
  })) as { packagePaths: string[]; skillRevisionRef: string };

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
  assert.deepEqual(
    deployment.packagePaths,
    ['SKILL.md', 'assets/example.png', 'evals/evals.json'],
  );
});

test('Skill operator reads only the fixed production prompt reference', async () => {
  const repository = new MemorySkillRepository();
  const currentPrompt = {
    content: 'Current production prompt.',
    contentHash: sha256('Current production prompt.'),
    isFallback: false,
    label: 'production',
    name: 'harness/intent-naming',
    source: 'langfuse' as const,
    version: '42',
  };
  const service = new SkillService(repository, () => NOW, {
    async capture(reference) {
      assert.deepEqual(reference, {
        contentHash: currentPrompt.contentHash,
        name: currentPrompt.name,
        version: currentPrompt.version,
      });
      return currentPrompt;
    },
    async reference(slot) {
      assert.equal(slot, 'intentNaming');
      return currentPrompt;
    },
  });
  const module = new SkillFoundationModule(service);
  const context = {
    actor: 'admin' as const,
    correlationId: 'corr-skill-authorities',
    userId: 'operator-skill-authorities',
    workspaceId: 'workspace-skill-authorities',
  };

  const promptReference = await module.query({
    context,
    input: {
      action: 'skill_prompt_reference',
      payload: { slot: 'intentNaming' },
    },
  });
  assert.deepEqual(promptReference, {
    contentHash: currentPrompt.contentHash,
    eligibleForAcceptance: true,
    isFallback: false,
    label: 'production',
    name: 'harness/intent-naming',
    source: 'langfuse',
    version: '42',
  });
  assert.equal('content' in promptReference, false);

  await assert.rejects(
    module.query({
      context,
      input: {
        action: 'skill_prompt_reference',
        payload: { slot: 'arbitraryPrompt' },
      },
    }),
    /prompt slot 不受支持/u,
  );

  const defined = (await module.execute({
    context,
    idempotencyKey: 'skill-define-authorities',
    input: {
      action: 'skill_define',
      payload: {
        expectedRevision: null,
        frontmatter: {
          description: 'Uses only server-owned prompt and evaluation facts.',
          name: 'server-owned-authorities',
        },
        governance: governance(),
        instruction: 'Use only confirmed facts.',
        name: 'Server-owned authorities',
        packagePaths: ['SKILL.md'],
        presentationPolicy: 'backend_only',
        promptReference: {
          contentHash: currentPrompt.contentHash,
          name: currentPrompt.name,
          version: currentPrompt.version,
        },
        skillId: 'skill.server-owned-authorities',
        sourceKind: 'authored',
        tier: 'platform',
      },
    },
  })) as { revision: { skillRevisionRef: string } };
  const evalRun = {
    ...skillEvalRun(defined.revision.skillRevisionRef),
    runId: 'eval-server-owned-authorities',
  };
  await repository.putImmutable(evalRun.runId, evalRun);
  assert.deepEqual(
    await repository.putImmutable(evalRun.runId, evalRun),
    evalRun,
  );
  await assert.rejects(
    repository.putImmutable(evalRun.runId, {
      ...evalRun,
      suiteId: 'different-suite',
    }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
  await assert.rejects(
    module.execute({
      context,
      idempotencyKey: 'skill-accept-inline-eval-rejected',
      input: {
        action: 'skill_accept',
        payload: {
          evalRun,
          skillRevisionRef: defined.revision.skillRevisionRef,
        },
      },
    }),
    /不支持字段 evalRun/u,
  );
  await assert.rejects(
    module.execute({
      context,
      idempotencyKey: 'skill-accept-passed-claim-rejected',
      input: {
        action: 'skill_accept',
        payload: {
          evalRunId: evalRun.runId,
          passed: true,
          skillRevisionRef: defined.revision.skillRevisionRef,
        },
      },
    }),
    /不支持字段 passed/u,
  );
  const accepted = (await module.execute({
    context,
    idempotencyKey: 'skill-accept-stored-eval',
    input: {
      action: 'skill_accept',
      payload: {
        evalRunId: evalRun.runId,
        skillRevisionRef: defined.revision.skillRevisionRef,
      },
    },
  })) as { evalRunId: string; status: string };
  assert.equal(accepted.evalRunId, evalRun.runId);
  assert.equal(accepted.status, 'accepted_frozen');
});

test('fallback prompt reference is visible but never acceptance-eligible', async () => {
  const prompt = {
    content: 'Builtin fallback body must stay private.',
    contentHash: sha256('Builtin fallback body must stay private.'),
    fallbackReason: 'unavailable',
    isFallback: true,
    label: 'builtin',
    name: 'harness/intent-naming',
    source: 'builtin' as const,
    version: 'builtin-v1',
  };
  const module = new SkillFoundationModule(
    new SkillService(new MemorySkillRepository(), () => NOW, {
      async capture() {
        return prompt;
      },
      async reference() {
        return prompt;
      },
    }),
  );
  const result = await module.query({
    context: {
      actor: 'admin',
      correlationId: 'corr-skill-fallback-reference',
      userId: 'operator-skill-fallback-reference',
      workspaceId: 'workspace-skill-fallback-reference',
    },
    input: {
      action: 'skill_prompt_reference',
      payload: { slot: 'intentNaming' },
    },
  });

  assert.deepEqual(result, {
    contentHash: prompt.contentHash,
    eligibleForAcceptance: false,
    isFallback: true,
    label: 'builtin',
    name: 'harness/intent-naming',
    reasonCode: 'fallback_prompt',
    source: 'builtin',
    version: 'builtin-v1',
  });
  assert.equal('content' in result, false);
  assert.equal(JSON.stringify(result).includes(prompt.content), false);
});

test('trusted EvalRun registry failures leave the draft and catalog unchanged', async () => {
  const repository = new MemorySkillRepository();
  const prompt = {
    content: 'Trusted production prompt.',
    contentHash: sha256('Trusted production prompt.'),
    isFallback: false,
    label: 'production',
    name: 'harness/intent-naming',
    source: 'langfuse' as const,
    version: '42',
  };
  const service = new SkillService(repository, () => NOW, {
    async capture() {
      return prompt;
    },
  });
  const skillId = 'skill.trusted-eval-failure';
  await service.defineCatalogEntry({
    actorId: 'operator-trusted-eval-failure',
    description: 'Must not progress on untrusted evaluation facts.',
    name: 'Trusted EvalRun failure',
    presentationPolicy: 'backend_only',
    skillId,
    sourceKind: 'authored',
    tier: 'platform',
  });
  const draft = await service.draftRevision({
    actorId: 'operator-trusted-eval-failure',
    expectedRevision: null,
    governance: governance(),
    instruction: 'Use only trusted facts.',
    manifest: {
      description: 'Must not progress on untrusted evaluation facts.',
      name: 'trusted-eval-failure',
    },
    promptReference: {
      contentHash: prompt.contentHash,
      name: prompt.name,
      version: prompt.version,
    },
    skillId,
  });
  const exact = skillEvalRun(draft.skillRevisionRef);
  const cases: Array<{ runId: string; run?: EvalRun }> = [
    { runId: 'eval-not-registered' },
    {
      runId: 'eval-wrong-skill',
      run: {
        ...exact,
        results: exact.results.map((result) => ({
          ...result,
          skillRevisionRef: 'skill.someone-else@1',
        })),
        runId: 'eval-wrong-skill',
      },
    },
    {
      runId: 'eval-wrong-prompt',
      run: {
        ...exact,
        results: exact.results.map((result) => ({
          ...result,
          promptRevision: 'harness/intent-naming@41',
        })),
        runId: 'eval-wrong-prompt',
      },
    },
    {
      runId: 'eval-failed',
      run: {
        ...exact,
        passed: false,
        results: exact.results.map((result) => ({
          ...result,
          passed: false,
          reason: 'The exact gate failed.',
        })),
        runId: 'eval-failed',
      },
    },
  ];

  for (const candidate of cases) {
    if (candidate.run) {
      await repository.putImmutable(candidate.runId, candidate.run);
    }
    await assert.rejects(
      service.acceptAndFreezeRevision({
        actorId: 'operator-trusted-eval-failure',
        evalRunId: candidate.runId,
        skillRevisionRef: draft.skillRevisionRef,
      }),
      candidate.run
        ? /must pass its exact prompt and Skill eval gate/u
        : (error: unknown) =>
            error instanceof P1DomainError && error.code === 'NOT_FOUND',
    );
    assert.equal(
      (await repository.getRevision(draft.skillRevisionRef))?.status,
      'draft',
    );
    assert.equal((await repository.getCatalog(skillId))?.activeRevisionRef, null);
  }
});

test('skill_define keeps store-tier writes closed until workspace ownership exists', async () => {
  const repository = new MemorySkillRepository();
  const module = new SkillFoundationModule(
    new SkillService(repository, () => NOW, testPromptSnapshots),
  );

  await assert.rejects(
    module.execute({
      context: {
        actor: 'admin',
        correlationId: 'corr-store-tier-rejected',
        userId: 'operator-store-tier-rejected',
        workspaceId: 'workspace-store-tier-rejected',
      },
      idempotencyKey: 'skill-define-store-tier-rejected',
      input: {
        action: 'skill_define',
        payload: {
          description: 'Must not become a global store-level entry.',
          name: 'Store entry without ownership',
          presentationPolicy: 'explainable',
          skillId: 'skill.store-without-owner',
          sourceKind: 'induced',
          tier: 'store',
        },
      },
    }),
    /租户维度通电前只允许平台层或行业层/u,
  );
  assert.equal(
    await repository.getCatalog('skill.store-without-owner'),
    null,
  );
});

test('skill_define requires traceable provenance for harvested entries', async () => {
  const repository = new MemorySkillRepository();
  const module = new SkillFoundationModule(
    new SkillService(repository, () => NOW, testPromptSnapshots),
  );

  await assert.rejects(
    module.execute({
      context: {
        actor: 'admin',
        correlationId: 'corr-harvest-source-rejected',
        userId: 'operator-harvest-source-rejected',
        workspaceId: 'workspace-harvest-source-rejected',
      },
      idempotencyKey: 'skill-define-harvest-source-rejected',
      input: {
        action: 'skill_define',
        payload: {
          description: 'Missing the public source evidence.',
          name: 'Untraceable harvest',
          presentationPolicy: 'backend_only',
          skillId: 'skill.untraceable-harvest',
          sourceKind: 'harvested',
          tier: 'platform',
        },
      },
    }),
    /必须提供来源链接与收割时间/u,
  );
  assert.equal(
    await repository.getCatalog('skill.untraceable-harvest'),
    null,
  );
});

test('skill_define rejects inline prompt content before a revision write', async () => {
  const repository = new MemorySkillRepository();
  const promptContent = 'Trusted prompt snapshot from Langfuse.';
  let promptCaptureCount = 0;
  const service = new SkillService(repository, () => NOW, {
    async capture() {
      promptCaptureCount += 1;
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
  const basePayload = {
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
      contentHash: sha256(promptContent),
      name: 'harness/intent-naming',
      version: '42',
    },
    skillId: 'skill.inline-prompt-rejected',
  };

  await assert.rejects(
    module.execute({
      context: {
        actor: 'admin',
        correlationId: 'corr-placeholder-prompt-rejected',
        userId: 'operator-inline-prompt-rejected',
        workspaceId: 'workspace-inline-prompt-rejected',
      },
      idempotencyKey: 'skill-define-placeholder-prompt-rejected',
      input: {
        action: 'skill_define',
        payload: {
          sourceKind: 'authored',
          tier: 'platform',
          ...basePayload,
          promptReference: {
            contentHash: '<sha256>',
            name: 'harness/intent-naming',
            version: '<pinned-version>',
          },
        },
      },
    }),
    /contentHash/u,
  );
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
          sourceKind: 'authored',
          tier: 'platform',
          ...basePayload,
          promptReference: {
            ...basePayload.promptReference,
            content: 'Caller-controlled prompt body.',
          },
        },
      },
    }),
    /prompt reference 不支持字段 content/u,
  );
  await assert.rejects(
    module.execute({
      context: {
        actor: 'admin',
        correlationId: 'corr-legacy-prompt-rejected',
        userId: 'operator-inline-prompt-rejected',
        workspaceId: 'workspace-inline-prompt-rejected',
      },
      idempotencyKey: 'skill-define-legacy-prompt-rejected',
      input: {
        action: 'skill_define',
        payload: {
          sourceKind: 'authored',
          tier: 'platform',
          ...basePayload,
          prompt: { content: 'Legacy caller-controlled prompt body.' },
        },
      },
    }),
    /Skill 定义命令 不支持字段 prompt/u,
  );
  await assert.rejects(
    module.execute({
      context: {
        actor: 'admin',
        correlationId: 'corr-fallback-content-rejected',
        userId: 'operator-inline-prompt-rejected',
        workspaceId: 'workspace-inline-prompt-rejected',
      },
      idempotencyKey: 'skill-define-fallback-content-rejected',
      input: {
        action: 'skill_define',
        payload: {
          sourceKind: 'authored',
          tier: 'platform',
          ...basePayload,
          fallbackContent: 'Caller-controlled frozen fallback.',
        },
      },
    }),
    /Skill 定义命令 不支持字段 fallbackContent/u,
  );
  await assert.rejects(
    module.execute({
      context: {
        actor: 'admin',
        correlationId: 'corr-governance-prompt-rejected',
        userId: 'operator-inline-prompt-rejected',
        workspaceId: 'workspace-inline-prompt-rejected',
      },
      idempotencyKey: 'skill-define-governance-prompt-rejected',
      input: {
        action: 'skill_define',
        payload: {
          sourceKind: 'authored',
          tier: 'platform',
          ...basePayload,
          governance: {
            ...basePayload.governance,
            prompt: { content: 'Sidecar prompt smuggling.' },
          },
        },
      },
    }),
    /governance sidecar is invalid/u,
  );
  await assert.rejects(
    module.execute({
      context: {
        actor: 'admin',
        correlationId: 'corr-empty-instruction-rejected',
        userId: 'operator-inline-prompt-rejected',
        workspaceId: 'workspace-inline-prompt-rejected',
      },
      idempotencyKey: 'skill-define-empty-instruction-rejected',
      input: {
        action: 'skill_define',
        payload: {
          sourceKind: 'authored',
          tier: 'platform',
          ...basePayload,
          instruction: '  ',
        },
      },
    }),
    /instruction/u,
  );
  await assert.rejects(
    module.execute({
      context: {
        actor: 'admin',
        correlationId: 'corr-invalid-revision-rejected',
        userId: 'operator-inline-prompt-rejected',
        workspaceId: 'workspace-inline-prompt-rejected',
      },
      idempotencyKey: 'skill-define-invalid-revision-rejected',
      input: {
        action: 'skill_define',
        payload: {
          sourceKind: 'authored',
          tier: 'platform',
          ...basePayload,
          expectedRevision: 'latest',
        },
      },
    }),
    /expectedRevision/u,
  );
  assert.equal(
    await repository.getRevisionHead('skill.inline-prompt-rejected'),
    null,
  );
  assert.equal(
    await repository.getCatalog('skill.inline-prompt-rejected'),
    null,
  );
  assert.equal(promptCaptureCount, 0);
});

test('skill_define resolves the prompt authority before creating its catalog', async () => {
  const repository = new MemorySkillRepository();
  const service = new SkillService(repository, () => NOW, {
    async capture(reference) {
      return {
        ...reference,
        content: 'Different authority content.',
        contentHash: sha256('Different authority content.'),
        isFallback: false,
        label: 'production',
        source: 'langfuse',
      };
    },
  });
  const module = new SkillFoundationModule(service);

  await assert.rejects(
    module.execute({
      context: {
        actor: 'admin',
        correlationId: 'corr-prompt-authority-rejected',
        userId: 'operator-prompt-authority-rejected',
        workspaceId: 'workspace-prompt-authority-rejected',
      },
      idempotencyKey: 'skill-define-prompt-authority-rejected',
      input: {
        action: 'skill_define',
        payload: {
          sourceKind: 'authored',
          tier: 'platform',
          expectedRevision: null,
          frontmatter: {
            description: 'Rejects a prompt authority mismatch before writing.',
            name: 'prompt-authority-rejected',
          },
          governance: governance(),
          instruction: 'Use only the pinned prompt.',
          name: 'Prompt authority rejection',
          presentationPolicy: 'backend_only',
          promptReference: {
            contentHash: 'c'.repeat(64),
            name: 'harness/intent-naming',
            version: '99',
          },
          skillId: 'skill.prompt-authority-rejected',
        },
      },
    }),
    /does not match its pinned reference/u,
  );
  assert.equal(
    await repository.getCatalog('skill.prompt-authority-rejected'),
    null,
  );
  assert.equal(
    await repository.getRevisionHead('skill.prompt-authority-rejected'),
    null,
  );
});

test('draftRevision normalizes instruction before persistence and content hashing', async () => {
  const repository = new MemorySkillRepository();
  const promptContent = 'Trusted prompt snapshot from Langfuse.';
  const service = new SkillService(repository, () => NOW, {
    async capture(reference) {
      return {
        ...reference,
        content: promptContent,
        isFallback: false,
        label: 'production',
        source: 'langfuse',
      };
    },
  });
  await service.defineCatalogEntry({
    actorId: 'operator-instruction-normalization',
    name: 'Instruction normalization',
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
    presentationPolicy: 'backend_only',
    skillId: 'skill.instruction-normalization',
  });
  const promptReference = {
    contentHash: sha256(promptContent),
    name: 'harness/intent-naming',
    version: '42',
  };
  const common = {
    actorId: 'operator-instruction-normalization',
    governance: governance(),
    manifest: {
      description: 'Normalizes portable Skill instructions before hashing.',
      name: 'instruction-normalization',
    },
    promptReference,
    skillId: 'skill.instruction-normalization',
  };

  const first = await service.draftRevision({
    ...common,
    expectedRevision: null,
    instruction: '  Use only grounded facts. \n',
  });
  const second = await service.draftRevision({
    ...common,
    expectedRevision: 1,
    instruction: 'Use only grounded facts.',
  });

  assert.equal(first.instruction, 'Use only grounded facts.');
  assert.equal(second.instruction, first.instruction);
  assert.equal(second.contentHash, first.contentHash);
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
        sourceKind: 'authored',
        tier: 'platform',
        expectedRevision: null,
        frontmatter: {
          'allowed-tools': 'read_context check',
          description:
            'Grounds daily beauty content. Use for daily merchant posts.',
          metadata: { author: 'meiye' },
          name: 'daily-beauty-context',
        },
        governance: {
          ...governance(),
        },
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
  assert.deepEqual(stored?.governance, {
    ...governance(),
  });
  assert.equal(stored?.prompt.content, promptContent);
  assert.equal(
    Object.hasOwn(stored?.prompt ?? {}, 'fallbackContent'),
    false,
  );
});

test('skill revision rejects any duplicate allowedTools permission authority in the v2 sidecar', async () => {
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
  await service.defineCatalogEntry({
    actorId: 'operator-permission-authority',
    name: 'Permission authority',
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
    presentationPolicy: 'backend_only',
    skillId: 'skill.permission-authority',
  });

  await assert.rejects(
    service.draftRevision({
      actorId: 'operator-permission-authority',
      expectedRevision: null,
      governance: {
        ...governance(),
        allowedTools: ['read_context'],
      } as unknown as SkillGovernanceSidecar,
      instruction: 'Use only the official Skill tool permission.',
      manifest: {
        'allowed-tools': 'read_context',
        description: 'Rejects conflicting tool permission declarations.',
        name: 'permission-authority',
      },
      promptReference: {
        contentHash: sha256(promptContent),
        name: 'harness/intent-naming',
        version: '42',
      },
      skillId: 'skill.permission-authority',
    }),
    /governance sidecar is invalid/u,
  );
  assert.equal(
    await repository.getRevisionHead('skill.permission-authority'),
    null,
  );
});

test('stage resolution uses the frozen prompt fallback with explicit lineage when prompt authority is unavailable', async () => {
  const repository = new MemorySkillRepository();
  const promptContent = 'Trusted fallback for a temporarily unavailable prompt.';
  let authorityFailure: 'none' | 'unavailable' | 'invalid' = 'none';
  let authorityDrifted = false;
  const service = new SkillService(repository, () => NOW, {
    async capture() {
      if (authorityFailure === 'unavailable') {
        throw new SkillPromptAuthorityUnavailableError('fixture unavailable');
      }
      if (authorityFailure === 'invalid') {
        throw new Error('fixture pinned prompt is missing');
      }
      return {
        content: authorityDrifted
          ? 'Drifted prompt authority content.'
          : promptContent,
        contentHash: sha256(promptContent),
        isFallback: false,
        label: 'production',
        name: 'harness/intent-naming',
        source: 'langfuse',
        version: '42',
      };
    },
  });
  await service.defineCatalogEntry({
    actorId: 'operator-fallback',
    name: 'Prompt fallback',
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
    presentationPolicy: 'backend_only',
    skillId: 'skill.prompt-fallback',
  });
  const draft = await service.draftRevision({
    actorId: 'operator-fallback',
    expectedRevision: null,
    governance: governance(),
    instruction: 'Use the portable Skill instructions.',
    manifest: {
      description: 'Exercises frozen prompt fallback lineage.',
      name: 'prompt-fallback',
    },
    promptReference: {
      contentHash: sha256(promptContent),
      name: 'harness/intent-naming',
      version: '42',
    },
    skillId: 'skill.prompt-fallback',
  });
  const evalRun = skillEvalRun(draft.skillRevisionRef);
  await registerEvalRunForTest(service, evalRun);
  await service.acceptAndFreezeRevision({
    actorId: 'operator-fallback',
    evalRunId: evalRun.runId,
    skillRevisionRef: draft.skillRevisionRef,
  });
  await service.bindRevision({
    bindingId: 'binding.prompt-fallback',
    mode: 'required',
    skillRevisionRef: draft.skillRevisionRef,
    triggerCondition: { harnessStage: 'intent_naming' },
    workflowRevisionRef: 'workflow.daily-copy@1',
  });

  authorityFailure = 'unavailable';
  const resolved = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: 'workflow.daily-copy@1',
  });

  assert.equal(
    resolved.allowlist[0]?.instruction,
    'Use the portable Skill instructions.',
  );
  assert.equal(resolved.allowlist[0]?.prompt?.isFallback, true);
  assert.match(
    resolved.allowlist[0]?.prompt?.fallbackReason ?? '',
    /authority is unavailable/u,
  );
  const [receipt] = await service.recordPromptMaterializationReceipts({
    instructions: resolved.allowlist,
    stage: 'intent_naming',
    taskId: 'task-prompt-fallback',
    workflowRevisionRef: 'workflow.daily-copy@1',
    workspaceId: 'workspace-prompt-fallback',
  });
  assert.equal(receipt?.prompt?.isFallback, true);
  assert.match(
    receipt?.prompt?.fallbackReason ?? '',
    /authority is unavailable/u,
  );
  const fallback = await service.resolvePromptSnapshot(
    draft.skillRevisionRef,
  );
  assert.equal(fallback.content, promptContent);
  assert.equal(fallback.isFallback, true);
  assert.match(
    fallback.fallbackReason ?? '',
    /authority is unavailable/u,
  );
  const materialized = materializeSkillInstructions(
    'Live authority prompt must be replaced.',
    resolved.allowlist,
  );
  assert.match(materialized, new RegExp(promptContent, 'u'));
  assert.doesNotMatch(materialized, /Live authority prompt must be replaced/u);
  authorityFailure = 'none';
  const online = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: 'workflow.daily-copy@1',
  });
  assert.equal(online.allowlist[0]?.prompt?.isFallback, false);
  const onlineMaterialized = materializeSkillInstructions(
    'Caller prompt must not replace the authoritative snapshot.',
    online.allowlist,
  );
  assert.match(onlineMaterialized, new RegExp(promptContent, 'u'));
  assert.doesNotMatch(
    onlineMaterialized,
    /Caller prompt must not replace the authoritative snapshot/u,
  );
  const [replayed] = await service.recordPromptMaterializationReceipts({
    instructions: online.allowlist,
    stage: 'intent_naming',
    taskId: 'task-prompt-fallback',
    workflowRevisionRef: 'workflow.daily-copy@1',
    workspaceId: 'workspace-prompt-fallback',
  });
  assert.deepEqual(replayed, receipt);
  authorityFailure = 'invalid';
  await assert.rejects(
    service.resolvePromptSnapshot(draft.skillRevisionRef),
    /fixture pinned prompt is missing/u,
  );
  authorityFailure = 'none';
  authorityDrifted = true;
  await assert.rejects(
    service.resolvePromptSnapshot(draft.skillRevisionRef),
    /authority returned a mismatched pinned prompt/u,
  );
});

test('Harness prompt adapter distinguishes authority unavailability from a missing pin', async () => {
  const reference = {
    contentHash: 'a'.repeat(64),
    name: 'harness/intent-naming',
    version: '42',
  };
  const unavailable = skillPromptSnapshotPortFromHarness(
    new LangfuseHarnessPromptResolver({
      baseUrl: 'https://langfuse.invalid',
      fetch: async () => {
        throw new Error('fixture network failure');
      },
      policy: 'pilot',
      publicKey: 'fixture-public',
      secretKey: 'fixture-secret',
      versions: { intentNaming: 42 },
      warn() {},
    }),
  );
  await assert.rejects(
    unavailable.capture(reference),
    SkillPromptAuthorityUnavailableError,
  );

  const missingPin = skillPromptSnapshotPortFromHarness(
    new LangfuseHarnessPromptResolver({
      policy: 'pilot',
      warn() {},
    }),
  );
  await assert.rejects(
    missingPin.capture(reference),
    (error: unknown) =>
      error instanceof Error &&
      !(error instanceof SkillPromptAuthorityUnavailableError) &&
      /did not return the pinned Skill prompt/u.test(error.message),
  );
});

test('frozen prompt fallback fails closed when its content no longer matches the pinned hash', async () => {
  const repository = new MemorySkillRepository();
  await repository.putRevision(
    {
      acceptedAt: NOW,
      acceptedBy: 'operator-fallback-hash',
      contentHash: 'a'.repeat(64),
      createdAt: NOW,
      createdBy: 'operator-fallback-hash',
      evalRunId: 'eval-fallback-hash',
      formatVersion: 2,
      governance: governance(),
      instruction: 'Use portable Skill instructions.',
      manifest: {
        description: 'Rejects a drifted frozen prompt fallback.',
        name: 'fallback-hash',
      },
      packagePaths: ['SKILL.md'],
      prompt: {
        contentHash: sha256('Expected frozen prompt content.'),
        content: 'Drifted frozen prompt content.',
        isFallback: false,
        label: 'production',
        name: 'harness/intent-naming',
        source: 'langfuse',
        version: '42',
      },
      revision: 1,
      skillId: 'skill.fallback-hash',
      skillRevisionRef: 'skill.fallback-hash@1',
      status: 'accepted_frozen',
    },
    null,
  );
  const service = new SkillService(repository, () => NOW);

  await assert.rejects(
    service.resolvePromptSnapshot('skill.fallback-hash@1'),
    /fallback does not match its pinned hash/u,
  );
});

test('prompt materialization replays receipts written before prompt lineage entered the fingerprint', async () => {
  const repository = new MemorySkillRepository();
  const promptContent = 'Frozen prompt content.';
  const revision = {
    acceptedAt: NOW,
    acceptedBy: 'operator-legacy-fingerprint',
    contentHash: 'a'.repeat(64),
    createdAt: NOW,
    createdBy: 'operator-legacy-fingerprint',
    evalRunId: 'eval-legacy-fingerprint',
    formatVersion: 2 as const,
    governance: governance(),
    instruction: 'Use portable Skill instructions.',
    manifest: {
      description: 'Replays a pre-lineage materialization receipt.',
      name: 'legacy-fingerprint',
    },
    packagePaths: ['SKILL.md'],
    prompt: {
      contentHash: sha256(promptContent),
      content: promptContent,
      isFallback: false,
      label: 'production',
      name: 'harness/intent-naming',
      source: 'langfuse' as const,
      version: '42',
    },
    revision: 1,
    skillId: 'skill.legacy-fingerprint',
    skillRevisionRef: 'skill.legacy-fingerprint@1',
    status: 'accepted_frozen' as const,
  };
  await repository.putRevision(revision, null);
  const invocationId =
    'skill-materialized:task-legacy-fingerprint:intent_naming:' +
    encodeURIComponent(revision.skillRevisionRef);
  const legacyFacts = {
    contentHash: revision.contentHash,
    skillRevisionRef: revision.skillRevisionRef,
    stage: 'intent_naming',
    workflowRevisionRef: 'workflow.daily-copy@1',
  };
  const existing = await repository.putInvocationReceipt({
    childEffectIds: [],
    createdAt: NOW,
    inputFingerprint: sha256(canonicalTestJson(legacyFacts)),
    invocationId,
    productUsageTaskId: 'task-legacy-fingerprint',
    skillRevisionRef: revision.skillRevisionRef,
    status: 'settled',
    taskId: 'task-legacy-fingerprint',
    totalCostCents: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    workspaceId: 'workspace-legacy-fingerprint',
  });
  const service = new SkillService(repository, () => NOW);

  assert.deepEqual(
    await service.recordPromptMaterializationReceipts({
      instructions: [
        {
          contentHash: revision.contentHash,
          executionMode: 'prompt_materialized',
          instruction: revision.instruction,
          requiredModelCapabilities: [
            ...revision.governance.requiredModelCapabilities,
          ],
          prompt: {
            contentHash: revision.prompt.contentHash,
            isFallback: false,
            name: revision.prompt.name,
            version: revision.prompt.version,
          },
          skillRevisionRef: revision.skillRevisionRef,
        },
      ],
      stage: 'intent_naming',
      taskId: 'task-legacy-fingerprint',
      workflowRevisionRef: 'workflow.daily-copy@1',
      workspaceId: 'workspace-legacy-fingerprint',
    }),
    [existing],
  );
});

test('skill_accept redacts legacy prompt content and instruction fields', async () => {
  const repository = new MemorySkillRepository();
  const legacyContent = 'Legacy prompt content must never reach the admin UI.';
  await repository.putCatalog({
    activeRevisionRef: 'skill.legacy-redaction@1',
    actorId: 'operator-legacy-redaction',
    createdAt: NOW,
    name: 'Legacy redaction',
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
    presentationPolicy: 'backend_only',
    skillId: 'skill.legacy-redaction',
    updatedAt: NOW,
  });
  await repository.putRevision(
    {
      acceptedAt: NOW,
      acceptedBy: 'operator-legacy-redaction',
      contentHash: sha256(legacyContent),
      createdAt: NOW,
      createdBy: 'operator-legacy-redaction',
      evalRunId: 'eval-legacy-redaction',
      formatVersion: 1,
      governance: governance(),
      instruction: legacyContent,
      manifest: {
        ...governance(),
        compatibility: {
          workflowRevisionRefs: ['workflow.daily-copy@1'],
        },
        evalSuiteRef: 'legacy-redaction@1',
      },
      prompt: {
        content: legacyContent,
        contentHash: sha256(legacyContent),
        fallbackContent: legacyContent,
        isFallback: false,
        label: 'production',
        name: 'harness/intent-naming',
        source: 'langfuse',
        version: '42',
      },
      revision: 1,
      skillId: 'skill.legacy-redaction',
      skillRevisionRef: 'skill.legacy-redaction@1',
      status: 'accepted_frozen',
    } as unknown as Parameters<
      MemorySkillRepository['putRevision']
    >[0],
    null,
  );
  const module = new SkillFoundationModule(
    new SkillService(repository, () => NOW),
  );
  const evalRun = {
    ...skillEvalRun('skill.legacy-redaction@1'),
    runId: 'eval-legacy-redaction',
  };
  await repository.putImmutable(evalRun.runId, evalRun);
  const result = await module.execute({
    context: {
      actor: 'admin',
      correlationId: 'corr-legacy-redaction',
      userId: 'operator-legacy-redaction',
      workspaceId: 'workspace-legacy-redaction',
    },
    idempotencyKey: 'skill-accept-legacy-redaction',
    input: {
      action: 'skill_accept',
      payload: {
        evalRunId: evalRun.runId,
        skillRevisionRef: 'skill.legacy-redaction@1',
      },
    },
  });

  assert.equal(JSON.stringify(result).includes(legacyContent), false);
  assert.equal(JSON.stringify(result).includes('"instruction"'), false);
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
      triggerCondition: { harnessStage: 'intent_naming' },
      workflowRevisionRef: 'workflow.binding-matrix@1',
    }),
    /后台专用 Skill 不能由用户选择/u,
  );
});

test('deterministic Skill triggers match stage, industry category, and tenant', async () => {
  const repository = new MemorySkillRepository();
  const service = new SkillService(repository, () => NOW, testPromptSnapshots);
  const globalHair = await createAcceptedSkill(service, 'global_hair');
  const tenantInstruction =
    'Apply the tenant hair instruction only in the declared stage.';
  const tenantHairDraft = await service.draftRevision({
    actorId: 'operator-1',
    expectedRevision: 1,
    governance: {
      ...governance(),
      workflowRevisionRefs: ['workflow.binding-matrix@1'],
    },
    instruction: tenantInstruction,
    manifest: {
      description: 'Fixture for tenant-specific hair behavior.',
      name: 'global-hair',
    },
    promptReference: registerPrompt({
      content: tenantInstruction,
      contentHash: sha256(tenantInstruction),
      isFallback: false,
      label: 'production',
      name: 'skills/global_hair',
      source: 'langfuse',
      version: '2',
    }),
    skillId: globalHair.skillId,
  });
  const tenantHairRun: EvalRun = {
      ...skillEvalRun(tenantHairDraft.skillRevisionRef),
      results: [
        {
          ...skillEvalRun(tenantHairDraft.skillRevisionRef).results[0]!,
          promptRevision: 'skills/global_hair@2',
        },
      ],
      runId: 'skills-global-hair-run-2',
      suiteId: 'skills-global-hair',
      suiteRevision: 'skills-global-hair@2',
  };
  await registerEvalRunForTest(service, tenantHairRun);
  const tenantHair = await service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRunId: tenantHairRun.runId,
    skillRevisionRef: tenantHairDraft.skillRevisionRef,
  });
  await service.bindRevision({
    bindingId: 'binding.global-hair',
    mode: 'required',
    skillRevisionRef: globalHair.skillRevisionRef,
    triggerCondition: {
      harnessStage: 'intent_naming',
      industryCategory: 'hair',
      tenantId: null,
    },
    workflowRevisionRef: 'workflow.binding-matrix@1',
  });
  await service.bindRevision({
    bindingId: 'binding.tenant-hair',
    mode: 'required',
    skillRevisionRef: tenantHair.skillRevisionRef,
    triggerCondition: {
      harnessStage: 'intent_naming',
      industryCategory: 'hair',
      tenantId: 'tenant-a',
    },
    workflowRevisionRef: 'workflow.binding-matrix@1',
  });

  assert.deepEqual(
    (
      await service.resolveStage({
        industryCategory: 'hair',
        stage: 'intent_naming',
        tenantId: 'tenant-a',
        userSelectedSkillRefs: [],
        workflowRevisionRef: 'workflow.binding-matrix@1',
      })
    ).allowlist.map((skill) => skill.skillRevisionRef),
    [tenantHair.skillRevisionRef],
  );
  assert.deepEqual(
    (
      await service.resolveStage({
        industryCategory: 'hair',
        stage: 'intent_naming',
        tenantId: 'tenant-b',
        userSelectedSkillRefs: [],
        workflowRevisionRef: 'workflow.binding-matrix@1',
      })
    ).allowlist.map((skill) => skill.skillRevisionRef),
    [globalHair.skillRevisionRef],
  );
  assert.deepEqual(
    (
      await service.resolveStage({
        industryCategory: 'nails',
        stage: 'intent_naming',
        tenantId: 'tenant-a',
        userSelectedSkillRefs: [],
        workflowRevisionRef: 'workflow.binding-matrix@1',
      })
    ).allowlist,
    [],
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
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
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
    triggerCondition: { harnessStage: 'intent_naming' },
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
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
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
    triggerCondition: { harnessStage: 'intent_naming' },
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

function canonicalTestJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalTestJson).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalTestJson(object[key])}`,
    )
    .join(',')}}`;
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
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
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
  const run: EvalRun = {
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
  };
  await registerEvalRunForTest(service, run);
  return service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRunId: run.runId,
    skillRevisionRef: draft.skillRevisionRef,
  });
}

async function createAcceptedEffectSkill(
  service: SkillService,
  executionMode: 'harness_native' | 'provider_native' = 'harness_native',
  packagePaths: string[] = ['SKILL.md'],
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
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
    presentationPolicy: 'backend_only',
    skillId,
  });
  const draft = await service.draftRevision({
    actorId: 'operator-1',
    expectedRevision: null,
    governance: {
      ...governance(),
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
    packagePaths,
    manifest: {
      'allowed-tools': 'tool.fact.read tool.quality.score',
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
  const run: EvalRun = {
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
  };
  await registerEvalRunForTest(service, run);
  return service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRunId: run.runId,
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
  const run: EvalRun = {
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
  };
  await registerEvalRunForTest(service, run);
  return service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRunId: run.runId,
    skillRevisionRef: draft.skillRevisionRef,
  });
}
