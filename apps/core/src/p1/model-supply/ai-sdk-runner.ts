import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  assistantFieldPatchSchema,
  generatedCopyCandidatesSchema,
  generatedPlatformVariantsSchema,
  type AssistantStreamRequest,
  type GeneratedCopyCandidates,
  type GeneratedPlatformVariants,
} from '@meiye/contracts';
import {
  createTextStreamResponse,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  Output,
  streamText,
  toTextStream,
  toUIMessageStream,
  tool,
} from 'ai';
import { z, type ZodType } from 'zod';
import type { StructuredObjectExecutor } from './index.js';
import type { ResolvedReferenceAsset } from './reference-asset-resolver.js';

const FIXTURE_COPY_CHUNK_INTERVAL_MS = 200;
const FIXTURE_ASSISTANT_CHUNK_INTERVAL_MS = 120;
const FIXTURE_STRUCTURED_CHUNK_INTERVAL_MS = 40;

export type LlmApiFamily = 'openai' | 'anthropic' | 'gemini' | 'custom';

export type CustomLlmProtocol =
  | 'openai_chat'
  | 'anthropic_messages'
  | 'gemini_generate_content';

export interface OpenAiCompatibleAiSdkOptions {
  catalogModelId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  maxOutputTokens?: number;
  reasoningEffort?: 'high' | 'max';
  thinking?: { type: 'enabled' | 'disabled' };
  currency?: 'CNY' | 'USD';
  fetch?: typeof globalThis.fetch;
  /**
   * Native protocol family. Each family binds the model through its official
   * AI SDK provider so the request/response contract matches the maker's API,
   * not an OpenAI-compatible approximation. Defaults to 'openai' for back-compat.
   */
  apiFamily?: LlmApiFamily;
  customProtocol?: CustomLlmProtocol;
}

export interface GeneratedCopyResult extends GeneratedCopyCandidates {
  providerTaskRef: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface GeneratedPlatformVariantsResult {
  platformVariants: GeneratedPlatformVariants;
  providerTaskRef: string;
  usage: GeneratedCopyResult['usage'];
}

export interface CanvasTextStreamResult {
  providerTaskRef: string;
  text: string;
  usage: GeneratedCopyResult['usage'];
}

export interface CanvasTextStream {
  deltas: AsyncIterable<string>;
  result: Promise<CanvasTextStreamResult>;
}

export interface AiStreamingRunner {
  readonly catalogModelId: string;
  supportsCatalogModel(catalogModelId: string): boolean;
  providerCost(usage: GeneratedCopyResult['usage']): {
    amount: number;
    currency: 'CNY' | 'USD';
    usage: GeneratedCopyResult['usage'];
  };
  generateCopy(
    prompt: string,
    abortSignal?: AbortSignal
  ): Promise<GeneratedCopyResult>;
  streamAssistant(
    request: AssistantStreamRequest,
    abortSignal?: AbortSignal
  ): Response;
  startCopyStream(
    request: { catalogModelId: string; prompt: string },
    abortSignal?: AbortSignal
  ): { response: Response; result: Promise<GeneratedCopyResult> };
  startCanvasTextStream?(
    request: {
      catalogModelId: string;
      prompt: string;
      referenceAssets?: ResolvedReferenceAsset[];
    },
    abortSignal?: AbortSignal,
  ): CanvasTextStream;
}

export class OpenAiCompatibleAiSdkRunner implements AiStreamingRunner {
  readonly catalogModelId: string;
  private readonly model;

  constructor(readonly options: OpenAiCompatibleAiSdkOptions) {
    assertOptions(options);
    this.catalogModelId = options.catalogModelId;
    this.model = createNativeLanguageModel(options);
  }

  async generateCopy(prompt: string, abortSignal?: AbortSignal) {
    const result = await generateText({
      abortSignal,
      ...languageModelCallSettings(this.options),
      instructions:
        'Return exactly three materially different beauty-business copy candidates. Every candidate must include a non-empty title, body, and conversionHook.',
      maxRetries: 0,
      model: this.model,
      output: Output.object({
        name: 'beauty_copy_candidates',
        schema: generatedCopyCandidatesSchema,
      }),
      prompt,
    });
    const output = generatedCopyCandidatesSchema.parse(result.output);
    assertDistinctBodies(output);
    return {
      ...output,
      providerTaskRef: result.finalStep.response.id,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      },
    };
  }

  async respondText(
    prompt: string,
    referenceAssets: ResolvedReferenceAsset[] = [],
    abortSignal?: AbortSignal,
  ) {
    const result = await generateText({
      abortSignal,
      ...languageModelCallSettings(this.options),
      instructions:
        'Return one plain-text response for the requested canvas task. Do not return candidate arrays or provider protocol fields.',
      maxRetries: 0,
      model: this.model,
      ...(referenceAssets.length === 0
        ? { prompt }
        : {
            messages: [{
              role: 'user' as const,
              content: [
                { type: 'text' as const, text: prompt },
                ...referenceAssets.map((asset) => ({
                  type: 'image' as const,
                  image: asset.bytes,
                  mediaType: asset.contentType,
                })),
              ],
            }],
          }),
    });
    return {
      providerTaskRef: result.finalStep.response.id,
      text: result.text,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      },
    };
  }

  async adaptPlatformVariants(prompt: string, abortSignal?: AbortSignal) {
    const result = await generateText({
      abortSignal,
      ...languageModelCallSettings(this.options),
      instructions:
        'Adapt the supplied canonical beauty-business content into exactly three complete platform variants: xiaohongshu, douyin, and video_account. Preserve facts, make the three bodies materially different, and include a non-empty title, body, conversionHook, and topics for each platform.',
      maxRetries: 0,
      model: this.model,
      output: Output.object({
        name: 'beauty_platform_variants',
        schema: generatedPlatformVariantsSchema,
      }),
      prompt,
    });
    const platformVariants = generatedPlatformVariantsSchema.parse(
      result.output,
    );
    assertDistinctPlatformBodies(platformVariants);
    return {
      platformVariants,
      providerTaskRef: result.finalStep.response.id,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      },
    };
  }

  async generateStructured<StructuredOutput>(input: {
    abortSignal?: AbortSignal;
    instructions: string;
    onPartialOutput?: (partial: unknown) => Promise<void> | void;
    prompt: string;
    schema: ZodType<StructuredOutput>;
    schemaName: string;
  }) {
    if (input.onPartialOutput) {
      const result = streamText({
        abortSignal: input.abortSignal,
        ...languageModelCallSettings(this.options),
        instructions: input.instructions,
        maxRetries: 0,
        model: this.model,
        output: Output.object({
          name: input.schemaName,
          schema: input.schema,
        }),
        prompt: input.prompt,
      });
      for await (const partial of result.partialOutputStream) {
        await input.onPartialOutput(partial);
      }
      const [output, usage, metadata] = await Promise.all([
        Promise.resolve(result.output),
        Promise.resolve(result.usage),
        Promise.resolve(result.finalStep),
      ]);
      return {
        output: input.schema.parse(output),
        providerTaskRef: metadata.response.id,
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        },
      };
    }
    const result = await generateText({
      abortSignal: input.abortSignal,
      ...languageModelCallSettings(this.options),
      instructions: input.instructions,
      maxRetries: 0,
      model: this.model,
      output: Output.object({
        name: input.schemaName,
        schema: input.schema,
      }),
      prompt: input.prompt,
    });
    return {
      output: input.schema.parse(result.output),
      providerTaskRef: result.finalStep.response.id,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      },
    };
  }

  supportsCatalogModel(catalogModelId: string) {
    return catalogModelId === this.catalogModelId;
  }

  providerCost(usage: GeneratedCopyResult['usage']) {
    return {
      amount:
        (usage.inputTokens * this.options.inputCostPerMillion +
          usage.outputTokens * this.options.outputCostPerMillion) /
        1_000_000,
      currency: this.options.currency ?? ('USD' as const),
      usage,
    };
  }

  streamAssistant(request: AssistantStreamRequest, abortSignal?: AbortSignal) {
    this.assertFixedModel(request.catalogModelId);
    const result = streamText({
      abortSignal,
      ...languageModelCallSettings(this.options),
      instructions:
        'You are the assistant inside one beauty-content Work. Use tools only to read the supplied context or propose an inspectable field patch. Never submit generation, change models, or overwrite user input.',
      maxRetries: 0,
      messages: request.messages,
      model: this.model,
      stopWhen: isStepCount(3),
      tools: {
        readCurrentContext: tool({
          description: 'Read the current structured Work context.',
          inputSchema: z.object({}),
          execute: async () => request.context,
        }),
        proposeFieldPatch: tool({
          description:
            'Propose one inspectable field patch. The merchant must still accept, edit, or ignore it.',
          inputSchema: assistantFieldPatchSchema,
          execute: async (patch) => ({ ...patch, applied: false as const }),
        }),
      },
    });
    return createUIMessageStreamResponse({
      headers: streamHeaders('ai-sdk-ui-message-v1', this.catalogModelId),
      stream: toUIMessageStream({
        stream: result.fullStream,
        onError: () => '本次回复已中断，请由你决定是否重试。',
      }),
    });
  }

  startCopyStream(
    request: { catalogModelId: string; prompt: string },
    abortSignal?: AbortSignal
  ) {
    this.assertFixedModel(request.catalogModelId);
    const result = streamText({
      abortSignal,
      ...languageModelCallSettings(this.options),
      instructions:
        'Return exactly three materially different beauty-business copy candidates. Every candidate must include a non-empty title, body, and conversionHook.',
      maxRetries: 0,
      model: this.model,
      output: Output.object({
        name: 'beauty_copy_candidates',
        schema: generatedCopyCandidatesSchema,
      }),
      prompt: request.prompt,
    });
    const response = createTextStreamResponse({
      headers: streamHeaders('ai-sdk-object-json-v1', this.catalogModelId),
      stream: toTextStream({ stream: result.fullStream }),
    });
    const completion = Promise.all([
      Promise.resolve(result.output),
      Promise.resolve(result.usage),
      Promise.resolve(result.finalStep),
    ]).then(([output, usage, metadata]) => {
      const parsed = generatedCopyCandidatesSchema.parse(output);
      assertDistinctBodies(parsed);
      return {
        ...parsed,
        providerTaskRef: metadata.response.id,
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        },
      };
    });
    return { response, result: completion };
  }

  startCanvasTextStream(
    request: {
      catalogModelId: string;
      prompt: string;
      referenceAssets?: ResolvedReferenceAsset[];
    },
    abortSignal?: AbortSignal,
  ): CanvasTextStream {
    this.assertFixedModel(request.catalogModelId);
    const referenceAssets = request.referenceAssets ?? [];
    const result = streamText({
      abortSignal,
      ...languageModelCallSettings(this.options),
      instructions:
        'Return one plain-text response for the requested canvas task. Do not return candidate arrays or provider protocol fields.',
      maxRetries: 0,
      model: this.model,
      ...(referenceAssets.length === 0
        ? { prompt: request.prompt }
        : {
            messages: [{
              role: 'user' as const,
              content: [
                { type: 'text' as const, text: request.prompt },
                ...referenceAssets.map((asset) => ({
                  type: 'image' as const,
                  image: asset.bytes,
                  mediaType: asset.contentType,
                })),
              ],
            }],
          }),
    });
    return {
      deltas: result.textStream,
      result: Promise.all([
        Promise.resolve(result.text),
        Promise.resolve(result.usage),
        Promise.resolve(result.finalStep),
      ]).then(([text, usage, metadata]) => ({
        providerTaskRef: metadata.response.id,
        text,
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        },
      })),
    };
  }

  private assertFixedModel(catalogModelId: string) {
    if (catalogModelId !== this.catalogModelId) {
      throw new Error(
        `AI SDK runner is fixed to ${this.catalogModelId}; model fallback is disabled.`
      );
    }
  }
}

export class FixtureAiStreamingRunner implements AiStreamingRunner {
  readonly catalogModelId = 'local-fixture';

  supportsCatalogModel() {
    return true;
  }

  providerCost(usage: GeneratedCopyResult['usage']) {
    return { amount: 0, currency: 'USD' as const, usage };
  }

  async generateCopy(prompt: string) {
    return fixtureCopyResult(prompt);
  }

  streamAssistant(request: AssistantStreamRequest) {
    const messageId = 'fixture-assistant';
    const contextToolCallId = 'fixture-read-context';
    const patchToolCallId = 'fixture-propose-field-patch';
    const safeContext = fixtureAssistantContext(request.context);
    const fieldPatch = assistantFieldPatchSchema.parse({
      field: 'tone',
      value: '清晰、可信，像熟客分享',
      reason: '让表达贴合当前创作意图，同时保留由你确认的决定权。',
    });
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: 'start', messageId });
        writer.write({ type: 'text-start', id: messageId });
        writer.write({
          type: 'text-delta',
          id: messageId,
          delta: '我先按当前创作意图整理重点，',
        });
        await fixtureStreamPause();
        writer.write({
          type: 'text-delta',
          id: messageId,
          delta: '再给你一个可检查、可修改的建议。',
        });
        await fixtureStreamPause();
        writer.write({
          type: 'text-delta',
          id: messageId,
          delta: '\n\n## 建议方向\n\n- *',
        });
        await fixtureStreamPause();
        writer.write({
          type: 'text-delta',
          id: messageId,
          delta:
            '*语气**：可信、克制\n- **行动**：[核对门店信息](/dashboard/store)\n\n先用 `人工确认` 再发布。',
        });
        writer.write({ type: 'text-end', id: messageId });

        writer.write({
          type: 'tool-input-start',
          toolCallId: contextToolCallId,
          toolName: 'readCurrentContext',
        });
        await fixtureStreamPause();
        writer.write({
          type: 'tool-input-available',
          toolCallId: contextToolCallId,
          toolName: 'readCurrentContext',
          input: {},
        });
        writer.write({
          type: 'tool-output-available',
          toolCallId: contextToolCallId,
          output: safeContext,
        });
        writer.write({
          type: 'data-context',
          id: 'fixture-context',
          data: safeContext,
        });

        await fixtureStreamPause();
        writer.write({
          type: 'tool-input-start',
          toolCallId: patchToolCallId,
          toolName: 'proposeFieldPatch',
        });
        writer.write({
          type: 'tool-input-available',
          toolCallId: patchToolCallId,
          toolName: 'proposeFieldPatch',
          input: fieldPatch,
        });
        writer.write({
          type: 'tool-output-available',
          toolCallId: patchToolCallId,
          output: { ...fieldPatch, applied: false },
        });
        writer.write({
          type: 'data-field_patch',
          id: 'fixture-field-patch',
          data: fieldPatch,
        });
        writer.write({ type: 'finish', finishReason: 'stop' });
      },
    });
    return createUIMessageStreamResponse({
      headers: streamHeaders('ai-sdk-ui-message-v1', request.catalogModelId),
      stream,
    });
  }

  startCopyStream(
    request: { catalogModelId: string; prompt: string },
    abortSignal?: AbortSignal
  ) {
    const result = fixtureCopyResult(request.prompt);
    const chunks = [
      '{"candidates":[{"title":"透亮猫眼｜真实到店记录",',
      '"body":"从门店真实项目出发，先写清效果与到店前需要确认的信息。",',
      '"conversionHook":"先沟通需求"},{"title":"预约前先看这几点",',
      '"body":"把风格、时间和价格口径提前说清楚，不做夸大承诺。","conversionHook":"收藏后再预约"},',
      '{"title":"本地项目体验笔记","body":"记录可核对的门店与项目细节，实际感受因人而异。",',
      '"conversionHook":"到店前留言"}]}',
    ];
    return {
      response: pacedResponse(
        chunks,
        'text/plain; charset=utf-8',
        streamHeaders('ai-sdk-object-json-v1', request.catalogModelId),
        abortSignal
      ),
      result: delayedResult(
        result,
        chunks.length * FIXTURE_COPY_CHUNK_INTERVAL_MS,
        abortSignal
      ),
    };
  }

  startCanvasTextStream(
    request: {
      catalogModelId: string;
      prompt: string;
      referenceAssets?: ResolvedReferenceAsset[];
    },
    abortSignal?: AbortSignal,
  ): CanvasTextStream {
    const text = `画布文本：${request.prompt}`;
    const deltas = [text.slice(0, 5), text.slice(5, 11), text.slice(11)]
      .filter(Boolean);
    return {
      deltas: pacedTextDeltas(deltas, abortSignal),
      result: delayedCanvasTextResult(
        {
          providerTaskRef: `fixture-canvas-text-${Buffer.from(
            request.prompt,
          )
            .toString('base64url')
            .slice(0, 24)}`,
          text,
          usage: { inputTokens: 0, outputTokens: 0 },
        },
        Math.max(0, deltas.length - 1) * FIXTURE_COPY_CHUNK_INTERVAL_MS,
        abortSignal,
      ),
    };
  }
}

export class FixtureAiStructuredObjectExecutor
  implements StructuredObjectExecutor
{
  supportsCatalogModel() {
    return true;
  }

  async generate<Output>(input: {
    abortSignal?: AbortSignal;
    instructions: string;
    onPartialOutput?: (partial: unknown) => Promise<void> | void;
    prompt: string;
    schema: ZodType<Output>;
    schemaName: string;
  }) {
    const output = input.schema.parse(
      fixtureStructuredOutput(input.schemaName, input.prompt),
    );
    if (
      input.schemaName === 'harness_copy_candidate_v1' &&
      input.onPartialOutput
    ) {
      for (const partial of fixtureCopyCandidatePartials(output)) {
        if (input.abortSignal?.aborted) throw createAbortError();
        await input.onPartialOutput(partial);
        await fixtureStructuredStreamPause();
      }
    }
    return {
      output,
      providerTaskRef: `fixture-structured-${Buffer.from(
        `${input.schemaName}:${input.prompt}`,
      )
        .toString('base64url')
        .slice(0, 24)}`,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  providerCost(usage: { inputTokens: number; outputTokens: number }) {
    return { amount: 0, currency: 'USD' as const, usage };
  }
}

function fixtureCopyCandidatePartials(output: unknown) {
  const candidate = fixtureRecord(output);
  const title = typeof candidate.title === 'string' ? candidate.title : '';
  const body = typeof candidate.body === 'string' ? candidate.body : '';
  const conversionHook =
    typeof candidate.conversionHook === 'string'
      ? candidate.conversionHook
      : '';
  const partials: Array<Record<string, string>> = [];
  for (const [field, value] of [
    ['title', title],
    ['body', body],
    ['conversionHook', conversionHook],
  ] as const) {
    for (let end = 8; end < value.length; end += 8) {
      partials.push({
        ...(partials.at(-1) ?? {}),
        [field]: value.slice(0, end),
      });
    }
    partials.push({ ...(partials.at(-1) ?? {}), [field]: value });
  }
  return partials;
}

export function createNativeLanguageModel(options: OpenAiCompatibleAiSdkOptions) {
  const baseURL = options.baseUrl.replace(/\/$/, '');
  const family = options.apiFamily ?? 'openai';
  switch (family) {
    case 'anthropic':
      return createAnthropic({
        apiKey: options.apiKey,
        baseURL,
        fetch: options.fetch,
      })(options.model);
    case 'gemini':
      return createGoogleGenerativeAI({
        apiKey: options.apiKey,
        baseURL,
        fetch: options.fetch,
      })(options.model);
    case 'custom':
      if (options.customProtocol === 'anthropic_messages') {
        return createAnthropic({
          apiKey: options.apiKey,
          baseURL,
          fetch: options.fetch,
        })(options.model);
      }
      if (options.customProtocol === 'gemini_generate_content') {
        return createGoogleGenerativeAI({
          apiKey: options.apiKey,
          baseURL,
          fetch: options.fetch,
        })(options.model);
      }
      return createOpenAICompatible({
        apiKey: options.apiKey,
        baseURL,
        fetch: options.fetch,
        includeUsage: true,
        name: 'meiye-custom',
        supportsStructuredOutputs: true,
      }).chatModel(options.model);
    default:
      if (options.catalogModelId.startsWith('deepseek-v4-')) {
        return createOpenAICompatible({
          apiKey: options.apiKey,
          baseURL,
          fetch: options.fetch,
          includeUsage: true,
          name: 'deepseek',
          supportsStructuredOutputs: false,
        }).chatModel(options.model);
      }
      return createOpenAICompatible({
        apiKey: options.apiKey,
        baseURL,
        fetch: options.fetch,
        includeUsage: true,
        name: 'meiye-direct',
        supportsStructuredOutputs: true,
      }).chatModel(options.model);
  }
}

function languageModelCallSettings(options: OpenAiCompatibleAiSdkOptions) {
  const deepseekOptions = {
    ...(options.reasoningEffort
      ? { reasoningEffort: options.reasoningEffort }
      : {}),
    ...(options.thinking ? { thinking: options.thinking } : {}),
  };
  return {
    ...(options.maxOutputTokens
      ? { maxOutputTokens: options.maxOutputTokens }
      : {}),
    ...(Object.keys(deepseekOptions).length > 0
      ? { providerOptions: { deepseek: deepseekOptions } }
      : {}),
  };
}

function assertOptions(options: OpenAiCompatibleAiSdkOptions) {
  if (
    !options.catalogModelId.trim() ||
    !options.baseUrl.trim() ||
    !options.apiKey.trim() ||
    !options.model.trim()
  ) {
    throw new Error(
      'OpenAI-compatible AI SDK requires catalogModelId, baseUrl, apiKey and model.'
    );
  }
  if (options.inputCostPerMillion < 0 || options.outputCostPerMillion < 0) {
    throw new Error('OpenAI-compatible token prices must be non-negative.');
  }
  if (options.apiFamily === 'custom' && !options.customProtocol) {
    throw new Error('customProtocol is required for the custom API family.');
  }
  if (options.apiFamily !== 'custom' && options.customProtocol) {
    throw new Error(
      'customProtocol is only supported by the custom API family.',
    );
  }
}

function assertDistinctBodies(output: GeneratedCopyCandidates) {
  const bodies = output.candidates.map((candidate) =>
    candidate.body.replace(/\s+/gu, ' ').trim().toLowerCase()
  );
  if (new Set(bodies).size !== bodies.length) {
    throw new Error('Expected three materially distinct candidates.');
  }
}

function assertDistinctPlatformBodies(output: GeneratedPlatformVariants) {
  const bodies = Object.values(output).map((variant) =>
    variant.body.replace(/\s+/gu, ' ').trim().toLowerCase(),
  );
  if (new Set(bodies).size !== bodies.length) {
    throw new Error('Expected three materially distinct platform variants.');
  }
}

function streamHeaders(protocol: string, catalogModelId: string) {
  return {
    'cache-control': 'no-store',
    'x-meiye-catalog-model-id': catalogModelId,
    'x-meiye-stream-protocol': protocol,
  };
}

function fixtureCopyResult(prompt: string): GeneratedCopyResult {
  return {
    candidates: [
      {
        title: '透亮猫眼｜真实到店记录',
        body: '从门店真实项目出发，先写清效果与到店前需要确认的信息。',
        conversionHook: '先沟通需求',
      },
      {
        title: '预约前先看这几点',
        body: '把风格、时间和价格口径提前说清楚，不做夸大承诺。',
        conversionHook: '收藏后再预约',
      },
      {
        title: '本地项目体验笔记',
        body: '记录可核对的门店与项目细节，实际感受因人而异。',
        conversionHook: '到店前留言',
      },
    ],
    providerTaskRef: `fixture-${Buffer.from(prompt).toString('base64url').slice(0, 20)}`,
    usage: { inputTokens: 24, outputTokens: 180 },
  };
}

function fixtureStructuredOutput(schemaName: string, prompt: string) {
  const payload = parseFixtureRecord(prompt);
  switch (schemaName) {
    case 'harness_intent_naming_v1': {
      const context = fixtureRecord(payload.context);
      const intent = typeof context.intent === 'string' ? context.intent : '';
      const promotion = /团购|优惠|套餐/u.test(intent);
      return {
        taskType: fixtureHarnessTaskType(intent),
        deliveryLayer: 'copy',
        implicitConstraints: ['只使用已确认的本店事实'],
        blockingGap:
          promotion && context.offer_price === undefined
            ? {
                field: 'offer_price',
                question: '这次团购价按哪个金额写？',
                options: [],
                allowFreeText: true,
                scope: 'current_task',
              }
            : null,
      };
    }
    case 'harness_copy_brief_v1':
      return {
        kind: 'copy',
        instructions:
          '请基于当前任务和已确认资料生成一条可直接审核的小红书文案。正文需说明服务价值、适用场景与预约方式，只使用输入中可核对的事实，不编造价格、效果、资格或顾客案例，也不引用未授权素材。',
        platform: 'xiaohongshu',
        cta: '私信了解当前项目并预约',
        factRefs: [],
        assetRefs: [],
        identityRefs: [],
        constraints: ['不得编造价格、效果或顾客案例'],
      };
    case 'harness_copy_candidate_v1': {
      const candidateId =
        typeof payload.candidateId === 'string' ? payload.candidateId : 'c01';
      const index = Math.max(0, Number(candidateId.slice(1)) - 1);
      const candidates = [
        {
          title: '新项目到店前先看这几点',
          body: '从真实需求出发，把项目特点、沟通流程和到店前需要确认的信息一次说清楚；具体方案以现场沟通和当前有效信息为准。',
          conversionHook: '私信说说你的需求',
        },
        {
          title: '这次想认真介绍一下店里的新项目',
          body: '不夸大效果，也不省略关键沟通。先了解你的目标与时间安排，再依据门店当前确认的信息给出合适建议。',
          conversionHook: '留言预约到店沟通',
        },
        {
          title: '预约之前，先把项目细节聊明白',
          body: '适合自己的选择来自充分沟通。我们会说明服务流程、注意事项和可核对的信息，再由你决定是否预约。',
          conversionHook: '收藏后随时咨询',
        },
      ] as const;
      return {
        ...(candidates[index] ?? candidates[0]),
        factClaims: [],
        assetRefs: [],
      };
    }
    case 'harness_copy_score_v1': {
      const candidate = fixtureRecord(payload.candidate);
      const candidateId =
        typeof candidate.candidateId === 'string'
          ? candidate.candidateId
          : 'c01';
      const scoreById: Record<string, number> = { c01: 92, c02: 88, c03: 84 };
      return {
        score: scoreById[candidateId] ?? 80,
        dimensions: { grounding: 1, usefulness: 0.9, platformFit: 0.9 },
        reason: '候选仅使用已确认上下文，内容完整且适合目标平台。',
      };
    }
    default:
      throw new Error(`Unsupported fixture structured schema ${schemaName}.`);
  }
}

function fixtureHarnessTaskType(intent: string) {
  if (/团购|优惠|套餐/u.test(intent)) {
    return 'promotion_groupbuy_conversion' as const;
  }
  if (/老板娘|主理人|第一人称|个人\s*IP/iu.test(intent)) {
    return 'brand_personal_ip' as const;
  }
  if (/同城|周末|节日|热点/u.test(intent)) {
    return 'traffic_opportunity' as const;
  }
  if (/长期|预约说明|价目|须知/u.test(intent)) {
    return 'routine_marketing_materials' as const;
  }
  return 'daily_service_exposure' as const;
}

function parseFixtureRecord(value: string): Record<string, unknown> {
  try {
    return fixtureRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function fixtureRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pacedResponse(
  chunks: string[],
  contentType: string,
  headers: Record<string, string>,
  abortSignal?: AbortSignal
) {
  const encoder = new TextEncoder();
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let stopped = false;
  let abortHandler: (() => void) | undefined;
  const cleanup = () => {
    for (const timer of timers) clearTimeout(timer);
    if (abortHandler) abortSignal?.removeEventListener('abort', abortHandler);
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      abortHandler = () => {
        if (stopped) return;
        stopped = true;
        cleanup();
        controller.error(createAbortError());
      };
      if (abortSignal?.aborted) {
        abortHandler();
        return;
      }
      abortSignal?.addEventListener('abort', abortHandler, { once: true });
      chunks.forEach((chunk, index) => {
        const timer = setTimeout(() => {
          if (stopped) return;
          controller.enqueue(encoder.encode(chunk));
          if (index === chunks.length - 1) {
            stopped = true;
            cleanup();
            controller.close();
          }
        }, index * FIXTURE_COPY_CHUNK_INTERVAL_MS);
        timers.push(timer);
      });
    },
    cancel() {
      stopped = true;
      cleanup();
    },
  });
  return new Response(body, {
    headers: { ...headers, 'content-type': contentType },
  });
}

function delayedResult(
  result: GeneratedCopyResult,
  delayMs: number,
  abortSignal?: AbortSignal
) {
  return new Promise<GeneratedCopyResult>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(createAbortError());
      return;
    }
    const abortHandler = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    abortSignal?.addEventListener('abort', abortHandler, { once: true });
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', abortHandler);
      resolve(result);
    }, delayMs);
  });
}

function delayedCanvasTextResult(
  result: CanvasTextStreamResult,
  delayMs: number,
  abortSignal?: AbortSignal,
) {
  return new Promise<CanvasTextStreamResult>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(createAbortError());
      return;
    }
    const abortHandler = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    abortSignal?.addEventListener('abort', abortHandler, { once: true });
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', abortHandler);
      resolve(result);
    }, delayMs);
  });
}

async function* pacedTextDeltas(
  chunks: readonly string[],
  abortSignal?: AbortSignal,
): AsyncIterable<string> {
  for (const [index, chunk] of chunks.entries()) {
    if (abortSignal?.aborted) throw createAbortError();
    if (index > 0) await fixtureStreamPause();
    if (abortSignal?.aborted) throw createAbortError();
    yield chunk;
  }
}

function createAbortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function fixtureAssistantContext(context: AssistantStreamRequest['context']) {
  return {
    ...(context.audience ? { audience: context.audience } : {}),
    intent: context.intent,
    ...(context.scene ? { scene: context.scene } : {}),
    sourceSummaries: context.sourceSummaries.map(
      (_summary, index) => `已关联来源 ${index + 1}`
    ),
    ...(context.tone ? { tone: context.tone } : {}),
    workId: 'current-work',
  };
}

function fixtureStreamPause() {
  return new Promise<void>((resolve) =>
    setTimeout(resolve, FIXTURE_ASSISTANT_CHUNK_INTERVAL_MS)
  );
}

function fixtureStructuredStreamPause() {
  return new Promise<void>((resolve) =>
    setTimeout(resolve, FIXTURE_STRUCTURED_CHUNK_INTERVAL_MS)
  );
}
