import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  listSkillSchemaRefs,
  resolveSkillSchema,
} from '@meiye/contracts';

import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import {
  MemorySkillRepository,
  SkillFoundationModule,
  SkillInvocationToolAdapter,
  SkillService,
} from './index.js';

const NOW = '2026-07-29T02:00:00.000Z';
const EXPECTED_SKILL_SCHEMA_REFS = [
  'skill-input.daily-industry@1',
  'skill-output.intent-decision@1',
] as const;
const NEGATIVE_WIRING_CASES = [
  'available-but-unbound',
  'dynamic-not-in-inventory',
  'inventory-blind-to-closure',
  'invalid-shape-silently-inert',
  'duplicate-authority-key',
] as const;

test('production Skill inventory matches the explicit contract snapshot', () => {
  assert.deepEqual(listSkillSchemaRefs(), EXPECTED_SKILL_SCHEMA_REFS);
  assert.deepEqual(NEGATIVE_WIRING_CASES, [
    'available-but-unbound',
    'dynamic-not-in-inventory',
    'inventory-blind-to-closure',
    'invalid-shape-silently-inert',
    'duplicate-authority-key',
  ]);
});

test('the real Foundation entry admits a revision only through registered schemas', async () => {
  const repository = new MemorySkillRepository();
  const service = new SkillService(repository, () => NOW);
  const module = new SkillFoundationModule(service);
  const instruction = 'Use grounded daily-industry context.';

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
        instruction,
        manifest: manifest(),
        name: 'Production wiring',
        presentationPolicy: 'backend_only',
        prompt: prompt(instruction),
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
    )?.manifest.inputSchemaRef,
    'skill-input.daily-industry@1',
  );
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
  const { repository, revision, service } = await acceptedSkill('tool-entry');
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

async function acceptedSkill(suffix: string) {
  const repository = new MemorySkillRepository();
  const service = new SkillService(repository, () => NOW);
  const skillId = `skill.${suffix}`;
  const instruction = `Apply ${suffix} only after explicit binding.`;
  await service.defineCatalogEntry({
    actorId: 'operator-production-wiring',
    name: suffix,
    presentationPolicy: 'backend_only',
    skillId,
  });
  const draft = await service.draftRevision({
    actorId: 'operator-production-wiring',
    expectedRevision: null,
    instruction,
    manifest: {
      ...manifest(),
      allowedTools: ['tool.fact.read'],
      budget: {
        maxChildEffects: 1,
        maxCostCents: 1,
        timeoutMs: 10_000,
      },
      contextScopes: ['facts'],
      executionMode: 'harness_native',
    },
    prompt: prompt(instruction),
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

function manifest() {
  return {
    allowedTools: [],
    budget: {
      maxChildEffects: 0,
      maxCostCents: 0,
      timeoutMs: 10_000,
    },
    compatibility: {
      workflowRevisionRefs: ['workflow.production-wiring@1'],
    },
    contextScopes: [],
    evalSuiteRef: 'production-wiring@1',
    executionMode: 'prompt_materialized' as const,
    fallback: 'fail_closed' as const,
    inputSchemaRef: 'skill-input.daily-industry@1',
    outputSchemaRef: 'skill-output.intent-decision@1',
    requiredModelCapabilities: ['structured_output'],
    sideEffectClass: 'none' as const,
  };
}

function prompt(content: string) {
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
