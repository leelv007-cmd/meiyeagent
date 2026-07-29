import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  listSkillSchemaRefs,
  requiredP1Capability,
  resolveSkillSchema,
  type EvalRun,
} from '@meiye/contracts';

import { P1ApplicationService } from '../foundation/application-service.js';
import { P1DomainError } from '../foundation/domain.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { WIRING_NEGATIVE_CASE_IDS } from '../testing/wiring-negative-corpus.js';
import {
  MemorySkillRepository,
  SKILL_COMMAND_ACTIONS,
  SKILL_QUERY_ACTIONS,
  SkillFoundationModule,
  SkillInvocationToolAdapter,
  SkillService,
  StaticSkillToolExecutionAuthorizer,
} from './index.js';
import type { SkillPromptSnapshotPort } from './types.js';

const NOW = '2026-07-29T02:00:00.000Z';
const EXPECTED_SKILL_SCHEMA_REFS = [
  'skill-input.daily-industry@1',
  'skill-output.intent-decision@1',
] as const;

// The merchant-facing product deliberately has no Skill export: a stored
// Skill references tenant assets and platform identifiers, so a downloaded
// copy could not run anywhere else. This asserts the absence stays true as
// the action registry grows, rather than trusting that nobody adds one.
test('the Skill action registry exposes no export or download verb', () => {
  assert.deepEqual(SKILL_COMMAND_ACTIONS, [
    'skill_accept',
    'skill_bind',
    'skill_define',
    'skill_deployment',
    'skill_governance_approve',
    'skill_governance_cancel',
    'skill_governance_resume',
    'skill_governance_start',
    'skill_publish',
    'skill_retire',
    'skill_rollback',
  ]);
  assert.deepEqual(SKILL_QUERY_ACTIONS, [
    'skill_catalog_list',
    'skill_governance_run_get',
    'skill_revision_history',
    'skill_prompt_reference',
    'skill_reverse_dependencies',
  ]);
  const registered = [
    ...SKILL_COMMAND_ACTIONS,
    ...SKILL_QUERY_ACTIONS,
  ];

  for (const action of registered) {
    assert.doesNotMatch(
      action,
      /export|download|dump|archive/u,
      `Skill action ${action} looks like a bulk-extraction verb`,
    );
  }

  // Every registered action must resolve to a capability; an unregistered one
  // is denied by default, so a silent typo would look like "no export" too.
  for (const action of SKILL_COMMAND_ACTIONS) {
    assert.equal(
      requiredP1Capability('command', 'skills', action),
      'config.publish',
      `${action} must stay behind config.publish`,
    );
  }
  for (const action of ['skill_catalog_list', 'skill_revision_history']) {
    assert.equal(
      requiredP1Capability('query', 'skills', action),
      'workspace.read',
      `${action} must stay a plain read`,
    );
  }
  assert.equal(
    requiredP1Capability('query', 'skills', 'skill_prompt_reference'),
    'config.publish',
  );
  assert.equal(
    requiredP1Capability('query', 'skills', 'skill_reverse_dependencies'),
    'config.publish',
  );

  // Anything not on the list stays denied, so the snapshot above is the whole
  // authority surface rather than a sample of it.
  assert.equal(
    requiredP1Capability('query', 'skills', 'skill_export'),
    null,
  );
});

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
        sourceKind: 'authored',
        tier: 'platform',
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

test('the application entry retains a rejected prompt claim after capture without writes', async () => {
  let promptCaptures = 0;
  const harness = applicationSkillHarness(
    'rejected-prompt-retry',
    async (reference) => {
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
  );

  await assert.rejects(
    harness.application.executeModule(
      harness.context,
      'skills',
      harness.input,
      'rejected-prompt-retry',
    ),
    /does not match its pinned reference/u,
  );
  await assert.rejects(
    harness.application.executeModule(
      harness.context,
      'skills',
      harness.input,
      'rejected-prompt-retry',
    ),
    /still in progress/u,
  );

  assert.equal(promptCaptures, 1);
  await assertRejectedSkillUnwritten(harness);
});

test('the application entry releases an inline prompt rejection without dispatching the resolver', async () => {
  let promptCaptures = 0;
  const harness = applicationSkillHarness(
    'inline-prompt-retry',
    async (reference) => {
      promptCaptures += 1;
      return frozenPrompt(reference.name);
    },
    {
      content: 'Forbidden inline prompt.',
    },
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      harness.application.executeModule(
        harness.context,
        'skills',
        harness.input,
        'inline-prompt-retry',
      ),
      /content/u,
    );
  }

  assert.equal(promptCaptures, 0);
  await assertRejectedSkillUnwritten(harness);
});

test('the application entry releases an invalid frontmatter claim before dispatching the resolver', async () => {
  let promptCaptures = 0;
  const harness = applicationSkillHarness(
    'invalid-frontmatter-retry',
    async (reference) => {
      promptCaptures += 1;
      return frozenPrompt(reference.name);
    },
    {},
    {
      frontmatter: {
        ...manifest('invalid-frontmatter-retry'),
        unknown: 'not allowed',
      },
    },
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      harness.application.executeModule(
        harness.context,
        'skills',
        harness.input,
        'invalid-frontmatter-retry',
      ),
      /Unknown Skill frontmatter field/u,
    );
  }

  assert.equal(promptCaptures, 0);
  await assertRejectedSkillUnwritten(harness);
});

test('the application entry releases an invalid package path claim before dispatching the resolver', async () => {
  let promptCaptures = 0;
  const harness = applicationSkillHarness(
    'invalid-package-path-retry',
    async (reference) => {
      promptCaptures += 1;
      return frozenPrompt(reference.name);
    },
    {},
    {
      packagePaths: ['SKILL.md', '../escape.ts'],
    },
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      harness.application.executeModule(
        harness.context,
        'skills',
        harness.input,
        'invalid-package-path-retry',
      ),
      /safe relative path/u,
    );
  }

  assert.equal(promptCaptures, 0);
  await assertRejectedSkillUnwritten(harness);
});

test('the application entry releases a Foundation payload rejection before dispatching the resolver', async () => {
  let promptCaptures = 0;
  const harness = applicationSkillHarness(
    'invalid-foundation-payload-retry',
    async (reference) => {
      promptCaptures += 1;
      return frozenPrompt(reference.name);
    },
    {},
    {
      unknown: 'not allowed',
    },
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      harness.application.executeModule(
        harness.context,
        'skills',
        harness.input,
        'invalid-foundation-payload-retry',
      ),
      /Skill 定义命令 不支持字段 unknown/u,
    );
  }

  assert.equal(promptCaptures, 0);
  await assertRejectedSkillUnwritten(harness);
});

test('the application entry releases an invalid governance claim before dispatching the resolver', async () => {
  let promptCaptures = 0;
  const harness = applicationSkillHarness(
    'invalid-governance-retry',
    async (reference) => {
      promptCaptures += 1;
      return frozenPrompt(reference.name);
    },
    {},
    {
      governance: {
        ...governance(),
        unknown: 'not allowed',
      },
    },
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      harness.application.executeModule(
        harness.context,
        'skills',
        harness.input,
        'invalid-governance-retry',
      ),
      /Skill governance sidecar is invalid/u,
    );
  }

  assert.equal(promptCaptures, 0);
  await assertRejectedSkillUnwritten(harness);
});

test('the application keeps the claim when prompt capture records an effect before invalid state', async () => {
  let promptCaptures = 0;
  const harness = applicationSkillHarness(
    'effectful-prompt-capture',
    async () => {
      promptCaptures += 1;
      throw new P1DomainError(
        'INVALID_STATE',
        'Prompt capture failed after recording its effect.',
      );
    },
  );

  await assert.rejects(
    harness.application.executeModule(
      harness.context,
      'skills',
      harness.input,
      'effectful-prompt-capture',
    ),
    /failed after recording its effect/u,
  );
  await assert.rejects(
    harness.application.executeModule(
      harness.context,
      'skills',
      harness.input,
      'effectful-prompt-capture',
    ),
    /still in progress/u,
  );

  assert.equal(promptCaptures, 1);
  await assertRejectedSkillUnwritten(harness);
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
            payload: { scope: 'facts' },
            toolId: 'read_context',
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
            payload: { scope: 'facts' },
            toolId: 'read_context',
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
    ['read_context'],
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
        payload: { scope: 'facts' },
        toolId: 'read_context',
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

test('the operator Skill seam rejects a data-supplied red-line override', async () => {
  const harness = applicationSkillHarness(
    'operator-redline-override',
    async () => {
      throw new Error('prompt capture must not run');
    },
    {},
    {
      redlinePolicy: {
        sample: 0,
        strategy: 'warn',
      },
    },
  );

  await assert.rejects(
    harness.application.executeModule(
      harness.context,
      'skills',
      harness.input,
      'operator-redline-override',
    ),
    /Skill 定义命令 不支持字段 redlinePolicy/u,
  );
  await assertRejectedSkillUnwritten(harness);
});

function applicationSkillHarness(
  suffix: string,
  capture: SkillPromptSnapshotPort['capture'],
  promptReferenceOverrides: Record<string, unknown> = {},
  payloadOverrides: Record<string, unknown> = {},
) {
  const skillRepository = new MemorySkillRepository();
  const skillService = new SkillService(skillRepository, () => NOW, {
    capture,
  });
  const foundationRepository = new MemoryFoundationRepository();
  const context = {
    actor: 'admin' as const,
    correlationId: `corr-${suffix}`,
    userId: `operator-${suffix}`,
    workspaceId: `workspace-${suffix}`,
  };
  foundationRepository.grantOwner(context.workspaceId, context.userId);
  const application = new P1ApplicationService(foundationRepository, {
    operations: [new SkillFoundationModule(skillService)],
  });
  const skillId = `skill.${suffix}`;
  return {
    application,
    context,
    input: {
      action: 'skill_define',
      payload: {
        sourceKind: 'authored',
        tier: 'platform',
        expectedRevision: null,
        frontmatter: manifest(suffix),
        governance: governance(),
        instruction: 'Use only the pinned prompt.',
        name: suffix,
        presentationPolicy: 'backend_only',
        promptReference: {
          contentHash: 'c'.repeat(64),
          name: `skills/${suffix}`,
          version: '1',
          ...promptReferenceOverrides,
        },
        skillId,
        ...payloadOverrides,
      },
    },
    skillId,
    skillRepository,
  };
}

async function assertRejectedSkillUnwritten(
  harness: ReturnType<typeof applicationSkillHarness>,
) {
  assert.equal(
    await harness.skillRepository.getCatalog(harness.skillId),
    null,
  );
  assert.equal(
    await harness.skillRepository.getRevisionHead(harness.skillId),
    null,
  );
  assert.deepEqual(
    await harness.application.listCommandAudits(harness.context),
    [],
  );
}

async function acceptedSkill(
  suffix: string,
  trustedTools: readonly string[] = [],
) {
  const repository = new MemorySkillRepository();
  const skillId = `skill.${suffix}`;
  const instruction = `Apply ${suffix} only after explicit binding.`;
  const prompt = frozenPrompt(instruction);
  const service = new SkillService(
    repository,
    () => NOW,
    {
      async capture() {
        return prompt;
      },
    },
    new StaticSkillToolExecutionAuthorizer(
      trustedTools.map((toolId) => ({
        caller: `${skillId}@1`,
        toolId,
      })),
    ),
  );
  await service.defineCatalogEntry({
    actorId: 'operator-production-wiring',
    name: suffix,
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
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
      sideEffectClass: 'read',
    },
    instruction,
    manifest: {
      ...manifest(suffix),
      'allowed-tools': 'read_context',
    },
    promptReference: promptReference(prompt),
    skillId,
  });
  const evalRun: EvalRun = {
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
  };
  await repository.putImmutable(evalRun.runId, evalRun);
  const revision = await service.acceptAndFreezeRevision({
    actorId: 'operator-production-wiring',
    evalRunId: evalRun.runId,
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
