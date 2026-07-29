import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  assistantFieldPatchSchema,
  copyCandidatesSchemaFor,
  DEFAULT_COPY_CANDIDATE_COUNT,
  generatedPlatformVariantsSchema,
  type AssistantStreamRequest,
  type GeneratedCopyCandidates,
  type GeneratedPlatformVariants,
} from '@meiye/contracts';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  NoObjectGeneratedError,
  Output,
  streamText,
  toUIMessageStream,
  tool,
} from 'ai';
import { z, type ZodType } from 'zod';
import type { StructuredObjectExecutor } from './index.js';
import {
  ExecutionAttemptBudgetExceeded,
  structuredExecutionContinuationSchema,
  type StructuredExecutionContinuation,
} from './execution-attempt-budget.js';
import { StructuredObjectGenerationError } from './provider-lifecycle.js';
import type { ResolvedReferenceAsset } from './reference-asset-resolver.js';

const FIXTURE_STREAM_CHUNK_INTERVAL_MS = 200;
const FIXTURE_ASSISTANT_CHUNK_INTERVAL_MS = 120;
const FIXTURE_STRUCTURED_CHUNK_INTERVAL_MS = 40;

export function fixtureStructuredFirstChunkHoldMs(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (env.APP_ENV !== 'e2e') return FIXTURE_STRUCTURED_CHUNK_INTERVAL_MS;
  const raw = env.E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS?.trim();
  if (!raw || !/^\d+$/u.test(raw)) {
    return FIXTURE_STRUCTURED_CHUNK_INTERVAL_MS;
  }
  const interval = Number(raw);
  return interval >= 1 && interval <= 10_000
    ? interval
    : FIXTURE_STRUCTURED_CHUNK_INTERVAL_MS;
}

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
    abortSignal?: AbortSignal,
    candidateCount?: 1 | 3,
    instructions?: string,
  ): Promise<GeneratedCopyResult>;
  streamAssistant(
    request: AssistantStreamRequest,
    abortSignal?: AbortSignal
  ): Response;
  startCanvasTextStream?(
    request: {
      catalogModelId: string;
      prompt: string;
      referenceAssets?: ResolvedReferenceAsset[];
      instructions?: string;
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

  async generateCopy(
    prompt: string,
    abortSignal?: AbortSignal,
    candidateCount: 1 | 3 = DEFAULT_COPY_CANDIDATE_COUNT,
    instructions?: string,
  ) {
    const schema = copyCandidatesSchemaFor(candidateCount);
    const result = await generateText({
      abortSignal,
      ...languageModelCallSettings(this.options),
      instructions:
        instructions ??
        `Return exactly ${candidateCount} materially distinct beauty-business copy ${candidateCount === 1 ? 'candidate' : 'candidates'}. Every candidate must include a non-empty title, body, and conversionHook.`,
      maxRetries: 0,
      model: this.model,
      output: Output.object({
        name: 'beauty_copy_candidates',
        schema,
      }),
      prompt,
    });
    const output = schema.parse(result.output);
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
    instructions?: string,
  ) {
    const result = await generateText({
      abortSignal,
      ...languageModelCallSettings(this.options),
      instructions:
        instructions ??
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

  async adaptPlatformVariants(
    prompt: string,
    abortSignal?: AbortSignal,
    instructions?: string,
  ) {
    const result = await generateText({
      abortSignal,
      ...languageModelCallSettings(this.options),
      instructions:
        instructions ??
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
    beforeProviderAttempt?: () => Promise<void>;
    instructions: string;
    onPartialOutput?: (partial: unknown) => Promise<void> | void;
    prompt: string;
    schema: ZodType<StructuredOutput>;
    schemaName: string;
    structuredContinuation?: StructuredExecutionContinuation;
  }) {
    if (input.structuredContinuation?.kind === 'schema_repair') {
      return this.repairStructured(input, input.structuredContinuation);
    }
    if (input.onPartialOutput) {
      try {
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
      } catch (error) {
        if (!NoObjectGeneratedError.isInstance(error)) throw error;
        return this.repairStructured(input, structuredRepairSeed(error));
      }
    }
    try {
      const result = await this.generateStructuredAttempt(input);
      return structuredAttemptResult(input.schema, result);
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
      return this.repairStructured(input, structuredRepairSeed(error));
    }
  }

  private async repairStructured<StructuredOutput>(
    input: {
      abortSignal?: AbortSignal;
      beforeProviderAttempt?: () => Promise<void>;
      instructions: string;
      prompt: string;
      schema: ZodType<StructuredOutput>;
      schemaName: string;
    },
    continuation: StructuredExecutionContinuation,
  ) {
    try {
      await input.beforeProviderAttempt?.();
    } catch (error) {
      if (error instanceof ExecutionAttemptBudgetExceeded) {
        throw new ExecutionAttemptBudgetExceeded(
          error.maxAttempts,
          error.consumedAttempts,
          error.completedAttemptsInRun,
          continuation,
        );
      }
      throw error;
    }
    let repaired: Awaited<ReturnType<typeof generateText>>;
    try {
      repaired = await this.generateStructuredAttempt({
        ...input,
        instructions:
          `${input.instructions}\n\n` +
          'The previous response failed schema validation. Return one corrected object that matches the schema exactly.',
        prompt: structuredRepairPrompt(input.prompt, continuation.invalidText),
      });
    } catch (repairError) {
      if (!NoObjectGeneratedError.isInstance(repairError)) throw repairError;
      throw new StructuredObjectGenerationError(
        {
          inputTokens:
            continuation.usage.inputTokens +
            (repairError.usage?.inputTokens ?? 0),
          outputTokens:
            continuation.usage.outputTokens +
            (repairError.usage?.outputTokens ?? 0),
        },
        {
          firstPassSchemaValid: false,
          repairCount: 1,
          repairReasons: ['schema_validation'],
          providerAttempts: 2,
        },
        { cause: repairError },
      );
    }
    const result = structuredAttemptResult(input.schema, repaired);
    return {
      ...result,
      usage: {
        inputTokens:
          continuation.usage.inputTokens + result.usage.inputTokens,
        outputTokens:
          continuation.usage.outputTokens + result.usage.outputTokens,
      },
      measurement: {
        firstPassSchemaValid: false,
        repairCount: 1,
        repairReasons: ['schema_validation'],
        providerAttempts: 2,
      },
    };
  }

  private generateStructuredAttempt<StructuredOutput>(input: {
    abortSignal?: AbortSignal;
    instructions: string;
    prompt: string;
    schema: ZodType<StructuredOutput>;
    schemaName: string;
  }) {
    return generateText({
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

  startCanvasTextStream(
    request: {
      catalogModelId: string;
      prompt: string;
      referenceAssets?: ResolvedReferenceAsset[];
      instructions?: string;
    },
    abortSignal?: AbortSignal,
  ): CanvasTextStream {
    this.assertFixedModel(request.catalogModelId);
    const referenceAssets = request.referenceAssets ?? [];
    const result = streamText({
      abortSignal,
      ...languageModelCallSettings(this.options),
      instructions:
        request.instructions ??
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

function structuredAttemptResult<StructuredOutput>(
  schema: ZodType<StructuredOutput>,
  result: Awaited<ReturnType<typeof generateText>>,
) {
  return {
    output: schema.parse(result.output),
    providerTaskRef: result.finalStep.response.id,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
}

function structuredRepairPrompt(prompt: string, invalidText: string) {
  return JSON.stringify({
    originalPrompt: prompt,
    invalidResponse: invalidText.slice(0, 8_000),
    repairInstruction:
      'Correct only the structure needed to satisfy the requested schema. Preserve supported facts and do not invent missing merchant facts.',
  });
}

function structuredRepairSeed(
  error: NoObjectGeneratedError,
): StructuredExecutionContinuation {
  return structuredExecutionContinuationSchema.parse({
    kind: 'schema_repair',
    invalidText: (error.text ?? '').slice(0, 8_000),
    usage: {
      inputTokens: error.usage?.inputTokens ?? 0,
      outputTokens: error.usage?.outputTokens ?? 0,
    },
  });
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
        Math.max(0, deltas.length - 1) * FIXTURE_STREAM_CHUNK_INTERVAL_MS,
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
      let partialIndex = 0;
      for (const partial of fixtureCopyCandidatePartials(output)) {
        if (input.abortSignal?.aborted) throw createAbortError();
        await input.onPartialOutput(partial);
        await fixtureStructuredStreamPause(partialIndex === 0);
        partialIndex += 1;
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
    ],
    providerTaskRef: `fixture-${Buffer.from(prompt).toString('base64url').slice(0, 20)}`,
    usage: { inputTokens: 24, outputTokens: 180 },
  };
}

/**
 * 失败档 (W03 / P0-2). Fixture mode has always been able to produce a delivery;
 * it could not produce a *failure*, so the whole 申报 chain — Core's Chinese
 * failure copy, the refund, the conversation card — had no journey to prove it
 * on. A merchant intent carrying this word arms one: the fixture emits a price
 * claim with no traceable source, which the real canonical gate then blocks.
 *
 * Fixture mode is `APP_ENV=e2e` only (model-supply/runtime-config.ts), so this
 * cannot arm anything in production.
 */
const FIXTURE_FAILURE_DRILL_MARKER = '失败档';
const FIXTURE_FAILURE_DRILL_CONSTRAINT = 'fixture-failure-drill';

function isFixtureFailureDrill(intent: string) {
  return intent.includes(FIXTURE_FAILURE_DRILL_MARKER);
}

function fixtureStructuredOutput(schemaName: string, prompt: string) {
  const payload = parseFixtureRecord(prompt);
  switch (schemaName) {
    case 'composer_destination_mapping_v1': {
      const destination =
        typeof payload.destination === 'string' ? payload.destination : '';
      const mentionedPlatforms = [
        /小红书|xiaohongshu/iu.test(destination) && 'xiaohongshu',
        /抖音|douyin/iu.test(destination) && 'douyin',
        /视频号|video.?account/iu.test(destination) && 'video_account',
        /朋友圈|moments/iu.test(destination) && 'wechat_moments',
        /线下|店内|立牌|海报|offline/iu.test(destination) &&
          'offline_material',
      ].filter(Boolean);
      if (mentionedPlatforms.length !== 1) {
        return {
          options: [
            {
              contentPackagePlatform: 'xiaohongshu',
              distributionTarget: 'manual_copy',
              label: '小红书，生成后手动复制',
            },
            {
              contentPackagePlatform: 'douyin',
              distributionTarget: 'manual_copy',
              label: '抖音，生成后手动复制',
            },
          ],
          question: '这份内容具体准备发到哪里？',
          status: 'needs_clarification',
        };
      }
      const contentPackagePlatform = mentionedPlatforms[0];
      const distributionTarget = /协助|同事|代发|handoff/iu.test(destination)
        ? 'assisted_handoff'
        : /导出|下载|文件|export/iu.test(destination)
          ? 'export'
          : /直接发布|自动发布|publish/iu.test(destination) &&
              (contentPackagePlatform === 'xiaohongshu' ||
                contentPackagePlatform === 'douyin' ||
                contentPackagePlatform === 'video_account')
            ? `publish:${contentPackagePlatform}`
            : 'manual_copy';
      return {
        contentPackagePlatform,
        distributionTarget,
        status: 'mapped',
      };
    }
    /**
     * W12② 身份草稿档. Deterministic on purpose: the e2e gate walks a merchant
     * from one background line to a draft they校对 field by field, so it has to
     * be able to name what it expects to read back. Everything here is derived
     * from what the merchant actually said — the fixture never volunteers a
     * fact the input did not carry, mirroring the live instructions.
     */
    case 'marketing_identity_draft_v1': {
      const background =
        typeof payload.background === 'string' ? payload.background.trim() : '';
      const referenceText =
        typeof payload.referenceText === 'string'
          ? payload.referenceText.trim()
          : '';
      if (!background) {
        return {
          displayName: null,
          owner: null,
          primaryClaimOrRole: null,
          professionalBoundaries: null,
          expressionSamples: null,
          forbiddenClaims: null,
          visualPrinciples: null,
          seriesAnchors: null,
        };
      }
      const person = payload.kind === 'person';
      // The first clause of the background line is the name the merchant led
      // with; the rest is what they said about it.
      const [lead = background, ...rest] = background
        .split(/[，,。；;]/u)
        .map((part) => part.trim())
        .filter(Boolean);
      const grounded = referenceText.length > 0;
      const fromDocument = (value: string) => ({
        value,
        provenance: 'document' as const,
        citation: { exactQuote: value },
      });
      const fromModel = (value: string) => ({
        value,
        provenance: 'ai_suggestion' as const,
      });
      const rejectsExaggeration = /不夸大/u.test(background);
      return {
        displayName: fromModel(lead),
        owner: null,
        primaryClaimOrRole: grounded
          ? fromDocument(referenceText.slice(0, 60))
          : null,
        professionalBoundaries: rejectsExaggeration
          ? fromModel('不夸大效果')
          : null,
        expressionSamples: null,
        forbiddenClaims:
          person || !rejectsExaggeration ? null : fromModel('不夸大效果'),
        visualPrinciples: null,
        seriesAnchors: null,
      };
    }
    case 'harness_intent_naming_v1': {
      const context = fixtureRecord(payload.context);
      const intent = typeof context.intent === 'string' ? context.intent : '';
      const promotion = /团购|优惠|套餐/u.test(intent);
      const sourceSummaries = Array.isArray(context.sourceSummaries)
        ? context.sourceSummaries.filter(
            (item): item is string => typeof item === 'string',
          )
        : [];
      const supplemented = sourceSummaries.some((item) =>
        item.startsWith('Merchant decision'),
      );
      const hasAsset =
        Array.isArray(payload.assetReferences) &&
        payload.assetReferences.length > 0;
      const industryInferred = /美发|美甲|护理|皮肤|美容|发型|染发/u.test(
        intent,
      );
      const route =
        supplemented || industryInferred || hasAsset ? 'customized' : 'guidance';
      const relevantAssetCategories = promotion
        ? ['promotion_activity', 'product_service']
        : hasAsset
          ? ['material']
        : industryInferred
          ? ['industry_category', 'product_service']
          : ['industry_category'];
      return {
        normalizedIntent: intent,
        taskType: fixtureHarnessTaskType(intent),
        deliveryLayer: 'copy',
        relevantAssetCategories,
        usedAssetCategories:
          route === 'customized'
            ? supplemented
              ? [relevantAssetCategories[0]]
              : hasAsset
                ? ['material']
              : industryInferred
                ? ['industry_category']
                : ['industry_category']
            : [],
        route,
        implicitConstraints: ['只使用已确认的本店事实'],
        blockingGap:
          route === 'guidance'
            ? {
                field: promotion ? 'promotion_details' : 'industry_category',
                question: promotion
                  ? '方便补充这次活动的项目和价格档吗？'
                  : '这次内容主要属于哪一类美业服务？',
                options: [],
                allowFreeText: true,
                scope: 'current_task',
              }
            : null,
      };
    }
    case 'harness_copy_brief_v1': {
      const declaration = fixtureRecord(payload.declaration);
      const normalizedIntent =
        typeof declaration.normalizedIntent === 'string'
          ? declaration.normalizedIntent
          : '介绍本店护理项目';
      return {
        kind: 'copy',
        instructions:
          '请基于当前任务和已确认资料生成一条可直接审核的小红书文案。正文需说明服务价值、适用场景与预约方式，只使用输入中可核对的事实，不编造价格、效果、资格或顾客案例，也不引用未授权素材。' +
          `本次需求：${normalizedIntent}`,
        platform: 'xiaohongshu',
        cta: '私信了解当前项目并预约',
        factRefs: fixturePromptFactRefs(payload),
        assetRefs: [],
        identityRefs: [],
        constraints: isFixtureFailureDrill(normalizedIntent)
          ? ['不得编造价格、效果或顾客案例', FIXTURE_FAILURE_DRILL_CONSTRAINT]
          : ['不得编造价格、效果或顾客案例'],
      };
    }
    case 'harness_image_brief_v1': {
      const executionContract = fixtureRecord(payload.executionContract);
      const declaration = fixtureRecord(payload.declaration);
      const factRefs = fixturePromptFactRefs(payload);
      const sources = fixtureRecord(executionContract.sources);
      const sourceAssets = Array.isArray(sources.assets)
        ? sources.assets.map(fixtureRecord)
        : [];
      const operation =
        executionContract.operation === 'image.edit' ||
        executionContract.operation === 'image.reference_transform'
          ? executionContract.operation
          : 'image.generate';
      const merchantIntent =
        typeof declaration.normalizedIntent === 'string'
          ? declaration.normalizedIntent
          : '制作一张门店活动图片';
      const exactText = [
        ...merchantIntent.matchAll(
          /(?:价格|活动价|团购价)\s*[:：]?\s*\d+(?:\s*元)?/gu,
        ),
      ].map(([text]) => ({ text, treatment: 'exact' as const }));
      const references = sourceAssets.map((asset, index) => {
        const slot =
          operation === 'image.edit'
            ? 'work_case'
            : index === 0
              ? 'style_ref'
              : 'composition_ref';
        return {
          assetId: String(asset.id),
          assetRevision: String(asset.revision),
          slot,
          mimeType: 'image/png',
          sizeBytes: 1_024,
          factRefs: slot === 'work_case' ? factRefs : [],
          rightsRefs: [],
        };
      });
      return {
        kind: 'image',
        intent: {
          operation,
          purpose: merchantIntent,
          subject: '门店本次推广项目',
          scene: '符合商家描述的真实门店场景',
          composition: '主体清晰并保留安全文字区域',
          references,
          exactText,
          changes:
            operation === 'image.edit'
              ? [{ target: 'layout', instruction: '按商家要求调整画面布局' }]
              : [],
          invariants:
            operation === 'image.edit'
              ? [
                  {
                    target: 'work_case_surface',
                    requirement: '保持真实案例甲面、发型或皮肤状态不变',
                  },
                ]
              : [],
          factRefs:
            operation === 'image.edit' ? factRefs : [],
          rightsRefs: [],
          outputPlan: { kind: 'single' },
        },
        prompt: `请制作一张可直接交付的美业图片：${merchantIntent}。严格遵守已确认事实和参考素材语义。`,
        referenceAssetIds: sourceAssets.map((asset) => String(asset.id)),
        parameters: {
          ratio: '3:4',
          resolution: '2048',
        },
        constraints: ['不得改动真实案例证据，不得写错精确文字'],
      };
    }
    case 'harness_video_brief_v1': {
      const executionContract = fixtureRecord(payload.executionContract);
      const declaration = fixtureRecord(payload.declaration);
      const sources = fixtureRecord(executionContract.sources);
      const sourceAssets = Array.isArray(sources.assets)
        ? sources.assets.map(fixtureRecord)
        : [];
      const deliverables = Array.isArray(executionContract.deliverables)
        ? executionContract.deliverables.map(fixtureRecord)
        : [];
      const videoDeliverable =
        deliverables.find((deliverable) => deliverable.kind === 'video') ?? {};
      const durationSeconds =
        typeof videoDeliverable.durationSeconds === 'number'
          ? videoDeliverable.durationSeconds
          : 15;
      const ratio =
        typeof videoDeliverable.aspectRatio === 'string'
          ? videoDeliverable.aspectRatio
          : '9:16';
      const merchantIntent =
        typeof declaration.normalizedIntent === 'string'
          ? declaration.normalizedIntent
          : '制作一条门店项目成片';
      return {
        kind: 'video',
        storyboard: [
          {
            index: 1,
            description: `以已授权案例素材开场，说明本次主题：${merchantIntent}`,
            narration: merchantIntent,
            durationSeconds,
          },
        ],
        firstFramePrompt:
          '使用已授权案例素材呈现门店项目主视觉，画面主体清晰并保留安全文字区域。',
        referenceAssetIds: sourceAssets.map((asset) => String(asset.id)),
        parameters: { durationSeconds, ratio },
        constraints: ['不得编造价格或效果，不得使用未授权素材'],
      };
    }
    case 'harness_note_plan_v1': {
      const intent =
        typeof payload.intent === 'string'
          ? payload.intent
          : '介绍本店护理项目';
      const conversion = /团购|优惠|活动|价格/u.test(intent);
      const personal = /主理人|老板娘|个人\s*IP/iu.test(intent);
      const roles = conversion
        ? [
            'cover',
            'pain_scene',
            'solution_show',
            'price_offer',
            'cta_guide',
          ]
        : personal
          ? ['cover', 'work_case', 'cta_guide']
          : ['cover', 'solution_show', 'cta_guide'];
      const purposeByRole = {
        cover: 'capture_attention',
        pain_scene: 'name_customer_pain',
        solution_show: 'explain_solution',
        work_case: 'prove_with_case',
        price_offer: 'present_offer',
        cta_guide: 'drive_action',
      } as const;
      return {
        schema: 'note-plan/v1',
        themeAnchor: intent,
        style: {
          id: 'planning',
          name: '规划中',
          positioning: '等待风格草稿',
        },
        pages: roles.map((pageRole, index) => {
          const exactText =
            pageRole === 'price_offer'
              ? [...intent.matchAll(/\d+(?:\s*元)?/gu)].map(([text]) => text)
              : [];
          return {
            id: `page-${index + 1}`,
            order: index + 1,
            revision: 1,
            pageRole,
            pagePurpose:
              purposeByRole[pageRole as keyof typeof purposeByRole],
            imageIntent: {
              operation: 'image.generate',
              purpose: `${pageRole}配图`,
              subject: '门店本次推广项目',
              scene: '符合商家描述的真实门店场景',
              composition: '主体清晰并保留安全文字区域',
              references: [],
              exactText: exactText.map((text) => ({
                text,
                treatment: 'exact',
              })),
              changes: [],
              invariants: [],
              factRefs: Array.isArray(payload.factRefs)
                ? payload.factRefs
                : [],
              rightsRefs: Array.isArray(payload.rightsRefs)
                ? payload.rightsRefs
                : [],
              outputPlan: { kind: 'single' },
            },
            textBlock: {
              title: `${pageRole}标题`,
              body: `${pageRole}正文`,
              exactText,
            },
            dependencies:
              index === 0
                ? []
                : [
                    {
                      pageId: `page-${index}`,
                      kind: 'text_sequence',
                    },
                  ],
          };
        }),
      };
    }
    case 'harness_note_text_block_v1': {
      const page = fixtureRecord(payload.page);
      const style = fixtureRecord(payload.style);
      const previous = fixtureRecord(payload.previousTextBlock);
      const role =
        typeof page.pageRole === 'string' ? page.pageRole : '内容';
      const styleName =
        typeof style.name === 'string' ? style.name : '图文版本';
      const previousBody =
        typeof previous.body === 'string' ? previous.body : '';
      const existing = fixtureRecord(page.textBlock);
      const exactText = Array.isArray(existing.exactText)
        ? existing.exactText
        : [];
      return {
        title: `${styleName}｜${role}`,
        body: `${previousBody ? `承接上一页：${previousBody.slice(-20)}。` : ''}${styleName}围绕${role}说明本店已确认信息。`,
        exactText,
      };
    }
    case 'harness_note_consistency_v1': {
      const attempt =
        payload.attempt === 'after_regeneration'
          ? 'after_regeneration'
          : 'initial';
      const plan = fixtureRecord(payload.plan);
      const themeAnchor =
        typeof plan.themeAnchor === 'string' ? plan.themeAnchor : '';
      const pages = Array.isArray(plan.pages)
        ? plan.pages.map(fixtureRecord)
        : [];
      const conflict =
        attempt === 'initial' && /图文冲突样本/u.test(themeAnchor);
      return {
        evaluatedAt:
          typeof payload.evaluatedAt === 'string'
            ? payload.evaluatedAt
            : new Date().toISOString(),
        dimensions: [
          'theme_continuity',
          'visual_consistency',
          'non_repetition',
          'role_coverage',
          'image_text_cross_reference',
        ].map((dimension) => ({
          dimension,
          passed: !conflict || dimension !== 'image_text_cross_reference',
          reason:
            conflict && dimension === 'image_text_cross_reference'
              ? '第二页图文指向冲突，需要回炉'
              : `${dimension}通过`,
          pageIds:
            conflict && dimension === 'image_text_cross_reference'
              ? [String(pages[1]?.id ?? '')].filter(Boolean)
              : [],
        })),
        regenerationPageIds:
          conflict && pages[1]?.id ? [String(pages[1].id)] : [],
      };
    }
    case 'harness_copy_candidate_v1': {
      const candidateId =
        typeof payload.candidateId === 'string' ? payload.candidateId : 'c01';
      const index = Math.max(0, Number(candidateId.slice(1)) - 1);
      const brief = fixtureRecord(payload.brief);
      const frozenIntent =
        typeof brief.instructions === 'string'
          ? brief.instructions.split('本次需求：').at(-1)?.trim()
          : undefined;
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
        ...(frozenIntent
          ? {
              title: `${frozenIntent.slice(0, 120)}｜${(candidates[index] ?? candidates[0]).title}`,
            }
          : {}),
        // 失败档: an ungrounded price claim. Nothing about the failure is faked
        // downstream — the real canonical `critical_fact_source` gate blocks
        // this candidate and its retry, the real workflow fails, the real
        // reservation is refunded, and the real terminal frame carries the
        // merchant 申报. Only the model output is deterministic, which is the
        // same boundary every other fixture journey runs on.
        factClaims: prompt.includes(FIXTURE_FAILURE_DRILL_CONSTRAINT)
          ? [{ kind: 'price', value: '演练价 888 元' }]
          : [],
        assetRefs: [],
      };
    }
    case 'harness_fact_satisfaction_v1': {
      const requested = Array.isArray(payload.factTypes)
        ? payload.factTypes.filter((item): item is string => typeof item === 'string')
        : [];
      const facts = Array.isArray(payload.facts)
        ? payload.facts.map(fixtureRecord)
        : [];
      const available = new Set(
        facts
          .map((fact) => fact.kind)
          .filter((kind): kind is string => typeof kind === 'string'),
      );
      const missingFactTypes = requested.filter((kind) => !available.has(kind));
      return {
        status:
          missingFactTypes.length === 0
            ? 'satisfied'
            : missingFactTypes.length === requested.length
              ? 'unsatisfied'
              : 'partial',
        matchedFactRefs: facts
          .map((fact) => fact.sourceRef)
          .filter((reference): reference is string => typeof reference === 'string'),
        missingFactTypes,
      };
    }
    case 'harness_fact_criticality_v1': {
      const missing = Array.isArray(payload.missingFactTypes)
        ? payload.missingFactTypes
        : [];
      return {
        criticality: missing.some((kind) =>
          ['price', 'discount', 'group_buy', 'qualification'].includes(String(kind)),
        )
          ? 'critical'
          : 'optional',
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

function fixturePromptFactRefs(payload: Record<string, unknown>) {
  const bundle = fixtureRecord(payload.bundle);
  const dimensions = fixtureRecord(bundle.dimensions);
  const facts = fixtureRecord(dimensions.store_facts_assets);
  return [
    ...new Set(
      Object.values(facts)
        .map(fixtureRecord)
        .map((fact) => fact.sourceRef)
        .filter(
          (reference): reference is string =>
            typeof reference === 'string' &&
            reference.startsWith('store_fact:'),
        ),
    ),
  ].sort((left, right) => left.localeCompare(right));
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

function fixtureStructuredStreamPause(firstChunk: boolean) {
  return new Promise<void>((resolve) =>
    setTimeout(
      resolve,
      firstChunk
        ? fixtureStructuredFirstChunkHoldMs()
        : FIXTURE_STRUCTURED_CHUNK_INTERVAL_MS,
    )
  );
}
