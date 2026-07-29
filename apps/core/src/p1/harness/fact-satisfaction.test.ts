import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORE_FACT_KIND_LABELS,
  STORE_FACT_KINDS,
  contextBundleSchema,
  type ContextBundle,
  type StoreFactKind,
} from '@meiye/contracts';
import { LAUNCH_RECIPE_SPECS } from '../creation-experience/launch-seeds.js';
import { FixtureAiStructuredObjectExecutor } from '../model-supply/ai-sdk-runner.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';
import {
  assessRecipeFactSatisfaction,
  type FactRightsAuthorizationPort,
} from './fact-satisfaction.js';

const NOW = '2026-07-25T02:00:00.000Z';
const authorizedRights: FactRightsAuthorizationPort = {
  async isAuthorized() {
    return true;
  },
};

test('all eight formal Recipes use ContextBundle factTypes instead of text uploads', async () => {
  for (const recipe of LAUNCH_RECIPE_SPECS) {
    assert.equal(
      recipe.sourceRequirements.some((slot) => slot.kinds?.includes('text')),
      false,
    );
    const result = await assessRecipeFactSatisfaction(
      {
        workflowId: `workflow-${recipe.recipeId}`,
        workflowRevision: 1,
        intent: recipe.presentation.summary,
        factTypes: recipe.factTypes,
        bundle: bundleWithFacts(recipe.factTypes),
        at: NOW,
      },
      new FixtureExecutorRunner(),
      authorizedRights,
    );
    assert.equal(result.status, 'satisfied', recipe.recipeId);
    assert.equal(result.action, 'execute', recipe.recipeId);
  }
});

test('fact satisfaction and criticality runners consume their own frozen prompts', async () => {
  const runner = new QueueRunner([
    {
      status: 'partial',
      matchedFactRefs: ['store_fact:fact-service:1'],
      missingFactTypes: ['price'],
    },
    { criticality: 'optional' },
  ]);

  const result = await assessRecipeFactSatisfaction(
    {
      workflowId: 'workflow-frozen-fact-prompts',
      workflowRevision: 1,
      intent: '介绍护理服务和价格',
      factTypes: ['service', 'price'],
      bundle: bundleWithFacts(['service']),
      at: NOW,
      prompts: {
        factSatisfaction: frozenPrompt(
          'harness/fact-satisfaction',
          'frozen:fact-satisfaction',
        ),
        factCriticality: frozenPrompt(
          'harness/fact-criticality',
          'frozen:fact-criticality',
        ),
      },
    },
    runner,
    authorizedRights,
  );

  assert.equal(result.action, 'execute_with_notice');
  assert.deepEqual(
    runner.requests.map(({ instructions }) => instructions),
    ['frozen:fact-satisfaction', 'frozen:fact-criticality'],
  );
});

test('partial critical facts ask through QuestionCard and retain canonical ledger intake', async () => {
  const runner = new QueueRunner([
    {
      status: 'partial',
      matchedFactRefs: ['store_fact:fact-service:1'],
      missingFactTypes: ['group_buy', 'price'],
    },
    { criticality: 'critical' },
  ]);
  const result = await assessRecipeFactSatisfaction(
    request(['service', 'group_buy', 'price']),
    runner,
    authorizedRights,
  );

  assert.equal(result.status, 'partial');
  assert.equal(result.action, 'ask_user');
  if (result.action !== 'ask_user') assert.fail('expected ask_user');
  assert.equal(result.question.response.field, 'store_facts');
  assert.equal(result.question.unattended, 'continue');
  assert.equal(
    result.question.question.includes(STORE_FACT_KIND_LABELS.group_buy),
    true,
  );
  assert.equal(
    result.question.question.includes(STORE_FACT_KIND_LABELS.price),
    true,
  );
  assertNoStoreFactKindLiteral(result.question.question);
  assert.deepEqual(result.ledgerIntake, {
    factTypes: ['group_buy', 'price'],
    writePath: 'asset_intake.confirm_fact',
  });
});

test('partial optional facts continue with an explicit result notice', async () => {
  const runner = new QueueRunner([
    {
      status: 'partial',
      matchedFactRefs: ['store_fact:fact-service:1'],
      missingFactTypes: ['staff_experience'],
    },
    { criticality: 'optional' },
  ]);
  const result = await assessRecipeFactSatisfaction(
    request(['service', 'staff_experience']),
    runner,
    authorizedRights,
  );

  assert.equal(result.status, 'partial');
  assert.equal(result.action, 'execute_with_notice');
  if (result.action !== 'execute_with_notice') {
    assert.fail('expected execute_with_notice');
  }
  assert.equal(
    result.resultNotice.includes(STORE_FACT_KIND_LABELS.staff_experience),
    true,
  );
  assertNoStoreFactKindLiteral(result.resultNotice);
});

test('frozen fact prompts reach both production model calls', async () => {
  const runner = new QueueRunner([
    {
      status: 'partial',
      matchedFactRefs: ['store_fact:fact-service:1'],
      missingFactTypes: ['price'],
    },
    { criticality: 'critical' },
  ]);

  await assessRecipeFactSatisfaction(
    {
      ...request(['service', 'price']),
      prompts: {
        factSatisfaction: { content: 'frozen satisfaction instructions' },
        factCriticality: { content: 'frozen criticality instructions' },
      },
    },
    runner,
    authorizedRights,
  );

  assert.deepEqual(
    runner.requests.map(({ instructions }) => instructions),
    ['frozen satisfaction instructions', 'frozen criticality instructions'],
  );
});

function assertNoStoreFactKindLiteral(value: string) {
  for (const kind of STORE_FACT_KINDS) {
    assert.equal(value.includes(kind), false, `must not expose ${kind}`);
  }
}

test('unsatisfied or invalid model output stays conservative', async () => {
  const unsatisfied = await assessRecipeFactSatisfaction(
    request(['service', 'price']),
    new QueueRunner([
      {
        status: 'unsatisfied',
        matchedFactRefs: [],
        missingFactTypes: ['service', 'price'],
      },
    ]),
    authorizedRights,
  );
  assert.equal(unsatisfied.action, 'conservative_guidance');

  const forgedSatisfied = await assessRecipeFactSatisfaction(
    request(['service', 'price']),
    new QueueRunner([
      {
        status: 'satisfied',
        matchedFactRefs: ['store_fact:fact-service:1'],
        missingFactTypes: [],
      },
    ]),
    authorizedRights,
  );
  assert.equal(forgedSatisfied.action, 'conservative_guidance');

  const incompletePartial = await assessRecipeFactSatisfaction(
    request(['service', 'price', 'staff_experience']),
    new QueueRunner([
      {
        status: 'partial',
        matchedFactRefs: ['store_fact:fact-service:1'],
        missingFactTypes: ['staff_experience'],
      },
    ]),
    authorizedRights,
  );
  assert.equal(incompletePartial.action, 'conservative_guidance');

  const failed = await assessRecipeFactSatisfaction(
    request(['service']),
    new QueueRunner([new Error('fixture timeout')]),
    authorizedRights,
  );
  assert.equal(failed.action, 'conservative_guidance');
});

test('expired, revoked, and unauthorized facts are removed before the model', async () => {
  const bundle = bundleWithFacts(['price'], {
    expiresAt: '2026-07-25T01:00:00.000Z',
  });
  const runner = new QueueRunner([
    {
      status: 'satisfied',
      matchedFactRefs: [],
      missingFactTypes: [],
    },
  ]);
  const result = await assessRecipeFactSatisfaction(
    {
      ...request(['price']),
      bundle,
    },
    runner,
    authorizedRights,
  );
  assert.equal(result.action, 'conservative_guidance');
  assert.deepEqual(JSON.parse(runner.requests[0]!.prompt).facts, []);

  const revokedRunner = new QueueRunner([
    {
      status: 'partial',
      matchedFactRefs: [],
      missingFactTypes: ['price'],
    },
    { criticality: 'optional' },
  ]);
  await assessRecipeFactSatisfaction(
    {
      ...request(['price']),
      bundle: bundleWithFacts(['price'], { revisionKind: 'revocation' }),
    },
    revokedRunner,
    authorizedRights,
  );
  assert.deepEqual(JSON.parse(revokedRunner.requests[0]!.prompt).facts, []);

  const observedRightsRevisions: Array<string | number> = [];
  const unauthorizedRunner = new QueueRunner([
    {
      status: 'unsatisfied',
      matchedFactRefs: [],
      missingFactTypes: ['price'],
    },
  ]);
  await assessRecipeFactSatisfaction(
    request(['price']),
    unauthorizedRunner,
    {
      async isAuthorized(input) {
        observedRightsRevisions.push(input.rightsRevision);
        return false;
      },
    },
  );
  assert.deepEqual(JSON.parse(unauthorizedRunner.requests[0]!.prompt).facts, []);
  assert.deepEqual(observedRightsRevisions, [8]);
});

test('fact satisfaction never treats a non-current_fact contribution as a fact', async () => {
  const bundle = bundleWithFacts(['price']);
  bundle.dimensions.store_facts_assets['price.value']!.layer =
    'current_instruction';
  const runner = new QueueRunner([
    {
      status: 'unsatisfied',
      matchedFactRefs: [],
      missingFactTypes: ['price'],
    },
  ]);

  const result = await assessRecipeFactSatisfaction(
    { ...request(['price']), bundle },
    runner,
    authorizedRights,
  );

  assert.equal(result.action, 'conservative_guidance');
  assert.deepEqual(JSON.parse(runner.requests[0]!.prompt).facts, []);
});

test('recorded post-processing fixtures keep outcomes and model facts aligned', async () => {
  for (const fixture of FACT_SATISFACTION_POST_PROCESSING_FIXTURES) {
    const runner = new QueueRunner([...fixture.outputs]);
    const result = await assessRecipeFactSatisfaction(
      fixture.input,
      runner,
      fixture.rights,
    );
    const satisfactionRequest = runner.requests.find(
      (request) => request.schemaName === 'harness_fact_satisfaction_v1',
    );

    assert.ok(satisfactionRequest, fixture.name);
    assert.deepEqual(
      JSON.parse(satisfactionRequest.prompt).facts,
      fixture.expectedFacts,
      fixture.name,
    );
    assert.equal(result.status, fixture.expected.status, fixture.name);
    assert.equal(result.action, fixture.expected.action, fixture.name);
    assert.deepEqual(result.factRefs, fixture.expected.factRefs, fixture.name);
    assert.deepEqual(
      'missingFactTypes' in result ? result.missingFactTypes : [],
      fixture.expected.missingFactTypes,
      fixture.name,
    );
    assert.equal(
      runner.requests.length,
      fixture.expected.requestCount,
      fixture.name,
    );
  }
});

const SERVICE_FACT_FOR_MODEL = {
  sourceRef: 'store_fact:fact-service:1',
  kind: 'service',
  value: { label: 'service' },
  source: {
    kind: 'user_confirmation',
    referenceId: 'confirmation-service',
    capturedAt: '2026-07-25T00:00:00.000Z',
  },
  effectiveFrom: '2026-07-25T00:00:00.000Z',
  expiresAt: null,
} as const;

const PRICE_FACT_FOR_MODEL = {
  sourceRef: 'store_fact:fact-price:1',
  kind: 'price',
  value: { label: 'price' },
  source: {
    kind: 'user_confirmation',
    referenceId: 'confirmation-price',
    capturedAt: '2026-07-25T00:00:00.000Z',
  },
  effectiveFrom: '2026-07-25T00:00:00.000Z',
  expiresAt: null,
} as const;

const unauthorizedRights: FactRightsAuthorizationPort = {
  async isAuthorized() {
    return false;
  },
};

const FACT_SATISFACTION_POST_PROCESSING_FIXTURES = [
  {
    name: 'satisfied current service and price facts',
    input: {
      ...request(['service', 'price']),
      bundle: bundleWithFacts(['service', 'price']),
    },
    rights: authorizedRights,
    outputs: [
      {
        status: 'satisfied',
        matchedFactRefs: [
          'store_fact:fact-service:1',
          'store_fact:fact-price:1',
        ],
        missingFactTypes: [],
      },
    ],
    expectedFacts: [SERVICE_FACT_FOR_MODEL, PRICE_FACT_FOR_MODEL],
    expected: {
      status: 'satisfied',
      action: 'execute',
      factRefs: [
        'store_fact:fact-service:1',
        'store_fact:fact-price:1',
      ],
      missingFactTypes: [],
      requestCount: 1,
    },
  },
  {
    name: 'critical price missing asks for confirmation',
    input: request(['service', 'price']),
    rights: authorizedRights,
    outputs: [
      {
        status: 'partial',
        matchedFactRefs: ['store_fact:fact-service:1'],
        missingFactTypes: ['price'],
      },
      { criticality: 'critical' },
    ],
    expectedFacts: [SERVICE_FACT_FOR_MODEL],
    expected: {
      status: 'partial',
      action: 'ask_user',
      factRefs: ['store_fact:fact-service:1'],
      missingFactTypes: ['price'],
      requestCount: 2,
    },
  },
  {
    name: 'optional staff experience missing continues with notice',
    input: request(['service', 'staff_experience']),
    rights: authorizedRights,
    outputs: [
      {
        status: 'partial',
        matchedFactRefs: ['store_fact:fact-service:1'],
        missingFactTypes: ['staff_experience'],
      },
      { criticality: 'optional' },
    ],
    expectedFacts: [SERVICE_FACT_FOR_MODEL],
    expected: {
      status: 'partial',
      action: 'execute_with_notice',
      factRefs: ['store_fact:fact-service:1'],
      missingFactTypes: ['staff_experience'],
      requestCount: 2,
    },
  },
  {
    name: 'expired price is excluded before satisfaction',
    input: {
      ...request(['price']),
      bundle: bundleWithFacts(['price'], {
        expiresAt: '2026-07-25T01:00:00.000Z',
      }),
    },
    rights: authorizedRights,
    outputs: [
      {
        status: 'unsatisfied',
        matchedFactRefs: [],
        missingFactTypes: ['price'],
      },
    ],
    expectedFacts: [],
    expected: {
      status: 'unsatisfied',
      action: 'conservative_guidance',
      factRefs: [],
      missingFactTypes: ['price'],
      requestCount: 1,
    },
  },
  {
    name: 'revoked price is excluded before satisfaction',
    input: {
      ...request(['price']),
      bundle: bundleWithFacts(['price'], { revisionKind: 'revocation' }),
    },
    rights: authorizedRights,
    outputs: [
      {
        status: 'unsatisfied',
        matchedFactRefs: [],
        missingFactTypes: ['price'],
      },
    ],
    expectedFacts: [],
    expected: {
      status: 'unsatisfied',
      action: 'conservative_guidance',
      factRefs: [],
      missingFactTypes: ['price'],
      requestCount: 1,
    },
  },
  {
    name: 'unauthorized price is excluded before satisfaction',
    input: {
      ...request(['price']),
      bundle: bundleWithFacts(['price']),
    },
    rights: unauthorizedRights,
    outputs: [
      {
        status: 'unsatisfied',
        matchedFactRefs: [],
        missingFactTypes: ['price'],
      },
    ],
    expectedFacts: [],
    expected: {
      status: 'unsatisfied',
      action: 'conservative_guidance',
      factRefs: [],
      missingFactTypes: ['price'],
      requestCount: 1,
    },
  },
  {
    name: 'forged matched reference falls back conservatively',
    input: request(['service']),
    rights: authorizedRights,
    outputs: [
      {
        status: 'satisfied',
        matchedFactRefs: ['store_fact:forged:99'],
        missingFactTypes: [],
      },
    ],
    expectedFacts: [SERVICE_FACT_FOR_MODEL],
    expected: {
      status: 'unsatisfied',
      action: 'conservative_guidance',
      factRefs: [],
      missingFactTypes: ['service'],
      requestCount: 1,
    },
  },
  {
    name: 'invalid satisfied output falls back conservatively',
    input: request(['service']),
    rights: authorizedRights,
    outputs: [
      { status: 'satisfied', matchedFactRefs: [], missingFactTypes: [] },
    ],
    expectedFacts: [SERVICE_FACT_FOR_MODEL],
    expected: {
      status: 'unsatisfied',
      action: 'conservative_guidance',
      factRefs: [],
      missingFactTypes: ['service'],
      requestCount: 1,
    },
  },
  {
    name: 'model failure falls back conservatively',
    input: request(['service']),
    rights: authorizedRights,
    outputs: [new Error('fixture model failure')],
    expectedFacts: [SERVICE_FACT_FOR_MODEL],
    expected: {
      status: 'unsatisfied',
      action: 'conservative_guidance',
      factRefs: [],
      missingFactTypes: ['service'],
      requestCount: 1,
    },
  },
] as const;

function request(factTypes: StoreFactKind[]) {
  return {
    workflowId: 'workflow-1',
    workflowRevision: 1,
    intent: '介绍服务和价格',
    factTypes,
    bundle: bundleWithFacts(['service']),
    at: NOW,
  };
}

function bundleWithFacts(
  factTypes: readonly StoreFactKind[],
  overrides: {
    expiresAt?: string | null;
    revisionKind?: 'revocation';
  } = {},
): ContextBundle {
  const facts = Object.fromEntries(
    factTypes.map((kind, index) => {
      const factId = `fact-${kind}`;
      return [
        `${kind}.value`,
        {
          value: { label: kind },
          layer: 'current_fact',
          pool: 'store_personal',
          sourceRef: `store_fact:${factId}:1`,
          factSnapshot: {
            factId,
            kind,
            revision: 1,
            source: {
              kind: 'user_confirmation',
              referenceId: `confirmation-${kind}`,
              capturedAt: '2026-07-25T00:00:00.000Z',
            },
            effectiveFrom: '2026-07-25T00:00:00.000Z',
            expiresAt: overrides.expiresAt ?? null,
            ...(overrides.revisionKind
              ? { revisionKind: overrides.revisionKind }
              : {}),
          },
        },
      ];
    }),
  );
  return contextBundleSchema.parse({
    bundleId: 'bundle-1',
    revision: 1,
    hash: 'a'.repeat(64),
    serializerVersion: 'context-bundle-c14n-v1',
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    frozenAt: '2026-07-25T00:00:00.000Z',
    frozenBy: 'owner-1',
    previousRevision: null,
    referencedFactRevisions: factTypes.map((kind) => ({
      factId: `fact-${kind}`,
      revision: 1,
    })),
    sourceRevisions: {
      facts: 3,
      assets: 4,
      identity: 2,
      rights: 8,
      preferences: 1,
      recipe: 2,
      platformRules: 7,
      currentSignal: 9,
    },
    dimensions: {
      promotion_task: {},
      traffic_opportunity: {},
      expression_identity: {},
      platform_mechanism: {},
      store_facts_assets: facts,
      conversion_action: {},
    },
  });
}

class FixtureExecutorRunner implements StructuredNodeRunner {
  private readonly executor = new FixtureAiStructuredObjectExecutor();

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    const result = await this.executor.generate(request);
    return {
      ...result,
      attempts: 1,
      replayed: false,
    };
  }
}

class QueueRunner implements StructuredNodeRunner {
  readonly requests: StructuredNodeRunnerRequest<unknown>[] = [];

  constructor(private readonly outputs: unknown[]) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push(request as StructuredNodeRunnerRequest<unknown>);
    const output = this.outputs.shift();
    if (output instanceof Error) throw output;
    return {
      output: request.schema.parse(output),
      attempts: 1,
      providerTaskRef: 'fixture-fact-assessment',
      replayed: false,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

function frozenPrompt(name: string, content: string) {
  return {
    name,
    version: '8',
    content,
    contentHash: '8'.repeat(64),
    label: 'production',
    source: 'langfuse' as const,
    isFallback: false,
  };
}
