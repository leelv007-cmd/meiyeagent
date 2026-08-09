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
import { P1DomainError } from '../foundation/domain.js';
import { FixtureAiStructuredObjectExecutor } from '../model-supply/ai-sdk-runner.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';
import {
  assessRecipeFactSatisfaction,
  type FactSatisfactionDiagnosticEvent,
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
        prompts: pinnedFactPrompts(),
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
  assert.equal(result.question.unattended, 'hold');
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

test('runner failures emit only structured safe fact diagnostics', async () => {
  const diagnostics: FactSatisfactionDiagnosticEvent[] = [];
  const runnerError = new P1DomainError(
    'NOT_FOUND',
    'workspace lookup failed: SECRET_PROMPT_AND_CREDENTIAL',
  );
  runnerError.stack = [
    'Error: workspace lookup failed: SECRET_PROMPT_AND_CREDENTIAL',
    '    at SECRET_ROUTE (apps/core/src/p1/harness/fact-satisfaction.test.ts:238:1)',
    '    at credential-provider (/tmp/SECRET_FACT_VALUE:1:1)',
  ].join('\n');
  const result = await assessRecipeFactSatisfaction(
    {
      ...request(['service']),
      intent: 'SECRET_PROMPT_MARKER',
    },
    new QueueRunner([runnerError]),
    authorizedRights,
    (event) => diagnostics.push(event),
  );
  await assessRecipeFactSatisfaction(
    request(['service']),
    new QueueRunner([
      Object.assign(new Error('ABCD1234'), {
        code: 'AKIAIOSFODNN7EXAMPLE',
        stack: 'Error: ABCD1234\n    at apps/core/src/sk-abc123.ts:1:1',
      }),
    ]),
    authorizedRights,
    (event) => diagnostics.push(event),
  );

  assert.equal(result.action, 'conservative_guidance');
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(
    {
      ...diagnostics[0],
      error: {
        ...diagnostics[0]!.error,
        stack: undefined,
      },
    },
    {
      event: 'harness_fact_node_failure',
      stage: 'runner',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      effectIdempotencyKey: 'wf:workflow-1:s2:facts:0',
      schemaName: 'harness_fact_satisfaction_v1',
      error: {
        name: 'P1DomainError',
        code: 'NOT_FOUND',
        message: 'Workspace resource was not found.',
        stack: undefined,
      },
    },
  );
  assert.match(diagnostics[0]!.error.stack ?? '', /fact-satisfaction\.test/u);
  assert.deepEqual(diagnostics[1]!.error, {
    name: 'Error',
    code: 'STRUCTURED_NODE_RUNNER_FAILED',
    message: 'Structured fact runner failed.',
    stack: diagnostics[1]!.error.stack,
  });
  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(serialized, /SECRET_|ABCD1234|AKIA|sk-abc/u);
  assert.doesNotMatch(serialized, /store_fact:/u);
  assert.doesNotMatch(serialized, /credential|provider|route/iu);
});

test('schema failures are distinct and redact invalid fact values', async () => {
  const diagnostics: FactSatisfactionDiagnosticEvent[] = [];
  const invalidOutput = {
    status: 'satisfied',
    matchedFactRefs: ['SECRET_FACT_REF'],
    missingFactTypes: ['price'],
  };
  for (const runner of [
    new QueueRunner([invalidOutput]),
    new RawOutputRunner(invalidOutput),
  ]) {
    const result = await assessRecipeFactSatisfaction(
      request(['service', 'price']),
      runner,
      authorizedRights,
      (event) => diagnostics.push(event),
    );
    assert.equal(result.action, 'conservative_guidance');
  }

  assert.equal(diagnostics.length, 2);
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.stage, 'schema_parse');
    assert.equal(diagnostic.error.name, 'ZodError');
    assert.equal(diagnostic.error.code, 'SCHEMA_PARSE_FAILED');
    assert.equal(
      diagnostic.error.message,
      'harness_fact_satisfaction_v1 output failed schema validation.',
    );
    assert.match(diagnostic.error.stack ?? '', /fact-satisfaction/u);
    const serialized = JSON.stringify(diagnostic);
    assert.doesNotMatch(serialized, /SECRET_FACT_REF|store_fact:/u);
    assert.doesNotMatch(serialized, /credential|route/iu);
  }
});

test('diagnostics reject malicious names, codes, and newline stack frames', async () => {
  const diagnostics: FactSatisfactionDiagnosticEvent[] = [];
  const error = Object.assign(new Error('SECRET_ERROR_MESSAGE'), {
    code: 'SECRET_CODE\n    at apps/core/src/secret-code.ts:1:1',
    stack:
      'SECRET_STACK\n    at apps/core/src/secret-stack.ts:2:2\n    at /tmp/private:3:3',
  });
  error.name = 'SECRET_NAME\n    at apps/core/src/secret-name.ts:4:4';

  await assessRecipeFactSatisfaction(
    request(['service']),
    new QueueRunner([error]),
    authorizedRights,
    (event) => diagnostics.push(event),
  );

  assert.equal(diagnostics.length, 1);
  assert.deepEqual(
    {
      ...diagnostics[0]!.error,
      stack: undefined,
    },
    {
      name: 'Error',
      code: 'STRUCTURED_NODE_RUNNER_FAILED',
      message: 'Structured fact runner failed.',
      stack: undefined,
    },
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /SECRET_|secret-(?:code|stack|name)|\/tmp\/private/u,
  );
});

test('criticality runner failures emit safe diagnostics before conservative guidance', async () => {
  const diagnostics: FactSatisfactionDiagnosticEvent[] = [];
  const result = await assessRecipeFactSatisfaction(
    request(['service', 'price']),
    new QueueRunner([
      {
        status: 'partial',
        matchedFactRefs: ['store_fact:fact-service:1'],
        missingFactTypes: ['price'],
      },
      new Error('SECRET_CRITICALITY_RUNNER_FAILURE'),
    ]),
    authorizedRights,
    (event) => diagnostics.push(event),
  );

  assert.equal(result.action, 'conservative_guidance');
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(
    {
      ...diagnostics[0],
      error: {
        ...diagnostics[0]!.error,
        stack: undefined,
      },
    },
    {
      event: 'harness_fact_node_failure',
      stage: 'runner',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      effectIdempotencyKey: 'wf:workflow-1:s2:facts:criticality:0',
      schemaName: 'harness_fact_criticality_v1',
      error: {
        name: 'Error',
        code: 'STRUCTURED_NODE_RUNNER_FAILED',
        message: 'Structured fact runner failed.',
        stack: undefined,
      },
    },
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /SECRET_CRITICALITY_RUNNER_FAILURE/u,
  );
});

test('criticality schema failures emit distinct safe diagnostics', async () => {
  const diagnostics: FactSatisfactionDiagnosticEvent[] = [];
  const result = await assessRecipeFactSatisfaction(
    request(['service', 'price']),
    new RawOutputQueueRunner([
      {
        status: 'partial',
        matchedFactRefs: ['store_fact:fact-service:1'],
        missingFactTypes: ['price'],
      },
      { criticality: 'SECRET_INVALID_CRITICALITY' },
    ]),
    authorizedRights,
    (event) => diagnostics.push(event),
  );

  assert.equal(result.action, 'conservative_guidance');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.stage, 'schema_parse');
  assert.equal(
    diagnostics[0]!.effectIdempotencyKey,
    'wf:workflow-1:s2:facts:criticality:0',
  );
  assert.equal(diagnostics[0]!.schemaName, 'harness_fact_criticality_v1');
  assert.deepEqual(
    {
      ...diagnostics[0]!.error,
      stack: undefined,
    },
    {
      name: 'ZodError',
      code: 'SCHEMA_PARSE_FAILED',
      message:
        'harness_fact_criticality_v1 output failed schema validation.',
      stack: undefined,
    },
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /SECRET_INVALID_CRITICALITY/u,
  );
});

test('invalid local QuestionCard construction is a criticality runner-stage failure', async () => {
  const diagnostics: FactSatisfactionDiagnosticEvent[] = [];
  const result = await assessRecipeFactSatisfaction(
    {
      ...request(['service', 'price']),
      workflowId: ' ',
    },
    new QueueRunner([
      {
        status: 'partial',
        matchedFactRefs: ['store_fact:fact-service:1'],
        missingFactTypes: ['price'],
      },
      { criticality: 'critical' },
    ]),
    authorizedRights,
    (event) => diagnostics.push(event),
  );

  assert.equal(result.action, 'conservative_guidance');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.stage, 'runner');
  assert.equal(
    diagnostics[0]!.effectIdempotencyKey,
    'wf: :s2:facts:criticality:0',
  );
  assert.equal(diagnostics[0]!.schemaName, 'harness_fact_criticality_v1');
  assert.equal(
    diagnostics[0]!.error.code,
    'STRUCTURED_NODE_RUNNER_FAILED',
  );
});

test('diagnostic logger failures preserve conservative guidance', async () => {
  for (const runner of [
    new QueueRunner([new Error('runner failed')]),
    new RawOutputRunner({
      status: 'satisfied',
      matchedFactRefs: [],
      missingFactTypes: ['price'],
    }),
  ]) {
    const result = await assessRecipeFactSatisfaction(
      request(['price']),
      runner,
      authorizedRights,
      () => {
        throw new Error('diagnostic transport failed');
      },
    );
    assert.equal(result.action, 'conservative_guidance');
  }
});

test('a ledger wider than the recipe factTypes keeps every matched fact authorized', async () => {
  const result = await assessRecipeFactSatisfaction(
    {
      prompts: pinnedFactPrompts(),
      workflowId: 'workflow-1',
      workflowRevision: 1,
      intent: '介绍服务和价格',
      factTypes: ['service'],
      bundle: bundleWithFacts(['service', 'price', 'fulfillment', 'other']),
      at: NOW,
    },
    new QueueRunner([
      {
        status: 'satisfied',
        matchedFactRefs: [
          'store_fact:fact-service:1',
          'store_fact:fact-price:1',
          'store_fact:fact-fulfillment:1',
          'store_fact:fact-other:1',
        ],
        missingFactTypes: [],
      },
    ]),
    authorizedRights,
  );
  assert.equal(result.status, 'satisfied');
  assert.equal(result.action, 'execute');
  assert.ok(result.factRefs.includes('store_fact:fact-price:1'));
  assert.equal(result.factRefs.length, 4);
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
    // Both keys live in the agentControl pack, so task-admission always freezes
    // them; a request without them is a state production cannot reach.
    prompts: pinnedFactPrompts(),
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

class RawOutputRunner implements StructuredNodeRunner {
  constructor(private readonly output: unknown) {}

  async run<Output>(_request: StructuredNodeRunnerRequest<Output>) {
    return {
      output: this.output as Output,
      attempts: 1,
      providerTaskRef: 'fixture-unparsed-fact-assessment',
      replayed: false,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

class RawOutputQueueRunner implements StructuredNodeRunner {
  constructor(private readonly outputs: unknown[]) {}

  async run<Output>(_request: StructuredNodeRunnerRequest<Output>) {
    return {
      output: this.outputs.shift() as Output,
      attempts: 1,
      providerTaskRef: 'fixture-unparsed-fact-assessment',
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

function pinnedFactPrompts() {
  return {
    factSatisfaction: frozenPrompt(
      'harness/fact-satisfaction',
      'frozen:factSatisfaction',
    ),
    factCriticality: frozenPrompt(
      'harness/fact-criticality',
      'frozen:factCriticality',
    ),
  };
}

test('fact satisfaction fails closed when a frozen prompt pin is missing', async () => {
  // Substituting HARNESS_BUILTIN_PROMPTS here was silent, so a run on a builtin
  // prompt was indistinguishable from a run on the release pin. Both keys live
  // in the agentControl pack, so task-admission always freezes them.
  const satisfactionRunner = new QueueRunner([
    { status: 'satisfied', matchedFactRefs: [], missingFactTypes: [] },
  ]);
  await assert.rejects(
    assessRecipeFactSatisfaction(
      {
        workflowId: 'workflow-missing-fact-pin',
        workflowRevision: 1,
        intent: '介绍护理服务和价格',
        factTypes: ['service'],
        bundle: bundleWithFacts(['service']),
        at: NOW,
      },
      satisfactionRunner,
      authorizedRights,
    ),
    /requires the frozen prompt pin factSatisfaction/u,
  );
  assert.equal(satisfactionRunner.requests.length, 0);

  // factCriticality is only reached once satisfaction reports a gap, so pin
  // satisfaction and leave criticality absent to isolate the second guard.
  const criticalityRunner = new QueueRunner([
    {
      status: 'partial',
      matchedFactRefs: ['store_fact:fact-service:1'],
      missingFactTypes: ['price'],
    },
  ]);
  await assert.rejects(
    assessRecipeFactSatisfaction(
      {
        workflowId: 'workflow-missing-criticality-pin',
        workflowRevision: 1,
        intent: '介绍护理服务和价格',
        factTypes: ['service', 'price'],
        bundle: bundleWithFacts(['service']),
        at: NOW,
        prompts: {
          factSatisfaction: frozenPrompt(
            'harness/fact-satisfaction',
            'frozen:factSatisfaction',
          ),
        },
      },
      criticalityRunner,
      authorizedRights,
    ),
    /requires the frozen prompt pin factCriticality/u,
  );
  assert.equal(criticalityRunner.requests.length, 1);
});
