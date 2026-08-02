import assert from 'node:assert/strict';
import test from 'node:test';
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import { z } from 'zod';
import { flushLangfuseTracing } from '../../instrumentation.js';
import {
  FixtureAiStreamingRunner,
  FixtureAiStructuredObjectExecutor,
  OpenAiCompatibleAiSdkRunner,
  fixtureStructuredFirstChunkHoldMs,
  languageModelCallSettings,
  resolveOpenAiCompatibleProviderName,
} from './ai-sdk-runner.js';
import { executionBriefSchema } from '../harness/structured-nodes.js';
import { notePlanSchema } from '@meiye/contracts';

test('fixture structured chunk pacing accepts bounded E2E-only overrides', () => {
  assert.equal(
    fixtureStructuredFirstChunkHoldMs({
      APP_ENV: 'e2e',
      E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS: '10000',
    }),
    10_000,
  );
  assert.equal(
    fixtureStructuredFirstChunkHoldMs({
      APP_ENV: 'production',
      E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS: '10000',
    }),
    40,
  );
  assert.equal(
    fixtureStructuredFirstChunkHoldMs({
      APP_ENV: 'e2e',
      E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS: 'not-a-number',
    }),
    40,
  );
  assert.equal(
    fixtureStructuredFirstChunkHoldMs({
      APP_ENV: 'e2e',
      E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS: '10001',
    }),
    40,
  );
});

test('fixture structured execution compiles the frozen video delivery into one storyboard', async () => {
  const executor = new FixtureAiStructuredObjectExecutor();
  const schema = z.object({
    kind: z.literal('video'),
    storyboard: z
      .array(
        z.object({
          index: z.number().int().positive(),
          description: z.string().min(1),
          narration: z.string().optional(),
          durationSeconds: z.number().positive(),
        }),
      )
      .length(1),
    firstFramePrompt: z.string().min(20),
    referenceAssetIds: z.array(z.string()),
    parameters: z.object({
      durationSeconds: z.number().positive(),
      ratio: z.string().min(1),
    }),
    constraints: z.array(z.string()),
  });

  const result = await executor.generate({
    instructions: 'Compile one complete video execution brief.',
    prompt: JSON.stringify({
      declaration: { normalizedIntent: '把护理案例做成抖音项目成片' },
      executionContract: {
        deliverables: [
          {
            aspectRatio: '9:16',
            durationSeconds: 15,
            kind: 'video',
          },
        ],
        sources: { assets: [{ id: 'asset-video-reference-1' }] },
      },
    }),
    schema,
    schemaName: 'harness_video_brief_v1',
  });

  assert.equal(result.output.storyboard[0]?.durationSeconds, 15);
  assert.deepEqual(result.output.referenceAssetIds, [
    'asset-video-reference-1',
  ]);
  assert.deepEqual(result.output.parameters, {
    durationSeconds: 15,
    ratio: '9:16',
  });
});

test('fixture fact satisfaction matches every authorized fact beyond the requested floor', async () => {
  const executor = new FixtureAiStructuredObjectExecutor();
  const result = await executor.generate({
    instructions: 'Assess the requested fact kinds.',
    prompt: JSON.stringify({
      factTypes: ['price', 'discount'],
      facts: [
        { kind: 'service', sourceRef: 'store_fact:service:1' },
        { kind: 'price', sourceRef: 'store_fact:price:1' },
      ],
    }),
    schema: z.object({
      matchedFactRefs: z.array(z.string()),
      missingFactTypes: z.array(z.string()),
      status: z.enum(['satisfied', 'partial', 'unsatisfied']),
    }),
    schemaName: 'harness_fact_satisfaction_v1',
  });

  // factTypes is the recipe's requirement floor, not an authorization
  // ceiling: the already-authorized service fact stays matched while
  // missing/status still track the requested kinds.
  assert.deepEqual(result.output, {
    matchedFactRefs: ['store_fact:service:1', 'store_fact:price:1'],
    missingFactTypes: ['discount'],
    status: 'partial',
  });
});

test('fixture fact criticality only blocks promotional facts when the intent claims them', async () => {
  const executor = new FixtureAiStructuredObjectExecutor();
  const generate = (intent: string) =>
    executor.generate({
      instructions: 'Classify whether missing facts block truthful execution.',
      prompt: JSON.stringify({
        intent,
        missingFactTypes: ['discount', 'fulfillment'],
      }),
      schema: z.object({
        criticality: z.enum(['critical', 'optional']),
      }),
      schemaName: 'harness_fact_criticality_v1',
    });

  const ordinaryPoster = await generate('生成一张门店夏日护理海报');
  const promotionalPoster = await generate('生成一张门店夏日护理优惠海报');

  assert.equal(ordinaryPoster.output.criticality, 'optional');
  assert.equal(promotionalPoster.output.criticality, 'critical');
});

test('fixture NotePlan varies page composition with merchant semantics', async () => {
  const executor = new FixtureAiStructuredObjectExecutor();
  const generate = (intent: string) =>
    executor.generate({
      instructions: 'Compile a semantic NotePlan.',
      prompt: JSON.stringify({ intent, factRefs: [], rightsRefs: [] }),
      schema: notePlanSchema,
      schemaName: 'harness_note_plan_v1',
    });

  const service = await generate('介绍本店护理项目');
  const promotion = await generate('介绍本店 398 元夏日护理团购活动');

  assert.deepEqual(
    service.output.pages.map(({ pageRole }) => pageRole),
    ['cover', 'solution_show', 'cta_guide'],
  );
  assert.deepEqual(
    promotion.output.pages.map(({ pageRole }) => pageRole),
    ['cover', 'pain_scene', 'solution_show', 'price_offer', 'cta_guide'],
  );
  assert.deepEqual(
    promotion.output.pages[3]?.textBlock.exactText,
    ['398 元'],
  );
});

test('formal non-streaming copy generation uses one structured object request', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const generated = {
    candidates: [
      {
        body: 'First grounded body.',
        conversionHook: 'Ask first',
        title: 'First angle',
      },
    ],
  };
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-fixed',
    fetch: (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              message: {
                content: JSON.stringify(generated),
                role: 'assistant',
              },
            },
          ],
          created: 1,
          id: 'chatcmpl-structured',
          model: 'provider-model',
          object: 'chat.completion',
          usage: {
            completion_tokens: 34,
            prompt_tokens: 12,
            total_tokens: 46,
          },
        }),
        { headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });

  const result = await runner.generateCopy(
    'Write one honest primary option.',
    undefined,
    1,
    'frozen:copy-generation',
    {
      actorId: 'fixture-actor-272',
      modality: 'llm',
      operation: 'copy.generate',
      taskId: 'fixture-task-272',
      workspaceId: 'fixture-workspace-272',
    },
  );

  assert.equal(requests.length, 1);
  assert.deepEqual(result.candidates, generated.candidates);
  assert.equal(result.providerTaskRef, 'chatcmpl-structured');
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 34 });
  const responseFormat = requests[0]?.response_format as {
    json_schema?: { name?: string; schema?: unknown; strict?: boolean };
    type?: string;
  };
  assert.equal(responseFormat.type, 'json_schema');
  assert.equal(responseFormat.json_schema?.name, 'beauty_copy_candidates');
  assert.equal(responseFormat.json_schema?.strict, true);
  assert.ok(responseFormat.json_schema?.schema);
  assert.equal(
    (requests[0]?.messages as Array<{ content?: string }>)[0]?.content,
    'frozen:copy-generation',
  );
  await flushLangfuseTracing();
});

test('provider 5xx is attempted once because SDK retry is disabled', async () => {
  let requests = 0;
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-fixed',
    fetch: (async () => {
      requests += 1;
      return new Response('upstream unavailable', { status: 503 });
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('Write one honest primary option.'));
  assert.equal(requests, 1);
});

test('unknown provider errors are attempted once and are not retried', async () => {
  let requests = 0;
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-fixed',
    fetch: (async () => {
      requests += 1;
      throw new Error('unknown provider failure');
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('Write one honest primary option.'));
  assert.equal(requests, 1);
});

test('thinking providerOptions key under the resolved provider name, not a hard-coded deepseek key', () => {
  assert.equal(
    resolveOpenAiCompatibleProviderName({
      catalogModelId: 'deepseek-v4-pro',
    }),
    'deepseek',
  );
  assert.equal(
    resolveOpenAiCompatibleProviderName({
      catalogModelId: 'seed-1-6-250615',
    }),
    'meiye-direct',
  );

  const deepseekSettings = languageModelCallSettings({
    apiKey: 'k',
    baseUrl: 'https://api.deepseek.com',
    catalogModelId: 'deepseek-v4-pro',
    inputCostPerMillion: 1,
    model: 'deepseek-v4-pro',
    outputCostPerMillion: 2,
    reasoningEffort: 'high',
    thinking: { type: 'enabled' },
  });
  assert.deepEqual(deepseekSettings.providerOptions, {
    deepseek: {
      reasoningEffort: 'high',
      thinking: { type: 'enabled' },
    },
  });

  // Non-deepseek providers skip thinking injection so generation is not blocked;
  // route-profile selection still applies upstream.
  const directSettings = languageModelCallSettings({
    apiKey: 'k',
    baseUrl: 'https://example.test/v1',
    catalogModelId: 'seed-1-6-250615',
    inputCostPerMillion: 1,
    model: 'seed-1-6-250615',
    outputCostPerMillion: 2,
    reasoningEffort: 'high',
    thinking: { type: 'enabled' },
  });
  assert.equal(directSettings.providerOptions, undefined);
});

test('DeepSeek V4 sends the mirrored thinking and long-output parameters', async () => {
  let requestUrl = '';
  let requestBody: Record<string, unknown> = {};
  const generated = {
    candidates: [
      { body: 'First body.', conversionHook: 'Ask first', title: 'First' },
    ],
  };
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiKey: 'deepseek-test-key',
    baseUrl: 'https://api.deepseek.com',
    catalogModelId: 'deepseek-v4-pro',
    fetch: (async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{
            finish_reason: 'stop',
            index: 0,
            message: {
              content: JSON.stringify(generated),
              role: 'assistant',
            },
          }],
          created: 1,
          id: 'deepseek-completion-1',
          model: 'deepseek-v4-pro',
          object: 'chat.completion',
          usage: {
            completion_tokens: 34,
            prompt_tokens: 12,
            total_tokens: 46,
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
    inputCostPerMillion: 1,
    maxOutputTokens: 384_000,
    model: 'deepseek-v4-pro',
    outputCostPerMillion: 2,
    reasoningEffort: 'high',
    thinking: { type: 'enabled' },
  });

  await runner.generateCopy('Write one honest primary option.');

  assert.equal(requestUrl, 'https://api.deepseek.com/chat/completions');
  assert.equal(requestBody.model, 'deepseek-v4-pro');
  assert.equal(requestBody.max_tokens, 384_000);
  assert.equal(requestBody.reasoning_effort, 'high');
  assert.deepEqual(requestBody.thinking, { type: 'enabled' });
});

test('DeepSeek json_object requests always mention json in their messages', async () => {
  const capturedBodies: Array<Record<string, unknown>> = [];
  const deepSeekRunner = (fetchImpl: typeof fetch, catalogModelId = 'deepseek-v4-pro') =>
    new OpenAiCompatibleAiSdkRunner({
      apiKey: 'deepseek-test-key',
      baseUrl: 'https://api.deepseek.com',
      catalogModelId,
      fetch: fetchImpl,
      inputCostPerMillion: 1,
      maxOutputTokens: 384_000,
      model: catalogModelId,
      outputCostPerMillion: 2,
    });
  const capture = (async (_input, init) => {
    capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    throw new Error('captured: no network');
  }) as typeof fetch;

  // DeepSeek returns HTTP 400 for response_format json_object unless some
  // message mentions "json"; the runner must append the directive itself.
  await assert.rejects(
    deepSeekRunner(capture).generateCopy(
      '基于门店已确认事实写三条合规文案。',
      undefined,
      3,
      'Return exactly 3 materially distinct candidates.',
    ),
  );
  const messagesText = JSON.stringify(capturedBodies[0]?.messages);
  assert.match(messagesText, /json/iu);
  assert.match(messagesText, /Return exactly 3 materially distinct candidates\./u);

  // Instructions that already satisfy the contract are sent untouched.
  await assert.rejects(
    deepSeekRunner(capture).generateCopy(
      '基于门店已确认事实写三条合规文案。',
      undefined,
      3,
      'Return a JSON object with exactly 3 candidates.',
    ),
  );
  const untouched = JSON.stringify(capturedBodies[1]?.messages);
  assert.match(untouched, /Return a JSON object with exactly 3 candidates\./u);
  assert.doesNotMatch(untouched, /Respond with a single valid JSON object\./u);
});

test('formal platform adaptation returns all three distinct variants in one request', async () => {
  let requestCount = 0;
  let requestBody: Record<string, unknown> = {};
  const platformVariants = {
    xiaohongshu: {
      body: '小红书种草正文',
      conversionHook: '收藏后预约',
      title: '小红书标题',
      topics: ['同城美业'],
    },
    douyin: {
      body: '抖音口播节奏正文',
      conversionHook: '评论预约',
      title: '抖音标题',
      topics: ['同城探店'],
    },
    video_account: {
      body: '视频号熟客分享正文',
      conversionHook: '转发给朋友',
      title: '视频号标题',
      topics: ['熟客推荐'],
    },
  };
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-fixed',
    fetch: (async (_input, init) => {
      requestCount += 1;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              message: {
                content: JSON.stringify(platformVariants),
                role: 'assistant',
              },
            },
          ],
          created: 1,
          id: 'chatcmpl-platform-variants',
          model: 'provider-model',
          object: 'chat.completion',
          usage: {
            completion_tokens: 40,
            prompt_tokens: 15,
            total_tokens: 55,
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });

  const result = await runner.adaptPlatformVariants(
    '改写为三平台版本',
    undefined,
    'frozen:platform-adaptation',
  );

  assert.equal(requestCount, 1);
  assert.deepEqual(result.platformVariants, platformVariants);
  assert.equal(result.providerTaskRef, 'chatcmpl-platform-variants');
  assert.equal(
    (requestBody.messages as Array<{ content?: string }>)[0]?.content,
    'frozen:platform-adaptation',
  );
});

test('formal text response consumes its frozen prompt instruction', async () => {
  let requestBody: Record<string, unknown> = {};
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-fixed',
    fetch: (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              message: { content: 'visible text', role: 'assistant' },
            },
          ],
          created: 1,
          id: 'chatcmpl-text-response',
          model: 'provider-model',
          object: 'chat.completion',
          usage: {
            completion_tokens: 2,
            prompt_tokens: 3,
            total_tokens: 5,
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });

  const result = await runner.respondText(
    'Read the image.',
    [],
    undefined,
    'frozen:text-response',
  );

  assert.equal(result.text, 'visible text');
  assert.equal(
    (requestBody.messages as Array<{ content?: string }>)[0]?.content,
    'frozen:text-response',
  );
});

test('fixture copy brief derives exactly the fact references present in its prompt', async () => {
  const executor = new FixtureAiStructuredObjectExecutor();
  const generate = (
    storeFacts: Record<string, unknown>,
    normalizedIntent = '介绍本店护理项目',
    authorizedFactRefs?: string[],
  ) =>
    executor.generate({
      instructions: 'Compile one grounded copy brief.',
      prompt: JSON.stringify({
        bundle: {
          dimensions: {
            store_facts_assets: storeFacts,
          },
        },
        declaration: { normalizedIntent },
        ...(authorizedFactRefs
          ? {
              factReferencePolicy: {
                authorizedFactRefs,
              },
            }
          : {}),
      }),
      schema: executionBriefSchema,
      schemaName: 'harness_copy_brief_v1',
    });

  const empty = await generate({});
  if (empty.output.kind !== 'copy') throw new Error('Expected a copy brief.');
  assert.deepEqual(empty.output.factRefs, []);

  const grounded = await generate({
    'offer.price': {
      sourceRef: 'store_fact:price-1:2',
      value: { amount: 299, currency: 'CNY' },
    },
    'service.name': {
      sourceRef: 'store_fact:service-1:4',
      value: '透亮猫眼',
    },
    instruction_source_1: {
      sourceRef: 'task:workflow-1:source:1',
      value: '商家临时补充',
    },
  });
  if (grounded.output.kind !== 'copy') {
    throw new Error('Expected a copy brief.');
  }
  assert.deepEqual(
    new Set(grounded.output.factRefs),
    new Set(['store_fact:price-1:2', 'store_fact:service-1:4']),
  );
  assert.equal(grounded.output.factRefs.length, 2);

  const satisfactionBound = await generate(
    {
      'offer.price': {
        sourceRef: 'store_fact:price-1:2',
        value: { amount: 299, currency: 'CNY' },
      },
      'service.name': {
        sourceRef: 'store_fact:service-1:4',
        value: '透亮猫眼',
      },
    },
    '介绍本店护理项目',
    ['store_fact:service-1:4'],
  );
  if (satisfactionBound.output.kind !== 'copy') {
    throw new Error('Expected a copy brief.');
  }
  assert.deepEqual(satisfactionBound.output.factRefs, [
    'store_fact:service-1:4',
  ]);

  const lineageMarker = 'M04LINEAGE_A_12345678';
  const marked = await generate({}, `介绍护理项目 ${lineageMarker}`);
  if (marked.output.kind !== 'copy') throw new Error('Expected a copy brief.');
  assert.match(marked.output.instructions, new RegExp(lineageMarker, 'u'));
});

test('fixture copy candidate streams a trace of the frozen merchant intent', async () => {
  const executor = new FixtureAiStructuredObjectExecutor();
  const partials: unknown[] = [];
  const lineageMarker = 'M04LINEAGE_B_12345678';
  const generated = await executor.generate({
    instructions: 'Generate one grounded copy candidate.',
    onPartialOutput: (partial) => {
      partials.push(structuredClone(partial));
    },
    prompt: JSON.stringify({
      brief: {
        instructions: `介绍护理项目 ${lineageMarker}`,
      },
      candidateId: 'c01',
    }),
    schema: z
      .object({
        assetRefs: z.array(z.string()),
        body: z.string(),
        conversionHook: z.string(),
        factClaims: z.array(z.unknown()),
        title: z.string(),
      })
      .strict(),
    schemaName: 'harness_copy_candidate_v1',
  });

  assert.match(generated.output.title, new RegExp(lineageMarker, 'u'));
  assert.ok(
    partials.some((partial) =>
      JSON.stringify(partial).includes(lineageMarker),
    ),
  );
});

test('fixture copy candidate honors the production full-body text selection contract', async () => {
  const executor = new FixtureAiStructuredObjectExecutor();
  const generated = await executor.generate({
    instructions: 'Generate one grounded copy candidate.',
    prompt: JSON.stringify({
      brief: {
        constraints: [
          `result_text_selection_v1:${JSON.stringify({
            end: 9,
            sourceBody: '夏日护理，预约到店。',
            start: 5,
          })}`,
        ],
        instructions: '只调整已选中文字。',
      },
      candidateId: 'c01',
    }),
    schema: z
      .object({
        assetRefs: z.array(z.string()),
        body: z.string(),
        conversionHook: z.string(),
        factClaims: z.array(z.unknown()),
        title: z.string(),
      })
      .strict(),
    schemaName: 'harness_copy_candidate_v1',
  });

  assert.equal(generated.output.body, '夏日护理，优化后的预约到店。');
});

test('fixture failure drill rejects before provider acceptance from a cold fallback copy brief', async () => {
  const executor = new FixtureAiStructuredObjectExecutor();
  await assert.rejects(
    executor.generate({
      instructions: 'Generate one grounded copy candidate.',
      prompt: JSON.stringify({
        brief: {
          instructions: '围绕「写一条皮肤护理到店体验文案（失败档）」写一条可以直接审核的门店内容。',
          constraints: ['不得编造价格、效果或顾客案例'],
        },
        candidateId: 'c01',
      }),
      schema: z
        .object({
          assetRefs: z.array(z.string()),
          body: z.string(),
          conversionHook: z.string(),
          factClaims: z.array(z.unknown()),
          title: z.string(),
        })
        .strict(),
      schemaName: 'harness_copy_candidate_v1',
    }),
    (error: unknown) =>
      error instanceof Error &&
      'acceptance' in error &&
      error.acceptance === 'rejected_before_accept',
  );
});

test('fixture memory sedimentation extracts only an explicit future preference from the merchant message', async () => {
  const executor = new FixtureAiStructuredObjectExecutor();
  const schema = z
    .object({
      items: z.array(
        z
          .object({
            itemId: z.string(),
            decision: z.unknown(),
            candidate: z.unknown(),
          })
          .strict(),
      ),
    })
    .strict();
  const generate = (merchantText: string) =>
    executor.generate({
      instructions: 'Extract durable merchant preferences.',
      prompt: JSON.stringify({
        messages: [
          { index: 0, role: 'merchant', text: merchantText },
          { index: 1, role: 'assistant', text: '生成结果' },
        ],
      }),
      schema,
      schemaName: 'memory_sedimentation_candidates_v1',
    });

  const ordinary = await generate('写一条周末皮肤护理到店预约文案');
  assert.deepEqual(ordinary.output.items, []);

  const durable = await generate(
    '以后每次文案都保持克制、像熟客分享，请长期记住',
  );
  assert.deepEqual(durable.output.items, [
    {
      itemId: 'merchant-preference-1',
      decision: {
        state: 'allow',
        reason: 'explicit_future_preference',
      },
      candidate: {
        semanticKey: 'style.copy.long_term',
        proposedValue: '以后每次文案都保持克制、像熟客分享，请长期记住',
        messageRange: { start: 0, end: 0 },
      },
    },
  ]);
});

test('fixture image edit brief derives work-case fact references from its prompt', async () => {
  const executor = new FixtureAiStructuredObjectExecutor();
  const generated = await executor.generate({
    instructions: 'Compile one grounded image edit brief.',
    prompt: JSON.stringify({
      bundle: {
        dimensions: {
          store_facts_assets: {
            work_case_1: {
              sourceRef: 'store_fact:work-case-1:3',
              value: '已确认案例',
            },
          },
        },
      },
      declaration: {
        normalizedIntent: '调整这张案例图的版式',
      },
      executionContract: {
        operation: 'image.edit',
        sources: {
          assets: [{ id: 'asset-1', revision: 2 }],
        },
      },
    }),
    schema: executionBriefSchema,
    schemaName: 'harness_image_brief_v1',
  });

  if (generated.output.kind !== 'image') {
    throw new Error('Expected an image brief.');
  }
  assert.deepEqual(generated.output.intent.factRefs, [
    'store_fact:work-case-1:3',
  ]);
  assert.deepEqual(generated.output.intent.references[0]?.factRefs, [
    'store_fact:work-case-1:3',
  ]);
});

test('fixture assistant emits safe tool and data parts through an AI SDK UI message stream', async () => {
  const runner = new FixtureAiStreamingRunner();
  const response = runner.streamAssistant({
    catalogModelId: 'llm-openai',
    context: {
      workId: 'work-private-id',
      intent: 'Write grounded appointment copy.',
      sourceSummaries: ['asset:private-source-id'],
    },
    messages: [{ role: 'user', content: 'Help refine the angle.' }],
  });

  const chunks = await readChunks(response);
  const payload = chunks.join('');
  const events = parseSseEvents(payload);
  const messages = readUIMessageStream({ stream: chunkStream(events) });
  let completedMessage: UIMessage | undefined;
  for await (const message of messages) completedMessage = message;

  assert.ok(chunks.length >= 2);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(
    response.headers.get('x-meiye-stream-protocol'),
    'ai-sdk-ui-message-v1'
  );
  assert.deepEqual(
    completedMessage?.parts.map((part) => part.type),
    [
      'text',
      'tool-readCurrentContext',
      'data-context',
      'tool-proposeFieldPatch',
      'data-field_patch',
    ]
  );
  const contextToolPart = completedMessage?.parts.find(
    (part) => part.type === 'tool-readCurrentContext'
  );
  assert.ok(contextToolPart && 'state' in contextToolPart);
  assert.equal(contextToolPart.state, 'output-available');
  const patchToolPart = completedMessage?.parts.find(
    (part) => part.type === 'tool-proposeFieldPatch'
  );
  assert.ok(patchToolPart && 'state' in patchToolPart);
  assert.equal(patchToolPart.state, 'output-available');
  assert.match(payload, /"type":"data-field_patch"/u);
  assert.match(payload, /## 建议方向/u);
  assert.match(payload, /核对门店信息/u);
  assert.doesNotMatch(payload, /work-private-id|private-source-id/u);
  assert.match(payload, /data: \[DONE\]/u);
});

test('formal assistant continues after reading current context', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const responses = [
    openAiStreamResponse([
      {
        choices: [
          {
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  function: {
                    arguments: '{}',
                    name: 'readCurrentContext',
                  },
                  id: 'call-read-context',
                  index: 0,
                },
              ],
            },
            finish_reason: null,
            index: 0,
          },
        ],
        created: 1,
        id: 'chatcmpl-context-tool',
        model: 'provider-model',
        object: 'chat.completion.chunk',
      },
      {
        choices: [
          {
            delta: {},
            finish_reason: 'tool_calls',
            index: 0,
          },
        ],
        created: 1,
        id: 'chatcmpl-context-tool',
        model: 'provider-model',
        object: 'chat.completion.chunk',
        usage: {
          completion_tokens: 4,
          prompt_tokens: 8,
          total_tokens: 12,
        },
      },
    ]),
    openAiStreamResponse([
      {
        choices: [
          {
            delta: {
              content: '按当前真实到店场景，我建议先突出可核验的服务细节。',
              role: 'assistant',
            },
            finish_reason: null,
            index: 0,
          },
        ],
        created: 2,
        id: 'chatcmpl-context-answer',
        model: 'provider-model',
        object: 'chat.completion.chunk',
      },
      {
        choices: [
          {
            delta: {},
            finish_reason: 'stop',
            index: 0,
          },
        ],
        created: 2,
        id: 'chatcmpl-context-answer',
        model: 'provider-model',
        object: 'chat.completion.chunk',
        usage: {
          completion_tokens: 10,
          prompt_tokens: 20,
          total_tokens: 30,
        },
      },
    ]),
  ];
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-fixed',
    fetch: (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const response = responses.shift();
      assert.ok(response, 'unexpected provider request');
      return response;
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });

  const response = runner.streamAssistant({
    catalogModelId: 'llm-fixed',
    context: {
      intent: '突出真实到店服务细节',
      scene: '真实到店',
      sourceSummaries: ['门店环境实拍'],
      workId: 'work-context-loop',
    },
    messages: [{ content: '请结合当前场景给建议。', role: 'user' }],
  });
  const payload = (await readChunks(response)).join('');

  assert.equal(requests.length, 2);
  assert.match(payload, /按当前真实到店场景/u);
  const secondMessages = requests[1]?.messages as Array<{
    content?: string;
    role?: string;
    tool_call_id?: string;
  }>;
  assert.ok(
    secondMessages.some(
      (message) =>
        message.role === 'tool' &&
        message.tool_call_id === 'call-read-context' &&
        message.content?.includes('work-context-loop')
    )
  );
});

async function readChunks(response: Response) {
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return chunks;
}

function parseSseEvents(payload: string) {
  return payload
    .split('\n\n')
    .map((record) => record.trim())
    .filter(
      (record) => record.startsWith('data: ') && record !== 'data: [DONE]'
    )
    .map((record) => JSON.parse(record.slice(6)) as UIMessageChunk);
}

function chunkStream(events: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const event of events) controller.enqueue(event);
      controller.close();
    },
  });
}

function openAiStreamResponse(chunks: Array<Record<string, unknown>>) {
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } }
  );
}

test('native anthropic family routes requests to the /v1/messages endpoint', async () => {
  let calledUrl = '';
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiFamily: 'anthropic',
    apiKey: 'test-key',
    baseUrl: 'https://anthropic.example/v1',
    catalogModelId: 'llm-anthropic',
    fetch: (async (input) => {
      calledUrl = typeof input === 'string' ? input : (input as Request).url;
      throw new Error('probe: request captured');
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'claude-x',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('probe'));
  assert.match(calledUrl, /anthropic\.example\/v1\/messages$/);
});

test('native gemini family routes requests to the generateContent endpoint', async () => {
  let calledUrl = '';
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiFamily: 'gemini',
    apiKey: 'test-key',
    baseUrl: 'https://gemini.example/v1beta',
    catalogModelId: 'llm-gemini',
    fetch: (async (input) => {
      calledUrl = typeof input === 'string' ? input : (input as Request).url;
      throw new Error('probe: request captured');
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'gemini-x',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('probe'));
  assert.match(calledUrl, /gemini\.example\/v1beta\/models\/gemini-x/);
  assert.match(calledUrl, /generateContent/);
});

test('custom openai chat protocol routes requests to the configured chat completions endpoint', async () => {
  let calledUrl = '';
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiFamily: 'custom',
    apiKey: 'test-key',
    baseUrl: 'https://custom.example/v1',
    catalogModelId: 'llm-custom',
    customProtocol: 'openai_chat',
    fetch: (async (input) => {
      calledUrl = typeof input === 'string' ? input : (input as Request).url;
      throw new Error('probe: request captured');
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'custom-model',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('probe'));
  assert.match(calledUrl, /custom\.example\/v1\/chat\/completions$/);
});

test('custom anthropic messages protocol routes requests to the configured messages endpoint', async () => {
  let calledUrl = '';
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiFamily: 'custom',
    apiKey: 'test-key',
    baseUrl: 'https://custom.example/v1',
    catalogModelId: 'llm-custom',
    customProtocol: 'anthropic_messages',
    fetch: (async (input) => {
      calledUrl = typeof input === 'string' ? input : (input as Request).url;
      throw new Error('probe: request captured');
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'custom-model',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('probe'));
  assert.match(calledUrl, /custom\.example\/v1\/messages$/);
});

test('custom gemini protocol routes requests to the configured generateContent endpoint', async () => {
  let calledUrl = '';
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiFamily: 'custom',
    apiKey: 'test-key',
    baseUrl: 'https://custom.example/v1beta',
    catalogModelId: 'llm-custom',
    customProtocol: 'gemini_generate_content',
    fetch: (async (input) => {
      calledUrl = typeof input === 'string' ? input : (input as Request).url;
      throw new Error('probe: request captured');
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'custom-model',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('probe'));
  assert.match(calledUrl, /custom\.example\/v1beta\/models\/custom-model/);
  assert.match(calledUrl, /generateContent/);
});

test('custom API family requires an explicit request protocol', () => {
  assert.throws(
    () =>
      new OpenAiCompatibleAiSdkRunner({
        apiFamily: 'custom',
        apiKey: 'test-key',
        baseUrl: 'https://custom.example/v1',
        catalogModelId: 'llm-custom',
        inputCostPerMillion: 1,
        model: 'custom-model',
        outputCostPerMillion: 2,
      }),
    /customProtocol is required/,
  );
});

test('native API families reject a custom request protocol', () => {
  assert.throws(
    () =>
      new OpenAiCompatibleAiSdkRunner({
        apiFamily: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://openai.example/v1',
        catalogModelId: 'llm-openai',
        customProtocol: 'openai_chat',
        inputCostPerMillion: 1,
        model: 'native-model',
        outputCostPerMillion: 2,
      }),
    /customProtocol is only supported/,
  );
});
