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
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateObject,
  generateText,
  Output,
  stepCountIs,
  streamText,
  tool,
} from 'ai';
import { z } from 'zod';
import type { ResolvedReferenceAsset } from './reference-asset-resolver.js';

const FIXTURE_COPY_CHUNK_INTERVAL_MS = 200;
const FIXTURE_ASSISTANT_CHUNK_INTERVAL_MS = 120;

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
    const result = await generateObject({
      abortSignal,
      instructions:
        'Return exactly three materially different beauty-business copy candidates. Every candidate must include a non-empty title, body, and conversionHook.',
      maxRetries: 0,
      model: this.model,
      prompt,
      schema: generatedCopyCandidatesSchema,
      schemaName: 'beauty_copy_candidates',
    });
    const output = generatedCopyCandidatesSchema.parse(result.object);
    assertDistinctBodies(output);
    return {
      ...output,
      providerTaskRef: result.response.id,
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
      providerTaskRef: result.response.id,
      text: result.text,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      },
    };
  }

  async adaptPlatformVariants(prompt: string, abortSignal?: AbortSignal) {
    const result = await generateObject({
      abortSignal,
      instructions:
        'Adapt the supplied canonical beauty-business content into exactly three complete platform variants: xiaohongshu, douyin, and video_account. Preserve facts, make the three bodies materially different, and include a non-empty title, body, conversionHook, and topics for each platform.',
      maxRetries: 0,
      model: this.model,
      prompt,
      schema: generatedPlatformVariantsSchema,
      schemaName: 'beauty_platform_variants',
    });
    const platformVariants = generatedPlatformVariantsSchema.parse(
      result.object,
    );
    assertDistinctPlatformBodies(platformVariants);
    return {
      platformVariants,
      providerTaskRef: result.response.id,
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
      instructions:
        'You are the assistant inside one beauty-content Work. Use tools only to read the supplied context or propose an inspectable field patch. Never submit generation, change models, or overwrite user input.',
      maxRetries: 0,
      messages: request.messages,
      model: this.model,
      stopWhen: stepCountIs(3),
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
    return result.toUIMessageStreamResponse({
      headers: streamHeaders('ai-sdk-ui-message-v1', this.catalogModelId),
      onError: () => '本次回复已中断，请由你决定是否重试。',
    });
  }

  startCopyStream(
    request: { catalogModelId: string; prompt: string },
    abortSignal?: AbortSignal
  ) {
    this.assertFixedModel(request.catalogModelId);
    const result = streamText({
      abortSignal,
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
    const response = result.toTextStreamResponse({
      headers: streamHeaders('ai-sdk-object-json-v1', this.catalogModelId),
    });
    const completion = Promise.all([
      Promise.resolve(result.output),
      Promise.resolve(result.usage),
      Promise.resolve(result.response),
    ]).then(([output, usage, metadata]) => {
      const parsed = generatedCopyCandidatesSchema.parse(output);
      assertDistinctBodies(parsed);
      return {
        ...parsed,
        providerTaskRef: metadata.id,
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        },
      };
    });
    return { response, result: completion };
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
