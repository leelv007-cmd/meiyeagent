import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  type ModelSupplyLedgerPort,
  type ModelSupplyLedgerCheckpointInput,
  type ModelSupplyResult,
} from './index.js';
import {
  AiSdkStructuredObjectExecutor,
  ModelSupplyStructuredNodeRunner,
  StructuredNodeRunError,
  type StructuredNodeRunner,
  type StructuredObjectExecutor,
} from './structured-node-runner.js';
import {
  InMemoryStructuredNodeMetrics,
  nameHarnessIntent,
} from '../harness/structured-nodes.js';
import {
  ExecutionAttemptBudget,
  ExecutionAttemptBudgetExceeded,
  withExecutionAttemptBudget,
} from './execution-attempt-budget.js';
import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { FoundationModelSupplyLedger } from './foundation-ledger.js';

test('AI SDK structured executor uses Output.object and final-step metadata', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const executor = new AiSdkStructuredObjectExecutor({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-harness',
    fetch: (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              message: {
                content: JSON.stringify({ normalized: '团购转化文案' }),
                role: 'assistant',
              },
            },
          ],
          created: 1,
          id: 'chatcmpl-harness-structured',
          model: 'provider-model',
          object: 'chat.completion',
          usage: {
            completion_tokens: 13,
            prompt_tokens: 8,
            total_tokens: 21,
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });

  const result = await executor.generate({
    instructions: 'Normalize the intent.',
    prompt: '{"intent":"把新团购做一套能发的"}',
    schema: z.object({ normalized: z.string() }).strict(),
    schemaName: 'harness_intent_naming_v1',
  });

  assert.deepEqual(result, {
    output: { normalized: '团购转化文案' },
    providerTaskRef: 'chatcmpl-harness-structured',
    usage: { inputTokens: 8, outputTokens: 13 },
  });
  const responseFormat = requests[0]?.response_format as {
    json_schema?: { name?: string };
    type?: string;
  };
  assert.equal(responseFormat.type, 'json_schema');
  assert.equal(
    responseFormat.json_schema?.name,
    'harness_intent_naming_v1',
  );
});

test('D-035 measures one real schema repair as first-pass miss, repair, and retry', async () => {
  const responses = [
    {
      id: 'chatcmpl-invalid-structured',
      output: { normalizedIntent: '介绍日常护理' },
    },
    {
      id: 'chatcmpl-repaired-structured',
      output: {
        normalizedIntent: '介绍日常护理',
        taskType: 'daily_service_exposure',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['industry_category'],
        usedAssetCategories: ['industry_category'],
        route: 'customized',
        implicitConstraints: [],
        blockingGap: null,
      },
    },
  ];
  let providerCalls = 0;
  const executor = new AiSdkStructuredObjectExecutor({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-harness',
    fetch: (async () => {
      const response = responses[providerCalls++];
      assert.ok(response);
      return openAiStructuredResponse(response.id, response.output);
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });
  const runner = createRunner(new CountingLedger(), executor);
  const metrics = new InMemoryStructuredNodeMetrics();
  let providerFences = 0;

  const named = await nameHarnessIntent(
    {
      workflowId: 'workflow-real-repair',
      workflowRevision: 1,
      intent: {
        context: {
          workId: 'work-real-repair',
          intent: '介绍日常护理',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    {
      run(request) {
        return runner.run({
          ...request,
          beforeProviderAttempt: async () => {
            providerFences += 1;
          },
        });
      },
    },
    metrics,
  );

  assert.equal(named.declaration.normalizedIntent, '介绍日常护理');
  assert.equal(providerCalls, 2);
  assert.equal(providerFences, 2);
  assert.deepEqual(metrics.snapshot(), {
    initial: { calls: 1, schemaValid: 0, schemaInvalid: 1 },
    repair: {
      status: 'observed',
      count: 1,
      reasons: ['schema_validation'],
    },
    retry: { triggered: 1 },
    nestedCompleteness: { complete: 6, total: 7 },
  });
});

test('one shared attempt budget blocks a real schema repair before its provider effect', async () => {
  let providerCalls = 0;
  const executor = new AiSdkStructuredObjectExecutor({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-harness',
    fetch: (async () => {
      providerCalls += 1;
      return openAiStructuredResponse('chatcmpl-invalid-budgeted', {
        normalizedIntent: 'missing required fields',
      });
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });
  const budget = new ExecutionAttemptBudget({
    maxAttempts: 1,
    consumedAttempts: 0,
  });
  const runner = withExecutionAttemptBudget(
    createRunner(new CountingLedger(), executor),
    budget,
  );

  await assert.rejects(
    runner.run({
      effectIdempotencyKey: 'wf:workflow-budgeted-repair:s1:intent:0',
      schemaName: 'harness_intent_naming_v1',
      schemaRevision: 'intent-naming-v1',
      instructions: 'Return the normalized intent.',
      prompt: '{"intent":"介绍日常护理"}',
      schema: z
        .object({
          normalizedIntent: z.string(),
          taskType: z.string(),
        })
        .strict(),
    }),
    ExecutionAttemptBudgetExceeded,
  );

  assert.equal(providerCalls, 1);
  assert.equal(budget.consumedAttempts, 1);
});

test('a raised attempt limit resumes durable schema repair without repeating the completed first pass', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-1', 'user-1');
  const foundation = new P1ApplicationService(repository);
  const durableLedger = new FoundationModelSupplyLedger(foundation);
  const settlements: ModelSupplyResult[] = [];
  const ledger: ModelSupplyLedgerPort = {
    checkpointAttempt: (input) => durableLedger.checkpointAttempt(input),
    async settleAttempt(input) {
      settlements.push(structuredClone(input.result));
      await durableLedger.settleAttempt(input);
    },
  };
  const responses = [
    { normalized: '提高上限后继续' },
    { normalized: '提高上限后继续', taskType: 'copy' },
  ];
  let providerCalls = 0;
  const executor = new AiSdkStructuredObjectExecutor({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-harness',
    fetch: (async () =>
      openAiStructuredResponse(
        `chatcmpl-budget-resume-${providerCalls}`,
        responses[providerCalls++]!,
      )) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });
  const request = {
    effectIdempotencyKey: 'wf:workflow-budget-resume:s1:intent:0',
    schemaName: 'intent_naming_v1',
    schemaRevision: 'intent-naming-v1',
    instructions: 'Return the normalized intent.',
    prompt: '{"intent":"提高上限后继续"}',
    schema: z
      .object({ normalized: z.string(), taskType: z.string() })
      .strict(),
  };

  await assert.rejects(
    withExecutionAttemptBudget(
      createRunner(ledger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 1,
        consumedAttempts: 0,
      }),
    ).run(request),
    ExecutionAttemptBudgetExceeded,
  );
  assert.equal(providerCalls, 1);
  assert.deepEqual(settlements[0]?.providerCost, {
    id: settlements[0]?.providerCost.id,
    status: 'observed',
    amount: 0.000034,
    currency: 'USD',
    usage: { inputTokens: 8, outputTokens: 13 },
  });

  await assert.rejects(
    withExecutionAttemptBudget(
      createRunner(ledger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 1,
        consumedAttempts: 1,
      }),
    ).run(request),
    ExecutionAttemptBudgetExceeded,
  );
  assert.equal(providerCalls, 1);

  const resumed = await withExecutionAttemptBudget(
    createRunner(ledger, executor, false),
    new ExecutionAttemptBudget({
      maxAttempts: 2,
      consumedAttempts: 1,
    }),
  ).run(request);
  const replayed = await withExecutionAttemptBudget(
    createRunner(ledger, executor, false),
    new ExecutionAttemptBudget({
      maxAttempts: 2,
      consumedAttempts: 2,
    }),
  ).run(request);

  assert.deepEqual(resumed.output, {
    normalized: '提高上限后继续',
    taskType: 'copy',
  });
  assert.deepEqual(resumed.usage, {
    inputTokens: 16,
    outputTokens: 26,
  });
  assert.equal(resumed.replayed, false);
  assert.deepEqual(replayed.output, resumed.output);
  assert.equal(providerCalls, 2);
  assert.deepEqual(
    settlements.map((result) => result.providerCost.usage),
    [
      { inputTokens: 8, outputTokens: 13 },
      { inputTokens: 8, outputTokens: 13 },
    ],
  );
  assert.deepEqual(
    settlements[1]?.providerCosts.map((cost) => cost.usage),
    [
      { inputTokens: 8, outputTokens: 13 },
      { inputTokens: 8, outputTokens: 13 },
    ],
  );
});

test('a raised attempt limit resumes a durable zero-attempt suspension with one provider effect', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-1', 'user-1');
  const foundation = new P1ApplicationService(repository);
  const ledger = new FoundationModelSupplyLedger(foundation);
  const executor = new CountingStructuredExecutor({
    normalized: '零次暂停后继续',
  });
  const request = {
    effectIdempotencyKey: 'wf:workflow-zero-budget-resume:s1:intent:0',
    schemaName: 'intent_naming_v1',
    schemaRevision: 'intent-naming-v1',
    instructions: 'Return the normalized intent.',
    prompt: '{"intent":"零次暂停后继续"}',
    schema: z.object({ normalized: z.string() }).strict(),
  };

  await assert.rejects(
    withExecutionAttemptBudget(
      createRunner(ledger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 0,
        consumedAttempts: 0,
      }),
    ).run(request),
    ExecutionAttemptBudgetExceeded,
  );
  assert.equal(executor.calls, 0);

  const resumed = await withExecutionAttemptBudget(
    createRunner(ledger, executor, false),
    new ExecutionAttemptBudget({
      maxAttempts: 1,
      consumedAttempts: 0,
    }),
  ).run(request);
  const replayed = await withExecutionAttemptBudget(
    createRunner(ledger, executor, false),
    new ExecutionAttemptBudget({
      maxAttempts: 1,
      consumedAttempts: 1,
    }),
  ).run(request);

  assert.deepEqual(resumed.output, { normalized: '零次暂停后继续' });
  assert.deepEqual(replayed.output, resumed.output);
  assert.equal(executor.calls, 1);
});

test('a durable zero-attempt suspension rejects cold-restart prompt drift before provider execution', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-1', 'user-1');
  const foundation = new P1ApplicationService(repository);
  const ledger = new FoundationModelSupplyLedger(foundation);
  const executor = new CountingStructuredExecutor({
    normalized: 'must stay fenced',
  });
  const request = {
    effectIdempotencyKey: 'wf:workflow-zero-budget-drift:s1:intent:0',
    schemaName: 'intent_naming_v1',
    schemaRevision: 'intent-naming-v1',
    instructions: 'Return the normalized intent.',
    prompt: '{"intent":"原始请求"}',
    schema: z.object({ normalized: z.string() }).strict(),
  };

  await assert.rejects(
    withExecutionAttemptBudget(
      createRunner(ledger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 0,
        consumedAttempts: 0,
      }),
    ).run(request),
    ExecutionAttemptBudgetExceeded,
  );
  await assert.rejects(
    withExecutionAttemptBudget(
      createRunner(ledger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 1,
        consumedAttempts: 0,
      }),
    ).run({ ...request, prompt: '{"intent":"漂移请求"}' }),
    /Recovered attempt-budget request fingerprint does not match/u,
  );

  assert.equal(executor.calls, 0);
});

test('durable schema repair rejects a malformed recovered continuation before provider execution', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-1', 'user-1');
  const foundation = new P1ApplicationService(repository);
  const durableLedger = new FoundationModelSupplyLedger(foundation);
  const malformedLedger: ModelSupplyLedgerPort = {
    async checkpointAttempt(input) {
      const checkpoint = await durableLedger.checkpointAttempt(input);
      if (
        checkpoint.recoveredResult?.failureCode ===
        'EXECUTION_ATTEMPT_BUDGET_SUSPENDED_BEFORE_PROVIDER'
      ) {
        checkpoint.recoveredResult.structuredContinuation = {
          kind: 'schema_repair',
          invalidText: 42,
          usage: { inputTokens: -1, outputTokens: 0 },
        } as never;
      }
      return checkpoint;
    },
    settleAttempt: (input) => durableLedger.settleAttempt(input),
  };
  let providerCalls = 0;
  const executor = new AiSdkStructuredObjectExecutor({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-harness',
    fetch: (async () => {
      providerCalls += 1;
      return openAiStructuredResponse('chatcmpl-malformed-continuation', {
        normalized: 'missing taskType',
      });
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });
  const request = {
    effectIdempotencyKey: 'wf:workflow-malformed-continuation:s1:intent:0',
    schemaName: 'intent_naming_v1',
    schemaRevision: 'intent-naming-v1',
    instructions: 'Return the normalized intent.',
    prompt: '{"intent":"验证坏恢复数据"}',
    schema: z
      .object({ normalized: z.string(), taskType: z.string() })
      .strict(),
  };

  await assert.rejects(
    withExecutionAttemptBudget(
      createRunner(malformedLedger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 1,
        consumedAttempts: 0,
      }),
    ).run(request),
    ExecutionAttemptBudgetExceeded,
  );
  await assert.rejects(
    withExecutionAttemptBudget(
      createRunner(malformedLedger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 2,
        consumedAttempts: 1,
      }),
    ).run(request),
    /Recovered structured execution continuation is invalid/u,
  );

  assert.equal(providerCalls, 1);
});

test('a durable budget suspension records observed cost without persisting sensitive invalid output', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-1', 'user-1');
  const foundation = new P1ApplicationService(repository);
  const durableLedger = new FoundationModelSupplyLedger(foundation);
  let settled: ModelSupplyResult | undefined;
  const ledger: ModelSupplyLedgerPort = {
    checkpointAttempt: (input) => durableLedger.checkpointAttempt(input),
    async settleAttempt(input) {
      settled = structuredClone(input.result);
      await durableLedger.settleAttempt(input);
    },
  };
  let providerCalls = 0;
  const executor = new AiSdkStructuredObjectExecutor({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-harness',
    fetch: (async () => {
      providerCalls += 1;
      return openAiStructuredResponse('chatcmpl-sensitive-invalid-output', {
        normalized: '联系电话 13800138000',
      });
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });
  const request = {
    effectIdempotencyKey: 'wf:workflow-sensitive-suspension:s1:intent:0',
    schemaName: 'intent_naming_v1',
    schemaRevision: 'intent-naming-v1',
    instructions: 'Return the normalized intent.',
    prompt: '{"intent":"验证安全 continuation"}',
    schema: z
      .object({ normalized: z.string(), taskType: z.string() })
      .strict(),
  };

  await assert.rejects(
    withExecutionAttemptBudget(
      createRunner(ledger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 1,
        consumedAttempts: 0,
      }),
    ).run(request),
    ExecutionAttemptBudgetExceeded,
  );

  assert.equal(providerCalls, 1);
  assert.equal(JSON.stringify(settled).includes('13800138000'), false);
  assert.equal(JSON.stringify(settled).includes('invalidText'), false);
  assert.deepEqual(settled?.providerCost, {
    id: settled?.providerCost.id,
    status: 'observed',
    amount: 0.000034,
    currency: 'USD',
    usage: { inputTokens: 8, outputTokens: 13 },
  });
  const persisted = await foundation.getGenerationJob(
    {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      correlationId: request.effectIdempotencyKey,
    },
    settled!.jobId,
  );
  assert.equal(JSON.stringify(persisted.result).includes('13800138000'), false);
});

test('durable schema repair rejects cold-restart structured request drift before provider execution', async () => {
  const driftCases = [
    {
      name: 'prompt',
      mutate: (request: DurableStructuredRequest) => ({
        ...request,
        prompt: '{"intent":"漂移后的 prompt"}',
      }),
    },
    {
      name: 'instructions',
      mutate: (request: DurableStructuredRequest) => ({
        ...request,
        instructions: 'Return a different object.',
      }),
    },
    {
      name: 'schemaName',
      mutate: (request: DurableStructuredRequest) => ({
        ...request,
        schemaName: 'different_intent_naming_v1',
      }),
    },
    {
      name: 'schemaRevision',
      mutate: (request: DurableStructuredRequest) => ({
        ...request,
        schemaRevision: 'intent-naming-v2',
      }),
    },
    {
      name: 'schema',
      mutate: (request: DurableStructuredRequest) => ({
        ...request,
        schema: z
          .object({
            normalized: z.string(),
            taskType: z.string(),
            extraField: z.string().optional(),
          })
          .strict(),
      }),
    },
    {
      name: 'streaming',
      mutate: (request: DurableStructuredRequest) => ({
        ...request,
        onPartialOutput: () => undefined,
      }),
    },
  ];

  for (const driftCase of driftCases) {
    const fixture = createDurableStructuredSuspension(
      `wf:workflow-request-drift-${driftCase.name}:s1:intent:0`,
    );
    await assert.rejects(
      withExecutionAttemptBudget(
        fixture.runner(),
        new ExecutionAttemptBudget({
          maxAttempts: 1,
          consumedAttempts: 0,
        }),
      ).run(fixture.request),
      ExecutionAttemptBudgetExceeded,
    );
    assert.equal(fixture.providerCalls(), 1);

    await assert.rejects(
      withExecutionAttemptBudget(
        fixture.runner(),
        new ExecutionAttemptBudget({
          maxAttempts: 2,
          consumedAttempts: 1,
        }),
      ).run(driftCase.mutate(fixture.request)),
      /Recovered structured execution request fingerprint does not match/u,
    );
    assert.equal(
      fixture.providerCalls(),
      1,
      `${driftCase.name} drift must not reach the provider`,
    );
  }
});

test('an exhausted resumed continuation is fenced before an executor that ignores callbacks', async () => {
  const fixture = createDurableStructuredSuspension(
    'wf:workflow-ignoring-executor:s1:intent:0',
  );
  await assert.rejects(
    withExecutionAttemptBudget(
      fixture.runner(),
      new ExecutionAttemptBudget({
        maxAttempts: 1,
        consumedAttempts: 0,
      }),
    ).run(fixture.request),
    ExecutionAttemptBudgetExceeded,
  );
  const ignoringExecutor = new IgnoringFenceStructuredExecutor();

  await assert.rejects(
    withExecutionAttemptBudget(
      createRunner(fixture.ledger, ignoringExecutor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 1,
        consumedAttempts: 1,
      }),
    ).run(fixture.request),
    ExecutionAttemptBudgetExceeded,
  );

  assert.equal(ignoringExecutor.calls, 0);
});

test('a raised attempt limit resumes durable route fallback at the next model without repeating the rejected model', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-1', 'user-1');
  const foundation = new P1ApplicationService(repository);
  const ledger = new FoundationModelSupplyLedger(foundation);
  const executor = new RouteTrackingFallbackStructuredExecutor();
  const request = {
    effectIdempotencyKey: 'wf:workflow-budget-route-resume:s3:brief:0',
    schemaName: 'copy_brief_v1',
    schemaRevision: 'copy-brief-v1',
    instructions: 'Return a Copy Brief.',
    prompt: '{"intent":"改写旧内容"}',
    schema: z.object({ normalized: z.string() }).strict(),
  };

  await assert.rejects(
    withExecutionAttemptBudget(
      createAutoRunner(ledger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 1,
        consumedAttempts: 0,
      }),
    ).run(request),
    ExecutionAttemptBudgetExceeded,
  );
  assert.deepEqual(executor.invokedCatalogModels, ['llm-primary']);

  const resumed = await withExecutionAttemptBudget(
    createAutoRunner(ledger, executor, false),
    new ExecutionAttemptBudget({
      maxAttempts: 2,
      consumedAttempts: 1,
    }),
  ).run(request);
  const replayed = await withExecutionAttemptBudget(
    createAutoRunner(ledger, executor, false),
    new ExecutionAttemptBudget({
      maxAttempts: 2,
      consumedAttempts: 2,
    }),
  ).run(request);

  assert.deepEqual(resumed.output, { normalized: 'fallback output' });
  assert.deepEqual(replayed.output, resumed.output);
  assert.deepEqual(executor.invokedCatalogModels, [
    'llm-primary',
    'llm-fallback',
  ]);
});

test('a durable route-fallback suspension rejects cold-restart prompt drift before the fallback model', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-1', 'user-1');
  const foundation = new P1ApplicationService(repository);
  const ledger = new FoundationModelSupplyLedger(foundation);
  const executor = new RouteTrackingFallbackStructuredExecutor();
  const request = {
    effectIdempotencyKey: 'wf:workflow-budget-route-drift:s3:brief:0',
    schemaName: 'copy_brief_v1',
    schemaRevision: 'copy-brief-v1',
    instructions: 'Return a Copy Brief.',
    prompt: '{"intent":"原始请求"}',
    schema: z.object({ normalized: z.string() }).strict(),
  };

  await assert.rejects(
    withExecutionAttemptBudget(
      createAutoRunner(ledger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 1,
        consumedAttempts: 0,
      }),
    ).run(request),
    ExecutionAttemptBudgetExceeded,
  );
  await assert.rejects(
    withExecutionAttemptBudget(
      createAutoRunner(ledger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 2,
        consumedAttempts: 1,
      }),
    ).run({ ...request, prompt: '{"intent":"漂移请求"}' }),
    /Recovered attempt-budget request fingerprint does not match/u,
  );

  assert.deepEqual(executor.invokedCatalogModels, ['llm-primary']);
});

test('a raised durable schema repair failure appends only repair-attempt cost', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-1', 'user-1');
  const foundation = new P1ApplicationService(repository);
  const durableLedger = new FoundationModelSupplyLedger(foundation);
  const settlements: ModelSupplyResult[] = [];
  const ledger: ModelSupplyLedgerPort = {
    checkpointAttempt: (input) => durableLedger.checkpointAttempt(input),
    async settleAttempt(input) {
      settlements.push(structuredClone(input.result));
      await durableLedger.settleAttempt(input);
    },
  };
  let providerCalls = 0;
  const executor = new AiSdkStructuredObjectExecutor({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-harness',
    fetch: (async () => {
      providerCalls += 1;
      return openAiStructuredResponse(
        `chatcmpl-durable-repair-failure-${providerCalls}`,
        { normalized: 'still missing taskType' },
      );
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });
  const request = {
    effectIdempotencyKey: 'wf:workflow-durable-repair-failure:s1:intent:0',
    schemaName: 'intent_naming_v1',
    schemaRevision: 'intent-naming-v1',
    instructions: 'Return the normalized intent.',
    prompt: '{"intent":"验证 repair failure cost"}',
    schema: z
      .object({ normalized: z.string(), taskType: z.string() })
      .strict(),
  };

  await assert.rejects(
    withExecutionAttemptBudget(
      createRunner(ledger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 1,
        consumedAttempts: 0,
      }),
    ).run(request),
    ExecutionAttemptBudgetExceeded,
  );
  await assert.rejects(
    withExecutionAttemptBudget(
      createRunner(ledger, executor, false),
      new ExecutionAttemptBudget({
        maxAttempts: 2,
        consumedAttempts: 1,
      }),
    ).run(request),
    (error: unknown) => {
      assert.ok(error instanceof StructuredNodeRunError);
      assert.equal(error.attempts, 2);
      assert.equal(error.measurement?.providerAttempts, 2);
      return true;
    },
  );

  assert.equal(providerCalls, 2);
  assert.deepEqual(
    settlements[1]?.providerCosts.map((cost) => cost.usage),
    [
      { inputTokens: 8, outputTokens: 13 },
      { inputTokens: 8, outputTokens: 13 },
    ],
  );
});

test('D-035 counts a call when both the first pass and bounded repair fail', async () => {
  let providerCalls = 0;
  const executor = new AiSdkStructuredObjectExecutor({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-harness',
    fetch: (async () => {
      providerCalls += 1;
      return openAiStructuredResponse(
        `chatcmpl-double-failure-${providerCalls}`,
        { normalizedIntent: 'still missing required fields' },
      );
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });
  const metrics = new InMemoryStructuredNodeMetrics();

  const named = await nameHarnessIntent(
    {
      workflowId: 'workflow-double-schema-failure',
      workflowRevision: 1,
      intent: {
        context: {
          workId: 'work-double-schema-failure',
          intent: '介绍日常护理',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    createRunner(new CountingLedger(), executor),
    metrics,
  );

  assert.equal(named.declaration.route, 'guidance');
  assert.equal(providerCalls, 2);
  assert.deepEqual(metrics.snapshot(), {
    initial: { calls: 1, schemaValid: 0, schemaInvalid: 1 },
    repair: {
      status: 'observed',
      count: 1,
      reasons: ['schema_validation'],
    },
    retry: { triggered: 1 },
    nestedCompleteness: { complete: 0, total: 7 },
  });
});

test('durable model-supply replay preserves the original repair measurement', async () => {
  const application = createStructuredApplication(new CountingLedger());
  const firstExecutor = new MeasuredStructuredExecutor();
  const request = {
    effectIdempotencyKey: 'wf:workflow-durable-replay:s1:intent:0',
    schemaName: 'intent_naming_v1',
    schemaRevision: 'intent-naming-v1',
    instructions: 'Return the normalized intent.',
    prompt: '{"intent":"介绍日常护理"}',
    schema: z.object({ normalized: z.string() }).strict(),
  };

  const first = await createRunnerWithApplication(
    application,
    firstExecutor,
  ).run(request);
  const replayExecutor = new CountingStructuredExecutor({
    normalized: 'must not execute',
  });
  const replay = await createRunnerWithApplication(
    application,
    replayExecutor,
  ).run(request);

  assert.equal(first.firstPassSchemaValid, false);
  assert.deepEqual(first.repair, {
    count: 1,
    reasons: ['schema_validation'],
  });
  assert.equal(replay.replayed, false);
  assert.equal(replay.firstPassSchemaValid, false);
  assert.deepEqual(replay.repair, first.repair);
  assert.equal(replayExecutor.calls, 0);
});

test('AI SDK structured executor exposes partial structured output before completion', async () => {
  const partials: unknown[] = [];
  const executor = new AiSdkStructuredObjectExecutor({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-harness',
    fetch: (async () =>
      openAiStreamResponse([
        '{"title":"门店',
        '真实记录","body":"先写',
        '清到店细节","conversionHook":"私信预约"}',
      ])) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });

  const result = await executor.generate({
    instructions: 'Generate one copy candidate.',
    onPartialOutput: (partial) => {
      partials.push(structuredClone(partial));
    },
    prompt: '{"intent":"写一条真实到店文案"}',
    schema: z
      .object({
        title: z.string(),
        body: z.string(),
        conversionHook: z.string(),
      })
      .strict(),
    schemaName: 'harness_copy_candidate_v1',
  });

  assert.ok(partials.length >= 2);
  assert.deepEqual(partials.at(-1), result.output);
  assert.deepEqual(result.output, {
    title: '门店真实记录',
    body: '先写清到店细节',
    conversionHook: '私信预约',
  });
});

test('structured runner replays one effect without a second model call or billing', async () => {
  const ledger = new CountingLedger();
  const executor = new CountingStructuredExecutor({ normalized: '团购转化文案' });
  const runner = createRunner(ledger, executor);
  const request = {
    effectIdempotencyKey: 'wf:workflow-1:s1:intent:0',
    schemaName: 'intent_naming_v1',
    schemaRevision: 'intent-naming-v1',
    instructions: 'Return the normalized intent.',
    prompt: '{"intent":"把新团购做一套能发的"}',
    schema: z.object({ normalized: z.string() }).strict(),
  };

  const first = await runner.run(request);
  const replay = await runner.run(request);

  assert.deepEqual(first.output, { normalized: '团购转化文案' });
  assert.deepEqual(replay.output, first.output);
  assert.equal(executor.calls, 1);
  assert.equal(ledger.checkpoints, 1);
  assert.equal(ledger.settlements, 1);
  assert.deepEqual(
    ledger.submissions.map((submission) => ({
      billingQuoteRevision: submission.billingQuoteRevision,
      billingTaskId: submission.billingTaskId,
      productUsageQuantity: submission.productUsageQuantity,
    })),
    [
      {
        billingQuoteRevision: 'quote-r1',
        billingTaskId: 'task-1',
        productUsageQuantity: 0,
      },
    ],
  );
});

test('zero-product assistant work still records provider attempt and cost without a product billing task', async () => {
  const ledger = new CountingLedger();
  const executor = new CountingStructuredExecutor({ normalized: '身份建议' });
  const runner = createRunner(ledger, executor, false);

  await runner.run({
    effectIdempotencyKey: 'identity-draft-1',
    schemaName: 'marketing_identity_draft_v1',
    schemaRevision: 'marketing-identity-draft-v2',
    instructions: 'Draft an identity.',
    prompt: '{"background":"头皮护理门店"}',
    schema: z.object({ normalized: z.string() }).strict(),
  });

  assert.equal(ledger.checkpoints, 1);
  assert.equal(ledger.settlements, 1);
  assert.equal(ledger.submissions[0]?.productUsageQuantity, 0);
  assert.equal(ledger.submissions[0]?.billingTaskId, undefined);
  assert.equal(ledger.submissions[0]?.billingQuoteRevision, undefined);
});

test('structured runner rejects one effect key reused with another payload', async () => {
  const ledger = new CountingLedger();
  const executor = new CountingStructuredExecutor({ normalized: '第一版' });
  const runner = createRunner(ledger, executor);
  const base = {
    effectIdempotencyKey: 'wf:workflow-2:s1:intent:0',
    schemaName: 'intent_naming_v1',
    schemaRevision: 'intent-naming-v1',
    instructions: 'Return the normalized intent.',
    schema: z.object({ normalized: z.string() }).strict(),
  };

  await runner.run({ ...base, prompt: '{"intent":"第一版"}' });
  await assert.rejects(
    runner.run({ ...base, prompt: '{"intent":"不同载荷"}' }),
    /Idempotency key conflicts with a different payload/u,
  );
  assert.equal(executor.calls, 1);
  assert.equal(ledger.settlements, 1);
});

test('structured runner keeps both the primary and policy retry cost-only', async () => {
  const ledger = new CountingLedger();
  const executor = new CountingStructuredExecutor({ normalized: '安全版本' });
  const runner = createRunner(ledger, executor);
  const base = {
    schemaName: 'copy_candidate_v1',
    schemaRevision: 'copy-candidate-v1',
    instructions: 'Return grounded copy.',
    schema: z.object({ normalized: z.string() }).strict(),
  };

  await runner.run({
    ...base,
    effectIdempotencyKey: 'wf:workflow-3:s4:copy:c01',
    prompt: '{"attempt":"primary"}',
  });
  await runner.run({
    ...base,
    effectIdempotencyKey: 'wf:workflow-3:s4:copy:c01-retry',
    prompt: '{"attempt":"policy-retry"}',
  });

  assert.equal(executor.calls, 2);
  assert.deepEqual(
    ledger.submissions.map(
      (submission) => submission.productUsageQuantity,
    ),
    [0, 0],
  );
});

test('structured runner fences every auto provider attempt before fallback', async () => {
  let revoked = false;
  let fenceCalls = 0;
  const executor = new FallbackStructuredExecutor(() => {
    revoked = true;
  });
  const runner = createAutoRunner(new CountingLedger(), executor);

  await assert.rejects(
    runner.run({
      effectIdempotencyKey: 'wf:workflow-auto-fence:s3:brief:0',
      schemaName: 'copy_brief_v1',
      schemaRevision: 'copy-brief-v1',
      instructions: 'Return a Copy Brief.',
      prompt: '{"intent":"改写旧内容"}',
      schema: z.object({ normalized: z.string() }).strict(),
      beforeProviderAttempt: async () => {
        fenceCalls += 1;
        if (revoked) throw rejectedBeforeAcceptance('source package was revoked');
      },
    }),
    StructuredNodeRunError,
  );

  assert.equal(fenceCalls, 2);
  assert.equal(executor.calls, 1);
});

test('one shared attempt budget blocks route fallback before a second provider effect', async () => {
  const executor = new FallbackStructuredExecutor(() => undefined);
  const budget = new ExecutionAttemptBudget({
    maxAttempts: 1,
    consumedAttempts: 0,
  });
  const runner = withExecutionAttemptBudget(
    createAutoRunner(new CountingLedger(), executor),
    budget,
  );

  await assert.rejects(
    runner.run({
      effectIdempotencyKey: 'wf:workflow-budgeted-fallback:s3:brief:0',
      schemaName: 'copy_brief_v1',
      schemaRevision: 'copy-brief-v1',
      instructions: 'Return a Copy Brief.',
      prompt: '{"intent":"改写旧内容"}',
      schema: z.object({ normalized: z.string() }).strict(),
    }),
    ExecutionAttemptBudgetExceeded,
  );

  assert.equal(executor.calls, 1);
  assert.equal(budget.consumedAttempts, 1);
});

test('provider 5xx consumes one shared physical attempt across SDK and route layers', async () => {
  let providerCalls = 0;
  const executor = new AiSdkStructuredObjectExecutor({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-primary',
    fetch: (async () => {
      providerCalls += 1;
      return new Response(
        JSON.stringify({
          error: {
            message: 'temporary upstream failure',
            type: 'server_error',
          },
        }),
        {
          status: 503,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });
  const budget = new ExecutionAttemptBudget({
    maxAttempts: 1,
    consumedAttempts: 0,
  });
  const runner = withExecutionAttemptBudget(
    createAutoRunner(new CountingLedger(), executor),
    budget,
  );

  await assert.rejects(
    runner.run({
      effectIdempotencyKey: 'wf:workflow-budgeted-5xx:s3:brief:0',
      schemaName: 'copy_brief_v1',
      schemaRevision: 'copy-brief-v1',
      instructions: 'Return a Copy Brief.',
      prompt: '{"intent":"介绍日常护理"}',
      schema: z.object({ normalized: z.string() }).strict(),
    }),
    StructuredNodeRunError,
  );

  assert.equal(providerCalls, 1);
  assert.equal(budget.consumedAttempts, 1);
});

function createRunner(
  ledger: ModelSupplyLedgerPort,
  executor: StructuredObjectExecutor,
  withProductBilling = true,
) {
  return createRunnerWithApplication(
    createStructuredApplication(ledger),
    executor,
    withProductBilling,
  );
}

function createStructuredApplication(ledger: ModelSupplyLedgerPort) {
  return new ModelSupplyApplicationService({
    models: [
      {
        id: 'llm-harness',
        modality: 'llm',
        operations: ['text.respond'],
        displayName: 'Harness LLM',
        qualityRank: 100,
      },
    ],
    deployments: [
      {
        id: 'deployment-harness',
        catalogModelId: 'llm-harness',
        apiFamily: 'openai',
        channel: 'direct',
        region: 'domestic',
        status: 'active',
      },
    ],
    execution: new RecordedProviderExecutionPort(),
    ledger,
  });
}

function createRunnerWithApplication(
  application: ModelSupplyApplicationService,
  executor: StructuredObjectExecutor,
  withProductBilling = true,
) {
  return new ModelSupplyStructuredNodeRunner({
    application,
    executor,
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    selection: { mode: 'fixed', catalogModelId: 'llm-harness' },
    ...(withProductBilling
      ? {
          billingTaskId: 'task-1',
          billingQuoteRevision: 'quote-r1',
        }
      : {}),
  });
}

class MeasuredStructuredExecutor implements StructuredObjectExecutor {
  supportsCatalogModel() {
    return true;
  }

  async generate<Output>(input: { schema: z.ZodType<Output> }) {
    return {
      output: input.schema.parse({ normalized: '介绍日常护理' }),
      providerTaskRef: 'provider-measured-1',
      usage: { inputTokens: 16, outputTokens: 26 },
      measurement: {
        firstPassSchemaValid: false,
        repairCount: 1,
        repairReasons: ['schema_validation'],
        providerAttempts: 2,
      },
    };
  }

  providerCost(usage: { inputTokens: number; outputTokens: number }) {
    return { amount: 0.000068, currency: 'CNY' as const, usage };
  }
}

function createAutoRunner(
  ledger: ModelSupplyLedgerPort,
  executor: StructuredObjectExecutor,
  withProductBilling = true,
) {
  const application = new ModelSupplyApplicationService({
    models: [
      {
        id: 'llm-primary',
        modality: 'llm',
        operations: ['text.respond'],
        displayName: 'Primary Harness LLM',
        qualityRank: 100,
      },
      {
        id: 'llm-fallback',
        modality: 'llm',
        operations: ['text.respond'],
        displayName: 'Fallback Harness LLM',
        qualityRank: 90,
      },
    ],
    deployments: [
      {
        id: 'deployment-primary',
        catalogModelId: 'llm-primary',
        apiFamily: 'openai',
        channel: 'direct',
        region: 'domestic',
        status: 'active',
      },
      {
        id: 'deployment-fallback',
        catalogModelId: 'llm-fallback',
        apiFamily: 'openai',
        channel: 'direct',
        region: 'domestic',
        status: 'active',
      },
    ],
    execution: new RecordedProviderExecutionPort(),
    ledger,
  });
  return new ModelSupplyStructuredNodeRunner({
    application,
    executor,
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    selection: { mode: 'auto', profile: 'quality' },
    ...(withProductBilling
      ? {
          billingTaskId: 'task-1',
          billingQuoteRevision: 'quote-r1',
        }
      : {}),
  });
}

class CountingStructuredExecutor implements StructuredObjectExecutor {
  calls = 0;

  constructor(private readonly output: unknown) {}

  supportsCatalogModel(catalogModelId: string) {
    return catalogModelId === 'llm-harness';
  }

  async generate<Output>(input: {
    schema: z.ZodType<Output>;
  }) {
    this.calls += 1;
    return {
      output: input.schema.parse(this.output),
      providerTaskRef: 'provider-structured-1',
      usage: { inputTokens: 8, outputTokens: 13 },
    };
  }

  providerCost(usage: { inputTokens: number; outputTokens: number }) {
    return { amount: 0.000034, currency: 'CNY' as const, usage };
  }
}

class FallbackStructuredExecutor implements StructuredObjectExecutor {
  calls = 0;

  constructor(private readonly afterFirstProviderAttempt: () => void) {}

  supportsCatalogModel() {
    return true;
  }

  async generate<Output>(input: { schema: z.ZodType<Output> }) {
    this.calls += 1;
    if (this.calls === 1) {
      this.afterFirstProviderAttempt();
      throw rejectedBeforeAcceptance('provider rejected before acceptance');
    }
    return {
      output: input.schema.parse({ normalized: 'fallback output' }),
      providerTaskRef: 'provider-structured-fallback',
      usage: { inputTokens: 8, outputTokens: 13 },
    };
  }

  providerCost(usage: { inputTokens: number; outputTokens: number }) {
    return { amount: 0.000034, currency: 'CNY' as const, usage };
  }
}

class RouteTrackingFallbackStructuredExecutor
  implements StructuredObjectExecutor
{
  readonly invokedCatalogModels: string[] = [];
  private catalogModelId = '';

  supportsCatalogModel(catalogModelId: string) {
    this.catalogModelId = catalogModelId;
    return true;
  }

  async generate<Output>(input: { schema: z.ZodType<Output> }) {
    this.invokedCatalogModels.push(this.catalogModelId);
    if (this.invokedCatalogModels.length === 1) {
      throw rejectedBeforeAcceptance('provider rejected before acceptance');
    }
    return {
      output: input.schema.parse({ normalized: 'fallback output' }),
      providerTaskRef: 'provider-structured-fallback',
      usage: { inputTokens: 8, outputTokens: 13 },
    };
  }

  providerCost(usage: { inputTokens: number; outputTokens: number }) {
    return { amount: 0.000034, currency: 'CNY' as const, usage };
  }
}

type DurableStructuredRequest = Parameters<StructuredNodeRunner['run']>[0];

function createDurableStructuredSuspension(effectIdempotencyKey: string) {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-1', 'user-1');
  const foundation = new P1ApplicationService(repository);
  const ledger = new FoundationModelSupplyLedger(foundation);
  let calls = 0;
  const executor = new AiSdkStructuredObjectExecutor({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-harness',
    fetch: (async () => {
      calls += 1;
      return openAiStructuredResponse(`chatcmpl-durable-${calls}`, {
        normalized: 'missing taskType',
      });
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });
  const request: DurableStructuredRequest = {
    effectIdempotencyKey,
    schemaName: 'intent_naming_v1',
    schemaRevision: 'intent-naming-v1',
    instructions: 'Return the normalized intent.',
    prompt: '{"intent":"验证 durable request"}',
    schema: z
      .object({ normalized: z.string(), taskType: z.string() })
      .strict(),
  };
  return {
    ledger,
    providerCalls: () => calls,
    request,
    runner: () => createRunner(ledger, executor, false),
  };
}

class IgnoringFenceStructuredExecutor implements StructuredObjectExecutor {
  calls = 0;

  supportsCatalogModel() {
    return true;
  }

  async generate<Output>(input: { schema: z.ZodType<Output> }) {
    this.calls += 1;
    return {
      output: input.schema.parse({
        normalized: 'must stay fenced',
        taskType: 'copy',
      }),
      providerTaskRef: 'provider-ignoring-fence',
      usage: { inputTokens: 8, outputTokens: 13 },
    };
  }

  providerCost(usage: { inputTokens: number; outputTokens: number }) {
    return { amount: 0.000034, currency: 'CNY' as const, usage };
  }
}

function openAiStructuredResponse(id: string, output: unknown) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          index: 0,
          message: {
            content: JSON.stringify(output),
            role: 'assistant',
          },
        },
      ],
      created: 1,
      id,
      model: 'provider-model',
      object: 'chat.completion',
      usage: {
        completion_tokens: 13,
        prompt_tokens: 8,
        total_tokens: 21,
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

function rejectedBeforeAcceptance(message: string) {
  return Object.assign(new Error(message), {
    acceptance: 'rejected_before_accept' as const,
  });
}

class CountingLedger implements ModelSupplyLedgerPort {
  checkpoints = 0;
  settlements = 0;
  submissions: ModelSupplyLedgerCheckpointInput['submission'][] = [];

  async checkpointAttempt(input: ModelSupplyLedgerCheckpointInput) {
    this.checkpoints += 1;
    this.submissions.push(structuredClone(input.submission));
    return { replayed: false };
  }

  async settleAttempt(_input: {
    result: ModelSupplyResult;
  }) {
    this.settlements += 1;
  }
}

function openAiStreamResponse(contentChunks: string[]) {
  const chunks: Array<Record<string, unknown>> = contentChunks.map(
    (content, index) => ({
      choices: [
        {
          delta: { content, ...(index === 0 ? { role: 'assistant' } : {}) },
          finish_reason: null,
          index: 0,
        },
      ],
      created: 1,
      id: 'chatcmpl-harness-stream',
      model: 'provider-model',
      object: 'chat.completion.chunk',
    }),
  );
  chunks.push({
    choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
    created: 1,
    id: 'chatcmpl-harness-stream',
    model: 'provider-model',
    object: 'chat.completion.chunk',
    usage: { completion_tokens: 13, prompt_tokens: 8, total_tokens: 21 },
  });
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
