import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  listSkillSchemaRefs,
  resolveSkillSchema,
} from '@meiye/contracts';

import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { WIRING_NEGATIVE_CASE_IDS } from '../testing/wiring-negative-corpus.js';
import {
  MemorySkillRepository,
  SkillFoundationModule,
  SkillInvocationToolAdapter,
  SkillService,
  StaticSkillToolExecutionAuthorizer,
} from './index.js';

const NOW = '2026-07-29T02:00:00.000Z';
const EXPECTED_SKILL_SCHEMA_REFS = [
  'skill-input.daily-industry@1',
  'skill-output.intent-decision@1',
] as const;

test('production Skill inventory matches the explicit contract snapshot', () => {
  assert.deepEqual(listSkillSchemaRefs(), EXPECTED_SKILL_SCHEMA_REFS);
  assert.deepEqual(WIRING_NEGATIVE_CASE_IDS, [
    'available-but-unbound',
    'dynamic-not-in-inventory',
    'inventory-blind-to-closure',
    'invalid-shape-silently-inert',
    'duplicate-authority-key',
  ]);
});

test('the real Foundation entry admits a revision only through registered schemas', async () => {
  const repository = new MemorySkillRepository();
  const instruction = 'Use grounded daily-industry context.';
  const prompt = frozenPrompt(instruction);
  const service = new SkillService(repository, () => NOW, {
    async capture() {
      return prompt;
    },
  });
  const module = new SkillFoundationModule(service);

  const result = (await module.execute({
    context: {
      actor: 'admin',
      correlationId: 'corr-production-wiring',
      userId: 'operator-production-wiring',
      workspaceId: 'workspace-production-wiring',
    },
    idempotencyKey: 'skill-define-production-wiring',
    input: {
      action: 'skill_define',
      payload: {
        expectedRevision: null,
        frontmatter: manifest('production-wiring'),
        governance: governance(),
        instruction,
        name: 'Production wiring',
        presentationPolicy: 'backend_only',
        promptReference: promptReference(prompt),
        skillId: 'skill.production-wiring',
      },
    },
  })) as {
    revision: { skillRevisionRef: string };
  };

  assert.equal(
    result.revision.skillRevisionRef,
    'skill.production-wiring@1',
  );
  assert.equal(
    (
      await repository.getRevision(
        result.revision.skillRevisionRef,
      )
    )?.governance.inputSchemaRef,
    'skill-input.daily-industry@1',
  );
});

test('the application entry releases a rejected prompt claim for deterministic retry without writes', async () => {
  const skillRepository = new MemorySkillRepository();
  let promptCaptures = 0;
  const skillService = new SkillService(skillRepository, () => NOW, {
    async capture(reference) {
      promptCaptures += 1;
      const content = 'Different authority content.';
      return {
        ...reference,
        content,
        contentHash: createHash('sha256').update(content).digest('hex'),
        isFallback: false,
        label: 'production',
        source: 'langfuse',
      };
    },
  });
  const foundationRepository = new MemoryFoundationRepository();
  const application = new P1ApplicationService(foundationRepository, {
    operations: [new SkillFoundationModule(skillService)],
  });
  const context = {
    actor: 'admin' as const,
    correlationId: 'corr-rejected-prompt-retry',
    userId: 'operator-rejected-prompt-retry',
    workspaceId: 'workspace-rejected-prompt-retry',
  };
  const input = {
    action: 'skill_define',
    payload: {
      expectedRevision: null,
      frontmatter: manifest('rejected-prompt-retry'),
      governance: governance(),
      instruction: 'Use only the pinned prompt.',
      name: 'Rejected prompt retry',
      presentationPolicy: 'backend_only',
      promptReference: {
        contentHash: 'c'.repeat(64),
        name: 'skills/rejected-prompt-retry',
        version: '1',
      },
      skillId: 'skill.rejected-prompt-retry',
    },
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      application.executeModule(
        context,
        'skills',
        input,
        'rejected-prompt-retry',
      ),
      /does not match its pinned reference/u,
    );
  }

  assert.equal(promptCaptures, 2);
  assert.equal(
    await skillRepository.getCatalog('skill.rejected-prompt-retry'),
    null,
  );
  assert.equal(
    await skillRepository.getRevisionHead('skill.rejected-prompt-retry'),
    null,
  );
  assert.deepEqual(await application.listCommandAudits(context), []);
});

test('available-but-unbound: an accepted Skill does not enter a stage allowlist', async () => {
  const { service, revision } = await acceptedSkill('available-unbound');

  assert.deepEqual(
    await service.resolveStage({
      stage: 'intent_naming',
      userSelectedSkillRefs: [],
      workflowRevisionRef: 'workflow.production-wiring@1',
    }),
    { allowlist: [] },
  );
  assert.equal(revision.status, 'accepted_frozen');
});

test('dynamic-not-in-inventory: runtime-composed refs fail closed', () => {
  const suffix = 'runtime-composed';
  const dynamicRef = `skill-input.${suffix}@1`;

  assert.equal(listSkillSchemaRefs().includes(dynamicRef as never), false);
  assert.throws(
    () => resolveSkillSchema(dynamicRef),
    /Unknown Skill schema ref/u,
  );
});

test('inventory-blind-to-closure: a hidden schema factory cannot extend authority', () => {
  const hiddenRef = (() => 'skill-output.hidden-closure@1')();
  const before = listSkillSchemaRefs();

  assert.throws(
    () => resolveSkillSchema(hiddenRef),
    /Unknown Skill schema ref/u,
  );
  assert.deepEqual(listSkillSchemaRefs(), before);
});

test('invalid-shape-silently-inert: invalid input stops before the executor', async () => {
  const { repository, service, revision } =
    await acceptedSkill('invalid-shape');
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
        invocationId: 'invocation-invalid-shape-wiring',
        output: {
          schemaRevision: 'skill-output.intent-decision@1',
          target: 'workflow_artifact',
        },
        productUsageTaskId: 'task-production-wiring',
        skillRevisionRef: revision.skillRevisionRef,
        taskId: 'task-production-wiring',
        workspaceId: 'workspace-production-wiring',
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
      {
        async publishOnce() {
          throw new Error('must not publish');
        },
      },
    ),
    /Skill input does not match/u,
  );
  assert.equal(executions, 0);
  assert.equal(
    await repository.getInvocationReceipt(
      'invocation-invalid-shape-wiring',
    ),
    null,
  );
});

test('a frozen manifest tool claim is not a trusted execution grant', async () => {
  const { service, revision } = await acceptedSkill('merchant-tool-claim');
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
        input: {
          assetReferences: [],
          context: {
            intent: '读取已确认事实',
            scene: '门店日常',
            sourceSummaries: ['门店事实'],
            workId: 'work-merchant-tool-claim',
          },
        },
        invocationId: 'invocation-merchant-tool-claim',
        output: {
          schemaRevision: 'skill-output.intent-decision@1',
          target: 'workflow_artifact',
        },
        productUsageTaskId: 'task-production-wiring',
        skillRevisionRef: revision.skillRevisionRef,
        taskId: 'task-production-wiring',
        workspaceId: 'workspace-production-wiring',
      },
      {
        async execute() {
          executions += 1;
          return {
            acceptanceStatus: 'accepted',
            costCents: 1,
            providerReceipt: {
              accepted: true,
              providerTaskRef: 'must-not-execute',
            },
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
        async generate() {
          return { value: intentDecisionOutput() };
        },
      },
      {
        async publishOnce(input) {
          return input.result;
        },
      },
    ),
    /trusted tool grant/u,
  );
  assert.equal(executions, 0);
});

test('duplicate-authority-key: duplicate production modules fail at assembly', () => {
  const skillService = new SkillService(
    new MemorySkillRepository(),
    () => NOW,
  );
  const first = new SkillFoundationModule(skillService);
  const duplicate = new SkillFoundationModule(skillService);

  assert.throws(
    () =>
      new P1ApplicationService(new MemoryFoundationRepository(), {
        operations: [first, duplicate],
      }),
    /Operation skills is already registered/u,
  );
});

test('the Skill tool adapter returns validated output and a stable invalid-output error object', async () => {
  const { repository, revision, service } = await acceptedSkill(
    'tool-entry',
    ['tool.fact.read'],
  );
  const published: unknown[] = [];
  const validOutput = intentDecisionOutput();
  const tool = new SkillInvocationToolAdapter(
    service,
    {
      async execute(effect) {
        return {
          acceptanceStatus: 'accepted',
          costCents: 1,
          providerReceipt: {
            accepted: true,
            providerTaskRef: `provider-${effect.callId}`,
          },
          usage: { inputTokens: 4, outputTokens: 2 },
        };
      },
      async generate(input) {
        return {
          value:
            input.invocationId === 'invocation-tool-valid'
              ? validOutput
              : { route: 'customized' },
        };
      },
    },
    {
      async publishOnce(input) {
        published.push(input.result.value);
        return input.result;
      },
    },
  );
  const request = {
    calls: [
      {
        callId: 'read-facts',
        contextRefs: ['facts:current-offer'],
        declaredBudgetCapCents: 1,
        payload: {},
        toolId: 'tool.fact.read',
      },
    ],
    input: {
      context: {
        workId: 'work-tool-entry',
        intent: '为今天的团购写一条行业内容',
        scene: '日常项目曝光',
        sourceSummaries: ['门店价目表'],
      },
      assetReferences: [],
    },
    invocationId: 'invocation-tool-valid',
    output: {
      schemaRevision: 'skill-output.intent-decision@1',
      target: 'workflow_artifact' as const,
    },
    productUsageTaskId: 'task-tool-entry-product-usage',
    skillRevisionRef: revision.skillRevisionRef,
    taskId: 'task-tool-entry',
    workspaceId: 'workspace-production-wiring',
  };

  const valid = await tool.execute(request);
  assert.equal(valid.ok, true);
  if (!valid.ok) throw new Error('Expected a successful tool result.');
  assert.deepEqual(valid.execution.output.value, validOutput);
  assert.deepEqual(published, [validOutput]);

  const invalidInvocationId = 'invocation-tool-invalid';
  const invalid = await tool.execute({
    ...request,
    invocationId: invalidInvocationId,
  });
  assert.deepEqual(invalid, {
    ok: false,
    error: {
      code: 'SKILL_OUTPUT_INVALID',
      message: 'Skill 输出未通过 Schema 或质量门。',
      retryable: false,
    },
  });
  assert.deepEqual(published, [validOutput]);
  assert.equal(
    await repository.getInvocationReceipt(invalidInvocationId),
    null,
  );
  assert.equal(
    (
      await repository.getChildEffect(
        `${invalidInvocationId}:read-facts`,
      )
    )?.providerReceipt.providerTaskRef,
    'provider-read-facts',
  );

  const invalidInputInvocationId = 'invocation-tool-invalid-input';
  assert.deepEqual(
    await tool.execute({
      ...request,
      input: { context: null, assetReferences: [] },
      invocationId: invalidInputInvocationId,
    }),
    {
      ok: false,
      error: {
        code: 'SKILL_INPUT_INVALID',
        message: 'Skill input does not match its frozen input schema.',
        retryable: false,
      },
    },
  );
  assert.equal(
    await repository.getInvocationReceipt(invalidInputInvocationId),
    null,
  );
});

async function acceptedSkill(
  suffix: string,
  trustedTools: readonly string[] = [],
) {
  const repository = new MemorySkillRepository();
  const skillId = `skill.${suffix}`;
  const service = new SkillService(
    repository,
    () => NOW,
    new StaticSkillToolExecutionAuthorizer(
      trustedTools.map((toolId) => ({
        caller: `${skillId}@1`,
        toolId,
      })),
    ),
  );
  const instruction = `Apply ${suffix} only after explicit binding.`;
  const prompt = frozenPrompt(instruction);
  const service = new SkillService(repository, () => NOW, {
    async capture() {
      return prompt;
    },
  });
  await service.defineCatalogEntry({
    actorId: 'operator-production-wiring',
    name: suffix,
    presentationPolicy: 'backend_only',
    skillId,
  });
  const draft = await service.draftRevision({
    actorId: 'operator-production-wiring',
    expectedRevision: null,
    governance: {
      ...governance(),
      budget: {
        maxChildEffects: 1,
        maxCostCents: 1,
        timeoutMs: 10_000,
      },
      contextScopes: ['facts'],
      executionMode: 'harness_native',
    },
    instruction,
    manifest: {
      ...manifest(suffix),
      'allowed-tools': 'tool.fact.read',
    },
    promptReference: promptReference(prompt),
    skillId,
  });
  const revision = await service.acceptAndFreezeRevision({
    actorId: 'operator-production-wiring',
    evalRun: {
      createdAt: NOW,
      mode: 'recorded_fixture',
      passed: true,
      results: [
        {
          caseId: 'production-wiring',
          gateId: 'skill_revision_acceptance',
          memoryDiff: null,
          passed: true,
          promptRevision: `${draft.prompt.name}@${draft.prompt.version}`,
          reason: 'Fixture passed.',
          scorerRevision: 'skill-routing-scorer@1',
          skillRevisionRef: draft.skillRevisionRef,
        },
      ],
      runId: `production-wiring-${suffix}`,
      schemaVersion: 'eval-run/v1',
      suiteId: 'production-wiring',
      suiteRevision: 'production-wiring@1',
    },
    skillRevisionRef: draft.skillRevisionRef,
  });
  return { repository, revision, service };
}

function manifest(name: string) {
  return {
    description: `Production wiring fixture for ${name}.`,
    name,
  };
}

function governance() {
  return {
    budget: {
      maxChildEffects: 0,
      maxCostCents: 0,
      timeoutMs: 10_000,
    },
    contextScopes: [],
    executionMode: 'prompt_materialized' as const,
    fallback: 'fail_closed' as const,
    inputSchemaRef: 'skill-input.daily-industry@1',
    outputSchemaRef: 'skill-output.intent-decision@1',
    requiredModelCapabilities: ['structured_output'],
    sideEffectClass: 'none' as const,
    workflowRevisionRefs: ['workflow.production-wiring@1'],
  };
}

function frozenPrompt(content: string) {
  return {
    content,
    contentHash: createHash('sha256').update(content).digest('hex'),
    isFallback: false as const,
    label: 'production',
    name: 'skills/production-wiring',
    source: 'langfuse' as const,
    version: '1',
  };
}

function promptReference(prompt: ReturnType<typeof frozenPrompt>) {
  return {
    contentHash: prompt.contentHash,
    name: prompt.name,
    version: prompt.version,
  };
}

function intentDecisionOutput() {
  return {
    normalizedIntent: '为今天的团购写一条行业内容',
    taskType: 'daily_service_exposure',
    deliveryLayer: 'copy',
    relevantAssetCategories: ['industry_category'],
    usedAssetCategories: ['industry_category'],
    route: 'customized',
    implicitConstraints: ['只使用已确认事实'],
    blockingGap: null,
  };
}
