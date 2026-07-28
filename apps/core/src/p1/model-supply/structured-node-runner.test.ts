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
  type StructuredObjectExecutor,
} from './structured-node-runner.js';

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

function createRunner(
  ledger: ModelSupplyLedgerPort,
  executor: StructuredObjectExecutor,
  withProductBilling = true,
) {
  const application = new ModelSupplyApplicationService({
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

function createAutoRunner(
  ledger: ModelSupplyLedgerPort,
  executor: StructuredObjectExecutor,
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
    billingTaskId: 'task-1',
    billingQuoteRevision: 'quote-r1',
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
