import { createHash, randomUUID } from 'node:crypto';
import { RecordedGatewayPocPort } from './index.js';
import {
  OpenAiCompatibleAiSdkRunner,
  type OpenAiCompatibleAiSdkOptions,
} from './ai-sdk-runner.js';
import {
  ArkMediaExecutionPort,
  type ArkMediaExecutionOptions,
} from './ark-media-adapter.js';
import {
  TuziMediaExecutionPort,
  type TuziMediaExecutionOptions,
} from './tuzi-media-adapter.js';
import {
  VolcengineTtsLifecyclePort,
  type VolcengineTtsLifecycleOptions,
} from './volcengine-tts-lifecycle.js';
import type {
  AdapterRuntimeConfig,
  CatalogModel,
  ModelOperation,
  MediaProviderDrainMode,
  MediaProviderEffectRequest,
  MediaProviderHealthReport,
  MediaProviderLifecyclePort,
  ModelSupplySubmission,
  ProviderExecutionPort,
  ProviderExecutionRequest,
  ProviderExecutionResponse,
} from './index.js';

type LlmScenario = 'success' | '401' | '403' | '429' | '5xx' | 'stream_partial';

function digest(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function recordedBeautyCopy(prompt: string) {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(prompt) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    // Plain prompts use the bounded fallback below.
  }
  const grounding =
    parsed.grounding && typeof parsed.grounding === 'object'
      ? (parsed.grounding as Record<string, unknown>)
      : {};
  const brief =
    parsed.brief && typeof parsed.brief === 'object'
      ? (parsed.brief as Record<string, unknown>)
      : {};
  const text = (value: unknown, fallback: string) =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const store = text(grounding.name, '这家店');
  const city = text(grounding.city, '本地');
  const project = text(grounding.project, '这个项目');
  const hook = text(
    brief.hook,
    prompt.trim().slice(0, 72) || '记录一次真实到店体验'
  );
  const knownPrice =
    typeof grounding.price === 'number' && Number.isFinite(grounding.price)
      ? `已确认价格为 ¥${grounding.price}`
      : '价格以到店确认为准';
  return [
    {
      title: `${project}｜今天想分享的真实细节`,
      body: `${hook}。在${city}${store}做${project}，${knownPrice}。这条只记录可核对的门店与项目信息，效果感受因人而异。`,
      conversionHook: '先沟通需求',
    },
    {
      title: `熟客视角：${project}到店前可以先看这些`,
      body: `最近在${store}被问得比较多的是${project}。${hook}。我们会先根据你的偏好沟通细节，${knownPrice}，不做夸大承诺。`,
      conversionHook: '收藏后再预约',
    },
    {
      title: `${city}${project}｜预约前先把这件事说清楚`,
      body: `想做${project}，可以先告诉${store}你在意的风格和时间。${knownPrice}，到店后再按真实情况确认，这样沟通更省时。`,
      conversionHook: '到店前留言',
    },
  ];
}

export function recordedRequest(
  catalogModelId: string,
  operation: ModelOperation,
  input?: ModelSupplySubmission['input']
): ProviderExecutionRequest {
  const modality: CatalogModel['modality'] =
    operation.startsWith('copy.') || operation === 'text.respond'
      ? 'llm'
      : operation.startsWith('image.')
        ? 'image'
        : operation.startsWith('audio.')
          ? 'audio'
          : 'video';
  const family = catalogModelId.includes('anthropic')
    ? 'anthropic'
    : catalogModelId.includes('gemini')
      ? 'gemini'
      : modality === 'llm'
        ? 'openai'
        : modality === 'image'
          ? 'image'
          : modality === 'audio'
            ? 'audio'
            : 'media';
  return {
    jobId: randomUUID(),
    model: {
      id: catalogModelId,
      displayName: catalogModelId,
      modality,
      operations: [operation],
      qualityRank: 80,
    },
    deployment: {
      id: `${catalogModelId}-recorded`,
      catalogModelId,
      apiFamily: family,
      channel: 'direct',
      region:
        catalogModelId.includes('seed') || catalogModelId.includes('kling')
          ? 'domestic'
          : 'overseas',
      status: 'active',
    },
    submission: {
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      idempotencyKey: randomUUID(),
      operation,
      selection: { mode: 'fixed', catalogModelId },
      dataClass: [],
      prompt: `${catalogModelId} recorded request`,
      ...(input ? { input } : {}),
    },
  };
}

abstract class DirectLlmRecordedAdapter implements ProviderExecutionPort {
  private nextScenario: LlmScenario = 'success';

  abstract readonly catalogModelId: string;
  abstract readonly apiFamily: 'openai' | 'anthropic' | 'gemini' | 'custom';

  setNextScenario(scenario: LlmScenario) {
    this.nextScenario = scenario;
  }

  async execute(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResponse> {
    if (
      request.model.id !== this.catalogModelId ||
      !request.submission.operation.startsWith('copy.') &&
      request.submission.operation !== 'text.respond'
    ) {
      throw new Error(
        `${this.apiFamily} adapter received an incompatible catalog model or operation.`
      );
    }
    const scenario = this.nextScenario;
    this.nextScenario = 'success';
    if (scenario !== 'success') {
      const partial = scenario === 'stream_partial';
      return {
        kind: 'failure',
        acceptance: partial ? 'accepted' : 'rejected_before_accept',
        message: `${this.apiFamily} recorded ${scenario}`,
        providerCost: {
          amount: partial ? 0.01 : 0,
          currency: 'USD',
          usage: partial ? { inputTokens: 16, outputTokens: 7 } : {},
        },
      };
    }
    if (request.submission.operation === 'text.respond') {
      return {
        kind: 'completed',
        text: request.submission.prompt,
        providerCost: {
          amount: 0.02,
          currency: 'USD',
          usage: { inputTokens: 16, outputTokens: 32 },
        },
      };
    }
    if (request.submission.operation === 'copy.adapt') {
      return {
        kind: 'completed',
        platformVariants: {
          xiaohongshu: {
            title: '小红书｜到店体验笔记',
            body: '从可核对的门店项目出发，记录效果、流程与预约前要确认的细节。',
            conversionHook: '收藏后私信预约',
            topics: ['同城美业', '门店体验'],
          },
          douyin: {
            title: '抖音｜预约前先看这几点',
            body: '用口播节奏说清风格、时间和价格口径，并提醒到店后按真实情况确认。',
            conversionHook: '评论区留言预约',
            topics: ['同城探店'],
          },
          video_account: {
            title: '视频号｜熟客分享',
            body: '从熟客关心的真实问题切入，完整说明项目信息与预约方式，不做夸大承诺。',
            conversionHook: '转发给有需要的朋友',
            topics: ['熟客推荐'],
          },
        },
        providerCost: {
          amount: 0.02,
          currency: 'USD',
          usage: { inputTokens: 32, outputTokens: 220 },
        },
      };
    }
    const copyCandidates = recordedBeautyCopy(request.submission.prompt);
    return {
      kind: 'completed',
      copyCandidates,
      providerCost: {
        amount: 0.02,
        currency: 'USD',
        usage: { inputTokens: 32, outputTokens: 180 },
      },
    };
  }
}

export class OpenAiDirectRecordedAdapter extends DirectLlmRecordedAdapter {
  readonly catalogModelId = 'llm-openai';
  readonly apiFamily = 'openai' as const;
}

export class AnthropicDirectRecordedAdapter extends DirectLlmRecordedAdapter {
  readonly catalogModelId = 'llm-anthropic';
  readonly apiFamily = 'anthropic' as const;
}

export class GeminiDirectRecordedAdapter extends DirectLlmRecordedAdapter {
  readonly catalogModelId = 'llm-gemini';
  readonly apiFamily = 'gemini' as const;
}

export class CustomDirectRecordedAdapter extends DirectLlmRecordedAdapter {
  readonly catalogModelId = 'llm-custom';
  readonly apiFamily = 'custom' as const;
}

class FixtureCanvasAgentRecordedAdapter extends OpenAiDirectRecordedAdapter {
  override async execute(request: ProviderExecutionRequest) {
    const plan =
      request.submission.operation === 'text.respond'
        ? fixtureCanvasAgentPlan(request.submission.prompt)
        : null;
    if (!plan) return super.execute(request);
    return {
      kind: 'completed' as const,
      providerTaskRef: `fixture-canvas-agent-${digest(request.submission.prompt).slice(0, 20)}`,
      text: JSON.stringify(plan),
      providerCost: {
        amount: 0,
        currency: 'USD' as const,
        usage: { inputTokens: 16, outputTokens: 24 },
      },
    } satisfies ProviderExecutionResponse;
  }
}

function fixtureCanvasAgentPlan(prompt: string) {
  if (!prompt.includes('Return strict JSON for the fixed seven Canvas tools only:')) {
    return null;
  }
  let payload: {
    canvas?: { projectId?: unknown; revision?: unknown; workspaceId?: unknown };
  };
  try {
    payload = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)) as typeof payload;
  } catch {
    return null;
  }
  const canvas = payload.canvas;
  if (
    !canvas ||
    typeof canvas.projectId !== 'string' ||
    typeof canvas.workspaceId !== 'string' ||
    typeof canvas.revision !== 'number' ||
    !Number.isInteger(canvas.revision)
  ) {
    return null;
  }
  const identity = `${canvas.workspaceId}:${canvas.projectId}:${canvas.revision}`;
  return {
    operations: [
      {
        node: {
          data: { text: 'Fixture Agent 节点' },
          id: `agent-fixture-${canvas.projectId}-${canvas.revision}-${digest(identity).slice(0, 8)}`,
          kind: 'text' as const,
        },
        tool: 'create_node' as const,
      },
    ],
  };
}

export interface OpenAiCompatibleLlmExecutionOptions extends OpenAiCompatibleAiSdkOptions {}

/**
 * One-shot OpenAI-compatible chat-completions adapter. Product Core is the
 * retry owner, so this port intentionally performs exactly one HTTP request.
 */
export class OpenAiCompatibleLlmExecutionPort implements ProviderExecutionPort {
  private readonly runner: OpenAiCompatibleAiSdkRunner;

  constructor(private readonly options: OpenAiCompatibleLlmExecutionOptions) {
    this.runner = new OpenAiCompatibleAiSdkRunner(options);
  }

  async execute(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResponse> {
    if (
      request.model.modality !== 'llm' ||
      (!request.submission.operation.startsWith('copy.') &&
        request.submission.operation !== 'text.respond') ||
      request.model.id !== this.options.catalogModelId
    ) {
      return directFailure(
        'rejected_before_accept',
        `OpenAI-compatible direct execution is bound to ${this.options.catalogModelId} language operations.`,
        this.options.currency ?? 'USD'
      );
    }

    try {
      const runtimeConfig = publishedAdapterConfig(request, 'direct-llm');
      if (runtimeConfig) {
        requiredRuntimeText(
          runtimeConfig.endpointRevision,
          'direct-llm endpoint revision',
        );
      }
      const runner = runtimeConfig
        ? new OpenAiCompatibleAiSdkRunner({
            ...this.options,
            apiKey: requiredRuntimeCredential(request, 'direct-llm').secret,
            apiFamily: requiredRuntimeText(
              runtimeConfig.apiFamily,
              'direct-llm api family',
            ) as NonNullable<OpenAiCompatibleAiSdkOptions['apiFamily']>,
            baseUrl: requiredRuntimeText(
              runtimeConfig.baseUrl,
              'direct-llm base URL',
            ),
            currency: requiredRuntimeCurrency(runtimeConfig.currency),
            customProtocol: runtimeConfig.customProtocol,
            inputCostPerMillion: requiredRuntimeNumber(
              runtimeConfig.inputCostPerMillion,
              'direct-llm input price',
            ),
            model: requiredRuntimeText(
              runtimeConfig.providerModel,
              'direct-llm provider model',
            ),
            outputCostPerMillion: requiredRuntimeNumber(
              runtimeConfig.outputCostPerMillion,
              'direct-llm output price',
            ),
          })
        : request.runtimeBinding?.credential
          ? new OpenAiCompatibleAiSdkRunner({
              ...this.options,
              apiKey: request.runtimeBinding.credential.secret,
            })
          : this.runner;
      const result =
        request.submission.operation === 'copy.adapt'
          ? await runner.adaptPlatformVariants(request.submission.prompt)
          : request.submission.operation === 'text.respond'
            ? await runner.respondText(
                request.submission.prompt,
                request.resolvedInputAssets
                  ?.filter((asset) => asset.role === 'reference_image') ??
                  request.resolvedReferenceAssets ??
                  [],
              )
            : await runner.generateCopy(request.submission.prompt);
      const inputTokens = result.usage.inputTokens;
      const outputTokens = result.usage.outputTokens;
      return {
        kind: 'completed',
        providerTaskRef: result.providerTaskRef,
        ...('text' in result
          ? { text: result.text }
          : 'platformVariants' in result
          ? { platformVariants: result.platformVariants }
          : { copyCandidates: result.candidates }),
        providerCost: runner.providerCost({ inputTokens, outputTokens }),
      };
    } catch (error) {
      const failureDetail =
        error instanceof Error &&
        error.message === 'Expected three materially distinct candidates.'
          ? error.message
          : error instanceof Error
            ? error.name
            : 'unknown';
      return directFailure(
        directFailureAcceptance(error),
        `OpenAI-compatible AI SDK request failed: ${failureDetail}`,
        this.options.currency ?? 'USD'
      );
    }
  }
}

class PublishedAdapterBindingError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'PublishedAdapterBindingError';
  }
}

function publishedAdapterConfig(
  request: ProviderExecutionRequest,
  expectedAdapterKey: string,
): AdapterRuntimeConfig | undefined {
  const binding = request.runtimeBinding;
  if (!binding) return undefined;
  if (binding.adapterKey !== expectedAdapterKey) {
    throw new PublishedAdapterBindingError(
      `Published adapter binding ${binding.adapterKey} cannot execute through ${expectedAdapterKey}.`,
    );
  }
  if (!binding.adapterBindingRevision) return undefined;
  if (!binding.adapterConfig) {
    throw new PublishedAdapterBindingError(
      `Published adapter binding ${binding.adapterBindingRevision} has no runtime config.`,
    );
  }
  return binding.adapterConfig;
}

function requiredRuntimeCredential(
  request: ProviderExecutionRequest,
  adapterKey: string,
) {
  const credential = request.runtimeBinding?.credential;
  if (!credential?.secret.trim()) {
    throw new PublishedAdapterBindingError(
      `Published ${adapterKey} binding has no runtime credential.`,
    );
  }
  return credential;
}

function requiredRuntimeText(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PublishedAdapterBindingError(
      `Published adapter binding requires ${name}.`,
    );
  }
  return value.trim();
}

function requiredRuntimeNumber(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new PublishedAdapterBindingError(
      `Published adapter binding requires a non-negative finite ${name}.`,
    );
  }
  return value;
}

function requiredRuntimePositiveInteger(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new PublishedAdapterBindingError(
      `Published adapter binding requires a positive integer ${name}.`,
    );
  }
  return value;
}

function requiredRuntimeCurrency(value: unknown): 'CNY' | 'USD' {
  if (value !== 'CNY' && value !== 'USD') {
    throw new PublishedAdapterBindingError(
      'Published adapter binding requires a supported currency.',
    );
  }
  return value;
}

function directFailureAcceptance(error: unknown) {
  const statusCode =
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : undefined;
  return statusCode !== undefined && statusCode < 500
    ? ('rejected_before_accept' as const)
    : ('acceptance_unknown' as const);
}

function directFailure(
  acceptance: 'rejected_before_accept' | 'acceptance_unknown',
  message: string,
  currency: 'CNY' | 'USD'
): ProviderExecutionResponse {
  return {
    kind: 'failure',
    acceptance,
    message,
    providerCost: { amount: 0, currency, usage: {} },
  };
}


export {
  type RecordedMediaErrorPhase,
  type RecordedMediaErrorContract,
  RecordedMediaAdapterError,
  type RecordedMediaAdapterContract,
  RECORDED_MEDIA_ADAPTER_CONTRACTS,
  GptImage2RecordedAdapter,
  NanoBanana2RecordedAdapter,
  NanoBananaProRecordedAdapter,
  Seedream45RecordedAdapter,
  Seedream5ProRecordedAdapter,
  type RecordedTaskStatus,
  type RecordedMediaTask,
  Seedance2RecordedAdapter,
  KlingLatestRecordedAdapter,
  GrokLatestVideoRecordedAdapter,
  VeoLatestRecordedAdapter,
  AudioSpeechRecordedAdapter,
  AudioSfxRecordedAdapter,
  FalManagedMediaAdapter,
  ReplicateManagedMediaAdapter,
  defaultRecordedMediaAdapters,
} from './recorded-media-adapters.js';

import {
  defaultRecordedMediaAdapters,
  FalManagedMediaAdapter,
  RecordedAdapterRouter as RecordedMediaAdapterRouter,
} from './recorded-media-adapters.js';

export function defaultRecordedAdapters(): ProviderExecutionPort[] {
  return [
    new OpenAiDirectRecordedAdapter(),
    new AnthropicDirectRecordedAdapter(),
    new GeminiDirectRecordedAdapter(),
    new CustomDirectRecordedAdapter(),
    ...defaultRecordedMediaAdapters(),
  ];
}

/** Full recorded router (LLM + media). Media-only base lives in recorded-media-adapters. */
export class RecordedAdapterRouter extends RecordedMediaAdapterRouter {
  constructor(adapters: ProviderExecutionPort[] = defaultRecordedAdapters()) {
    super(adapters);
  }
}

export type ModelExecutionRuntimeMode =
  | 'disabled'
  | 'recorded'
  | 'fixture'
  | 'gateway'
  | 'direct';

export interface ModelExecutionRuntimeOptions {
  mode: ModelExecutionRuntimeMode;
  gateway?: 'bifrost' | 'litellm';
  direct?: OpenAiCompatibleLlmExecutionOptions;
  arkMedia?: ArkMediaExecutionOptions;
  tuziMedia?: TuziMediaExecutionOptions;
  volcengineTts?: VolcengineTtsLifecycleOptions;
}

export interface ModelExecutionRuntime {
  mode: ModelExecutionRuntimeMode;
  activation:
    | 'disabled'
    | 'recorded_only'
    | 'local_fixture_verified'
    | 'configured_unverified'
    | 'live_verified';
  execution: ProviderExecutionPort;
  media?: MediaProviderLifecyclePort;
  gateway?: 'bifrost' | 'litellm';
  direct?: OpenAiCompatibleLlmExecutionOptions;
  arkMedia?: ArkMediaExecutionOptions;
  tuziMedia?: TuziMediaExecutionOptions;
  volcengineTts?: VolcengineTtsLifecycleOptions;
}

class ConfiguredMediaExecutionPort
  implements ProviderExecutionPort, MediaProviderLifecyclePort
{
  constructor(
    private readonly fallback: ProviderExecutionPort,
    private readonly arkOptions?: ArkMediaExecutionOptions,
    private readonly tuziOptions?: TuziMediaExecutionOptions,
    private readonly volcengineTtsOptions?: VolcengineTtsLifecycleOptions,
  ) {
    this.ark = arkOptions ? new ArkMediaExecutionPort(arkOptions) : undefined;
    this.tuzi = tuziOptions ? new TuziMediaExecutionPort(tuziOptions) : undefined;
    this.volcengineTts = volcengineTtsOptions
      ? new VolcengineTtsLifecyclePort(volcengineTtsOptions)
      : undefined;
  }

  private readonly ark?: ArkMediaExecutionPort;
  private readonly tuzi?: TuziMediaExecutionPort;
  private readonly volcengineTts?: VolcengineTtsLifecyclePort;

  private provider(request: ProviderExecutionRequest) {
    const binding = request.runtimeBinding;
    if (binding) {
      if (binding.adapterKey === 'volcengine-tts') {
        if (!this.volcengineTts) {
          throw new Error('Published volcengine-tts binding has no runtime adapter.');
        }
        return this.volcengineTts;
      }
      if (binding.adapterKey === 'ark-media') {
        if (!this.arkOptions) {
          throw new Error('Published ark-media binding has no runtime adapter.');
        }
        return new ArkMediaExecutionPort(
          this.boundMediaOptions(this.arkOptions, request, 'ark-media'),
        );
      }
      if (binding.adapterKey === 'tuzi-media') {
        if (!this.tuziOptions) {
          throw new Error('Published tuzi-media binding has no runtime adapter.');
        }
        return new TuziMediaExecutionPort(
          this.boundMediaOptions(this.tuziOptions, request, 'tuzi-media'),
        );
      }
      throw new Error(
        `Published adapter binding ${binding.adapterKey} cannot execute media.`,
      );
    }
    if (request.model.id === 'seed-tts-2') {
      return this.volcengineTts;
    }
    if (request.deployment.executionChannelId?.includes('tuzi')) {
      if (this.tuzi) return this.tuzi;
    } else if (this.ark) {
      return this.ark;
    }
    return this.tuzi ?? this.ark;
  }

  private boundMediaOptions<VideoCatalogModelId extends string>(
    options: ArkMediaExecutionOptions<VideoCatalogModelId>,
    request: ProviderExecutionRequest,
    adapterKey: 'ark-media' | 'tuzi-media',
  ): ArkMediaExecutionOptions<VideoCatalogModelId> {
    const config = publishedAdapterConfig(request, adapterKey);
    const credential = request.runtimeBinding?.credential;
    if (!config) {
      return credential
        ? {
            ...options,
            apiKey: credential.secret,
            credentialVersion: credential.version,
          }
        : options;
    }
    const boundCredential = requiredRuntimeCredential(request, adapterKey);
    const providerModel = requiredRuntimeText(
      config.providerModel,
      `${adapterKey} provider model`,
    );
    const common = {
      ...options,
      apiKey: boundCredential.secret,
      assetSourceHosts: config.assetSourceHosts,
      baseUrl: requiredRuntimeText(config.baseUrl, `${adapterKey} base URL`),
      credentialVersion: boundCredential.version,
      endpointRevision: requiredRuntimeText(
        config.endpointRevision,
        `${adapterKey} endpoint revision`,
      ),
      sourceUrlTtlSeconds: requiredRuntimePositiveInteger(
        config.sourceUrlTtlSeconds,
        `${adapterKey} source URL TTL`,
      ),
    };
    if (request.model.modality === 'image') {
      if (options.image.catalogModelId !== request.model.id) {
        throw new Error(
          `Published ${adapterKey} binding cannot serve image model ${request.model.id}.`,
        );
      }
      return {
        ...common,
        image: {
          ...options.image,
          costPerImage: requiredRuntimeNumber(
            config.costPerImage,
            `${adapterKey} image price`,
          ),
          model: providerModel,
        },
      };
    }
    if (request.model.modality === 'video') {
      if (options.video.catalogModelId !== request.model.id) {
        throw new Error(
          `Published ${adapterKey} binding cannot serve video model ${request.model.id}.`,
        );
      }
      return {
        ...common,
        video: {
          ...options.video,
          costPerMillionTokens: requiredRuntimeNumber(
            config.costPerMillionTokens,
            `${adapterKey} video token price`,
          ),
          estimatedTokensPerSecond: requiredRuntimeNumber(
            config.estimatedTokensPerSecond,
            `${adapterKey} estimated video tokens per second`,
          ),
          model: providerModel,
        },
      };
    }
    throw new Error(
      `Published ${adapterKey} binding cannot serve ${request.model.modality}.`,
    );
  }

  execute(request: ProviderExecutionRequest) {
    if (request.model.modality === 'llm') return this.fallback.execute(request);
    return (this.provider(request) ?? this.fallback).execute(request);
  }

  private lifecycle(request: MediaProviderEffectRequest) {
    const provider = this.provider(request);
    if (!provider)
      throw new Error(
        'No configured media provider can handle this deployment.'
      );
    return provider;
  }

  submit(request: MediaProviderEffectRequest) {
    return this.lifecycle(request).submit(request);
  }

  recover(request: MediaProviderEffectRequest) {
    return this.lifecycle(request).recover(request);
  }

  poll(request: MediaProviderEffectRequest & { taskRef: string }) {
    return this.lifecycle(request).poll(request);
  }

  download(request: MediaProviderEffectRequest & { taskRef: string }) {
    return this.lifecycle(request).download(request);
  }

  cancel(request: MediaProviderEffectRequest & { taskRef: string }) {
    return this.lifecycle(request).cancel(request);
  }

  reportHealth(): MediaProviderHealthReport {
    const provider: MediaProviderLifecyclePort | undefined =
      this.ark ?? this.tuzi ?? this.volcengineTts;
    if (provider?.reportHealth) return provider.reportHealth() as MediaProviderHealthReport;
    return {
      state: 'unavailable',
      reason: 'no_configured_media_provider',
      source: 'adapter',
      observedAt: new Date().toISOString(),
    };
  }

  setDrainMode(mode: MediaProviderDrainMode) {
    const providers: Array<MediaProviderLifecyclePort | undefined> = [
      this.ark,
      this.tuzi,
      this.volcengineTts,
    ];
    for (const provider of providers) {
      provider?.setDrainMode?.(mode);
    }
  }

  getDrainMode(): MediaProviderDrainMode {
    const providers: Array<MediaProviderLifecyclePort | undefined> = [
      this.ark,
      this.tuzi,
      this.volcengineTts,
    ];
    for (const provider of providers) {
      const mode = provider?.getDrainMode?.();
      if (mode) return mode;
    }
    return 'accepting';
  }
}

function withConfiguredMedia(
  runtime: ModelExecutionRuntime,
  arkOptions: ArkMediaExecutionOptions | undefined,
  tuziOptions: TuziMediaExecutionOptions | undefined,
  volcengineTtsOptions: VolcengineTtsLifecycleOptions | undefined,
): ModelExecutionRuntime {
  if (!arkOptions && !tuziOptions && !volcengineTtsOptions) return runtime;
  const media = new ConfiguredMediaExecutionPort(
    runtime.execution,
    arkOptions,
    tuziOptions,
    volcengineTtsOptions,
  );
  return {
    ...runtime,
    activation:
      runtime.activation === 'disabled' ||
      runtime.activation === 'recorded_only'
        ? 'configured_unverified'
        : runtime.activation,
    execution: media,
    media,
    ...(arkOptions ? { arkMedia: arkOptions } : {}),
    ...(tuziOptions ? { tuziMedia: tuziOptions } : {}),
    ...(volcengineTtsOptions
      ? { volcengineTts: volcengineTtsOptions }
      : {}),
  };
}

class GatewayLlmRecordedMediaExecutionPort
  implements ProviderExecutionPort, MediaProviderLifecyclePort
{
  private readonly gateway: RecordedGatewayPocPort;
  private readonly media: RecordedMediaAdapterRouter;

  constructor(channel: 'bifrost' | 'litellm') {
    this.gateway = new RecordedGatewayPocPort(channel);
    this.media = new RecordedMediaAdapterRouter([
      ...defaultRecordedAdapters(),
      new FalManagedMediaAdapter(),
    ]);
  }

  async execute(request: ProviderExecutionRequest) {
    return request.model.modality === 'llm'
      ? this.gateway.execute(request)
      : this.media.execute(request);
  }

  submit(request: MediaProviderEffectRequest) {
    return this.media.submit(request);
  }

  recover(request: MediaProviderEffectRequest) {
    return this.media.recover(request);
  }

  poll(request: ProviderExecutionRequest & { taskRef: string }) {
    return this.media.poll(request);
  }

  download(request: ProviderExecutionRequest & { taskRef: string }) {
    return this.media.download(request);
  }

  cancel(request: ProviderExecutionRequest & { taskRef: string }) {
    return this.media.cancel(request);
  }

  reportHealth() {
    return this.media.reportHealth();
  }

  setDrainMode(mode: MediaProviderDrainMode) {
    this.media.setDrainMode(mode);
  }

  getDrainMode() {
    return this.media.getDrainMode();
  }
}


class DisabledModelExecutionPort implements ProviderExecutionPort {
  async execute(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResponse> {
    return {
      kind: 'failure',
      acceptance: 'rejected_before_accept',
      message: `Model execution is disabled for ${request.model.id}.`,
      providerCost: {
        amount: 0,
        currency: request.deployment.region === 'domestic' ? 'CNY' : 'USD',
        usage: {},
      },
    };
  }
}

/**
 * Pure assembly helper for main and worker. Gateway mode is deliberately a
 * recorded PoC; direct mode is only "configured_unverified" until activation
 * evidence is published by the control plane.
 */
export function createModelExecutionRuntime(
  options: ModelExecutionRuntimeOptions
): ModelExecutionRuntime {
  if (options.mode === 'disabled') {
    return withConfiguredMedia(
      {
        mode: options.mode,
        activation: 'disabled',
        execution: new DisabledModelExecutionPort(),
      },
      options.arkMedia,
      options.tuziMedia,
      options.volcengineTts,
    );
  }
  if (options.mode === 'recorded') {
    const recorded = new RecordedAdapterRouter();
    return withConfiguredMedia(
      {
        mode: options.mode,
        activation: 'recorded_only',
        execution: recorded,
        media: recorded,
      },
      options.arkMedia,
      options.tuziMedia,
      options.volcengineTts,
    );
  }
  if (options.mode === 'fixture') {
    const fixture = new RecordedAdapterRouter([
      new FixtureCanvasAgentRecordedAdapter(),
      ...defaultRecordedAdapters().filter(
        (adapter) => !(adapter instanceof OpenAiDirectRecordedAdapter),
      ),
    ]);
    return withConfiguredMedia(
      {
        mode: options.mode,
        activation: 'local_fixture_verified',
        execution: fixture,
        media: fixture,
      },
      options.arkMedia,
      options.tuziMedia,
      options.volcengineTts,
    );
  }
  if (options.mode === 'gateway') {
    const gateway = options.gateway ?? 'bifrost';
    const execution = new GatewayLlmRecordedMediaExecutionPort(gateway);
    return withConfiguredMedia(
      {
        mode: options.mode,
        activation: 'recorded_only',
        execution,
        media: execution,
        gateway,
      },
      options.arkMedia,
      options.tuziMedia,
      options.volcengineTts,
    );
  }
  if (!options.direct) {
    throw new Error(
      'Direct model execution requires explicit direct configuration.'
    );
  }
  return withConfiguredMedia(
    {
      mode: options.mode,
      activation: 'configured_unverified',
      execution: new OpenAiCompatibleLlmExecutionPort(options.direct),
      direct: options.direct,
    },
    options.arkMedia,
    options.tuziMedia,
    options.volcengineTts,
  );
}

export class BifrostLiteLlmComparison {
  report() {
    return {
      productTruthOwner: 'product_core' as const,
      productionDependency: false,
      measurementRevision: 'gateway-poc-evidence-2026-07-11-v2',
      evidence: [
        {
          id: 'gateway-contract-conformance',
          sourceKind: 'executable_test' as const,
          reference:
            'apps/core/src/p1/model-supply/adapters.test.ts#gateway-conformance',
          proves: [
            'acceptance_classification',
            'workspace_credential_isolation',
            'cooldown_scope',
            'secret_redaction',
          ],
        },
        {
          id: 'managed-media-lifecycle-conformance',
          sourceKind: 'executable_test' as const,
          reference:
            'apps/core/src/p1/model-supply/adapters.test.ts#managed-media-lifecycle',
          proves: [
            'fal_queue_lifecycle',
            'replicate_prediction_lifecycle',
            'asset_ingest_scope',
          ],
        },
        {
          id: 'runtime-activation-and-rollback',
          sourceKind: 'executable_test' as const,
          reference:
            'apps/core/src/p1/model-supply/adapters.test.ts#runtime-factory',
          proves: [
            'recorded_activation_boundary',
            'direct_fallback_boundary',
            'gateway_not_production_dependency',
          ],
        },
        {
          id: 'repository-dependency-boundary',
          sourceKind: 'repository_contract' as const,
          reference:
            'apps/core/src/p1/model-supply/adapters.ts#createModelExecutionRuntime',
          proves: [
            'no_catalog_ownership_move',
            'no_usage_ownership_move',
            'no_job_ownership_move',
          ],
        },
      ],
      candidates: [
        {
          name: 'bifrost' as const,
          role: 'primary_poc',
          deploymentWeight: 'medium',
          licenseBoundary: 'apache-2.0-core',
          operationalDependencies: [
            'gateway_process',
            'gateway_ha',
            'plugin_state',
          ],
          mediaSupport: {
            llm: 'recorded_conformant',
            image: 'not_promoted',
            video: 'veo_via_fal_queue_only',
          },
          migrationCost: {
            changedProductCorePorts: 0,
            directAdapterRetirementCandidates: ['veo-latest-direct-poc'],
            requiredSteps: [
              'deploy_isolated_gateway',
              'bind_execution_channel_revision',
              'run_recorded_conformance',
              'publish_activation_evidence',
            ],
          },
          upgradeRollback: {
            upgradeBoundary: 'isolated_gateway_deployment',
            rollbackTarget: 'recorded_or_direct_adapter',
            productionTrafficDuringPoc: false,
          },
          evidenceRefs: [
            'gateway-contract-conformance',
            'managed-media-lifecycle-conformance',
            'runtime-activation-and-rollback',
            'repository-dependency-boundary',
          ],
        },
        {
          name: 'litellm' as const,
          role: 'control_poc',
          deploymentWeight: 'high',
          licenseBoundary: 'mit-core-enterprise-separated',
          operationalDependencies: [
            'python_gateway_process',
            'database',
            'cache',
            'dashboard_stack',
          ],
          mediaSupport: {
            llm: 'recorded_conformant',
            image: 'not_promoted',
            video: 'control_only_no_promoted_route',
          },
          migrationCost: {
            changedProductCorePorts: 0,
            directAdapterRetirementCandidates: [],
            requiredSteps: [
              'deploy_isolated_gateway_stack',
              'bind_execution_channel_revision',
              'run_recorded_conformance',
              'publish_activation_evidence',
            ],
          },
          upgradeRollback: {
            upgradeBoundary: 'isolated_gateway_stack',
            rollbackTarget: 'recorded_or_direct_adapter',
            productionTrafficDuringPoc: false,
          },
          evidenceRefs: [
            'gateway-contract-conformance',
            'runtime-activation-and-rollback',
            'repository-dependency-boundary',
          ],
        },
      ],
      promotionRequires: [
        'workspace_and_credential_isolation',
        'complete_attempt_evidence',
        'secret_redaction',
        'upgrade_and_rollback_proof',
      ],
      llmTrack: {
        sharedContract: 'ProviderExecutionPort',
        retryOwner: 'product_core',
        cooldownScope: 'workspace_deployment_credential',
        rollbackTarget: 'recorded_or_direct_adapter',
        secretLogging: 'redacted',
      },
      mediaTrack: {
        primary: 'fal_queue',
        control: 'replicate_prediction',
        lifecycle: [
          'submit',
          'poll',
          'webhook',
          'cancel',
          'recover',
          'asset_ingest',
        ],
        falEligibleRecordedModel: 'veo-latest',
        directOnlyModels: ['seedance-2', 'kling-latest'],
        externalDataClasses: ['public'],
      },
      migration: {
        directAdapterNetReduction: 1,
        directAdapterReductionCandidates: ['veo-latest-direct-poc'],
        evidenceRef: 'managed-media-lifecycle-conformance',
        catalogOwnershipMoves: 0,
        usageOwnershipMoves: 0,
        jobOwnershipMoves: 0,
        productionTraffic: false,
      },
    };
  }
}
