import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

test('partial critical facts ask through QuestionCard and retain canonical ledger intake', async () => {
  const runner = new QueueRunner([
    {
      status: 'partial',
      matchedFactRefs: ['store_fact:fact-service:1'],
      missingFactTypes: ['price'],
    },
    { criticality: 'critical' },
  ]);
  const result = await assessRecipeFactSatisfaction(
    request(['service', 'price']),
    runner,
    authorizedRights,
  );

  assert.equal(result.status, 'partial');
  assert.equal(result.action, 'ask_user');
  if (result.action !== 'ask_user') assert.fail('expected ask_user');
  assert.equal(result.question.response.field, 'store_facts');
  assert.deepEqual(result.ledgerIntake, {
    factTypes: ['price'],
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
  assert.match(result.resultNotice, /未使用/u);
});

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
