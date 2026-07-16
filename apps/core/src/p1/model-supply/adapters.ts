import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RecordedGatewayPocPort } from './index.js';
import { resolveFfmpegPath } from './media-tool-paths.js';
import {
  parseAudioSfxContract,
  parseAudioSpeechContract,
} from '../../pro-studio-runtime/audio-contracts.js';
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
import type {
  CatalogModel,
  ModelOperation,
  MediaProviderEffectRequest,
  MediaProviderLifecyclePort,
  ModelAssetStoragePort,
  ModelSupplySubmission,
  OwnedAsset,
  ProviderExecutionPort,
  ProviderExecutionRequest,
  ProviderExecutionResponse,
} from './index.js';

type LlmScenario = 'success' | '401' | '403' | '429' | '5xx' | 'stream_partial';

const execFileAsync = promisify(execFile);
let recordedVideoFixture: Promise<Buffer> | undefined;
const recordedAudioFixtures = new Map<'mp3' | 'wav', Promise<Buffer>>();

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
      const result =
        request.submission.operation === 'copy.adapt'
          ? await this.runner.adaptPlatformVariants(request.submission.prompt)
          : request.submission.operation === 'text.respond'
            ? await this.runner.respondText(
                request.submission.prompt,
                request.resolvedInputAssets
                  ?.filter((asset) => asset.role === 'reference_image') ??
                  request.resolvedReferenceAssets ??
                  [],
              )
            : await this.runner.generateCopy(request.submission.prompt);
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
        providerCost: this.runner.providerCost({ inputTokens, outputTokens }),
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

interface RecordedMediaAdapterContractBase {
  catalogModelId: string;
  adapterRevision: string;
  capabilityRevision: string;
  priceRevision: string;
  assetTtlSeconds: number;
  logicalTimeoutSeconds: number;
  submissionMode: 'sync_normalized' | 'async';
  errorCodes: readonly string[];
  errorContracts: readonly RecordedMediaErrorContract[];
  cost: {
    amount: number;
    currency: 'CNY' | 'USD';
    unit: 'recorded_media_unit' | 'recorded_audio_unit';
  };
}

export type RecordedMediaErrorPhase = 'submit' | 'poll' | 'download' | 'cancel';

export interface RecordedMediaErrorContract {
  code: string;
  phase: RecordedMediaErrorPhase;
  acceptance: 'rejected_before_accept' | 'accepted' | 'acceptance_unknown';
  billable: boolean;
  retryable: boolean;
}

export class RecordedMediaAdapterError extends Error {
  constructor(
    readonly contract: RecordedMediaErrorContract,
    message: string
  ) {
    super(message);
    this.name = 'RecordedMediaAdapterError';
  }

  get code() {
    return this.contract.code;
  }
}

function recordedMediaErrorContracts(
  codes: readonly string[]
): RecordedMediaErrorContract[] {
  return codes.map((code) => {
    if (code === 'download_failed') {
      return {
        code,
        phase: 'download',
        acceptance: 'accepted',
        billable: true,
        retryable: true,
      };
    }
    if (code === 'cancel_pending') {
      return {
        code,
        phase: 'cancel',
        acceptance: 'accepted',
        billable: true,
        retryable: true,
      };
    }
    if (code === 'logical_timeout') {
      return {
        code,
        phase: 'poll',
        acceptance: 'accepted',
        billable: true,
        retryable: true,
      };
    }
    if (code === 'acceptance_unknown') {
      return {
        code,
        phase: 'submit',
        acceptance: 'acceptance_unknown',
        billable: true,
        retryable: false,
      };
    }
    return {
      code,
      phase: 'submit',
      acceptance: 'rejected_before_accept',
      billable: false,
      retryable: code === 'rate_limited' || code === 'preview_unavailable',
    };
  });
}

export type RecordedMediaAdapterContract =
  | (RecordedMediaAdapterContractBase & {
      modality: 'image';
      operations: readonly ['image.generate', 'image.edit'];
      dimensions: { min: number; max: number };
      maxReferenceAssets: number;
    })
  | (RecordedMediaAdapterContractBase & {
      modality: 'video';
      operations: readonly ['video.generate'];
      durationSeconds: { min: number; max: number };
      outputContentType: 'video/mp4';
    })
  | (RecordedMediaAdapterContractBase & {
      modality: 'audio';
      operations: readonly ['audio.speech'] | readonly ['audio.sfx'];
      outputContentTypes: readonly ['audio/mpeg', 'audio/wav'];
    });

export const RECORDED_MEDIA_ADAPTER_CONTRACTS = {
  'gpt-image-2': {
    catalogModelId: 'gpt-image-2',
    adapterRevision: 'gpt-image-2-adapter-v1',
    capabilityRevision: 'gpt-image-2:image-v1',
    priceRevision: 'gpt-image-2:price-v1',
    modality: 'image',
    operations: ['image.generate', 'image.edit'],
    dimensions: { min: 512, max: 4096 },
    maxReferenceAssets: 16,
    submissionMode: 'sync_normalized',
    assetTtlSeconds: 3600,
    logicalTimeoutSeconds: 120,
    errorCodes: [
      'invalid_reference',
      'content_rejected',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
    ],
    errorContracts: recordedMediaErrorContracts([
      'invalid_reference',
      'content_rejected',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
    ]),
    cost: { amount: 0.12, currency: 'USD', unit: 'recorded_media_unit' },
  },
  'nano-banana-2': {
    catalogModelId: 'nano-banana-2',
    adapterRevision: 'nano-banana-2-adapter-v1',
    capabilityRevision: 'nano-banana-2:image-v1',
    priceRevision: 'nano-banana-2:price-v1',
    modality: 'image',
    operations: ['image.generate', 'image.edit'],
    dimensions: { min: 512, max: 2048 },
    maxReferenceAssets: 8,
    submissionMode: 'async',
    assetTtlSeconds: 2700,
    logicalTimeoutSeconds: 300,
    errorCodes: [
      'invalid_reference',
      'permission_missing',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
    ],
    errorContracts: recordedMediaErrorContracts([
      'invalid_reference',
      'permission_missing',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
    ]),
    cost: { amount: 0.08, currency: 'USD', unit: 'recorded_media_unit' },
  },
  'nano-banana-pro': {
    catalogModelId: 'nano-banana-pro',
    adapterRevision: 'nano-banana-pro-adapter-v1',
    capabilityRevision: 'nano-banana-pro:image-v1',
    priceRevision: 'nano-banana-pro:price-v1',
    modality: 'image',
    operations: ['image.generate', 'image.edit'],
    dimensions: { min: 512, max: 4096 },
    maxReferenceAssets: 14,
    submissionMode: 'async',
    assetTtlSeconds: 3600,
    logicalTimeoutSeconds: 300,
    errorCodes: [
      'invalid_reference',
      'permission_missing',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
    ],
    errorContracts: recordedMediaErrorContracts([
      'invalid_reference',
      'permission_missing',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
    ]),
    cost: { amount: 0.14, currency: 'USD', unit: 'recorded_media_unit' },
  },
  'seedream-5-pro': {
    catalogModelId: 'seedream-5-pro',
    adapterRevision: 'seedream-5-pro-adapter-v1',
    capabilityRevision: 'seedream-5-pro:image-v1',
    priceRevision: 'seedream-5-pro:price-v1',
    modality: 'image',
    operations: ['image.generate', 'image.edit'],
    dimensions: { min: 512, max: 4096 },
    maxReferenceAssets: 10,
    submissionMode: 'async',
    assetTtlSeconds: 3600,
    logicalTimeoutSeconds: 300,
    errorCodes: [
      'whitelist_required',
      'invalid_reference',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
    ],
    errorContracts: recordedMediaErrorContracts([
      'whitelist_required',
      'invalid_reference',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
    ]),
    cost: { amount: 0.06, currency: 'USD', unit: 'recorded_media_unit' },
  },
  'seedance-2': {
    catalogModelId: 'seedance-2',
    adapterRevision: 'seedance-2-adapter-v1',
    capabilityRevision: 'seedance-2:video-v1',
    priceRevision: 'seedance-2:price-v1',
    modality: 'video',
    operations: ['video.generate'],
    durationSeconds: { min: 1, max: 15 },
    outputContentType: 'video/mp4',
    submissionMode: 'async',
    assetTtlSeconds: 3600,
    logicalTimeoutSeconds: 900,
    errorCodes: [
      'whitelist_required',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
      'cancel_pending',
    ],
    errorContracts: recordedMediaErrorContracts([
      'whitelist_required',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
      'cancel_pending',
    ]),
    cost: { amount: 0.45, currency: 'USD', unit: 'recorded_media_unit' },
  },
  'kling-latest': {
    catalogModelId: 'kling-latest',
    adapterRevision: 'kling-latest-adapter-v1',
    capabilityRevision: 'kling-latest:video-v1',
    priceRevision: 'kling-latest:price-v1',
    modality: 'video',
    operations: ['video.generate'],
    durationSeconds: { min: 1, max: 10 },
    outputContentType: 'video/mp4',
    submissionMode: 'async',
    assetTtlSeconds: 3600,
    logicalTimeoutSeconds: 900,
    errorCodes: [
      'permission_missing',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
      'cancel_pending',
    ],
    errorContracts: recordedMediaErrorContracts([
      'permission_missing',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
      'cancel_pending',
    ]),
    cost: { amount: 0.52, currency: 'USD', unit: 'recorded_media_unit' },
  },
  'grok-latest-video': {
    catalogModelId: 'grok-latest-video',
    adapterRevision: 'grok-latest-video-adapter-v1',
    capabilityRevision: 'grok-latest-video:video-v1',
    priceRevision: 'grok-latest-video:price-v1',
    modality: 'video',
    operations: ['video.generate'],
    durationSeconds: { min: 1, max: 12 },
    outputContentType: 'video/mp4',
    submissionMode: 'async',
    assetTtlSeconds: 3000,
    logicalTimeoutSeconds: 900,
    errorCodes: [
      'preview_unavailable',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
      'cancel_pending',
    ],
    errorContracts: recordedMediaErrorContracts([
      'preview_unavailable',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
      'cancel_pending',
    ]),
    cost: { amount: 0.58, currency: 'USD', unit: 'recorded_media_unit' },
  },
  'veo-latest': {
    catalogModelId: 'veo-latest',
    adapterRevision: 'veo-latest-adapter-v1',
    capabilityRevision: 'veo-latest:video-v1',
    priceRevision: 'veo-latest:price-v1',
    modality: 'video',
    operations: ['video.generate'],
    durationSeconds: { min: 1, max: 10 },
    outputContentType: 'video/mp4',
    submissionMode: 'async',
    assetTtlSeconds: 2400,
    logicalTimeoutSeconds: 900,
    errorCodes: [
      'region_unavailable',
      'preview_unavailable',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
      'cancel_pending',
    ],
    errorContracts: recordedMediaErrorContracts([
      'region_unavailable',
      'preview_unavailable',
      'rate_limited',
      'acceptance_unknown',
      'logical_timeout',
      'download_failed',
      'cancel_pending',
    ]),
    cost: { amount: 0.64, currency: 'USD', unit: 'recorded_media_unit' },
  },
  'audio-speech-fixture': {
    catalogModelId: 'audio-speech-fixture',
    adapterRevision: 'audio-speech-fixture-adapter-v1',
    capabilityRevision: 'audio-speech-fixture:audio.speech-v1',
    priceRevision: 'audio-speech-fixture:price-v1',
    modality: 'audio',
    operations: ['audio.speech'],
    outputContentTypes: ['audio/mpeg', 'audio/wav'],
    submissionMode: 'async',
    assetTtlSeconds: 1800,
    logicalTimeoutSeconds: 120,
    errorCodes: ['logical_timeout', 'download_failed', 'cancel_pending'],
    errorContracts: recordedMediaErrorContracts([
      'logical_timeout',
      'download_failed',
      'cancel_pending',
    ]),
    cost: { amount: 0.01, currency: 'USD', unit: 'recorded_audio_unit' },
  },
  'audio-sfx-fixture': {
    catalogModelId: 'audio-sfx-fixture',
    adapterRevision: 'audio-sfx-fixture-adapter-v1',
    capabilityRevision: 'audio-sfx-fixture:audio.sfx-v1',
    priceRevision: 'audio-sfx-fixture:price-v1',
    modality: 'audio',
    operations: ['audio.sfx'],
    outputContentTypes: ['audio/mpeg', 'audio/wav'],
    submissionMode: 'async',
    assetTtlSeconds: 1800,
    logicalTimeoutSeconds: 120,
    errorCodes: ['logical_timeout', 'download_failed', 'cancel_pending'],
    errorContracts: recordedMediaErrorContracts([
      'logical_timeout',
      'download_failed',
      'cancel_pending',
    ]),
    cost: { amount: 0.01, currency: 'USD', unit: 'recorded_audio_unit' },
  },
} as const satisfies Record<string, RecordedMediaAdapterContract>;

function recordedMediaCost(contract: RecordedMediaAdapterContract, units = 1) {
  return {
    amount: units === 0 ? 0 : contract.cost.amount * units,
    currency: contract.cost.currency,
    usage: { mediaUnits: units },
  };
}

function recordedMediaError(
  contract: RecordedMediaAdapterContract,
  code: string,
  phase?: RecordedMediaErrorPhase
) {
  const error = contract.errorContracts.find(
    (candidate) =>
      candidate.code === code && (!phase || candidate.phase === phase)
  );
  if (!error) {
    throw new Error(
      `${contract.catalogModelId} does not declare ${code} for ${phase ?? 'any phase'}.`
    );
  }
  return error;
}

function recordedMediaFailure(
  error: RecordedMediaAdapterError,
  contract: RecordedMediaAdapterContract,
  taskRef?: string
): ProviderExecutionResponse {
  return {
    kind: 'failure',
    acceptance: error.contract.acceptance,
    ...(taskRef ? { providerTaskRef: taskRef } : {}),
    errorCode: error.code,
    retryable: error.contract.retryable,
    message: error.message,
    providerCost: recordedMediaCost(contract, error.contract.billable ? 1 : 0),
  };
}

function recordedTaskScope(request: ProviderExecutionRequest) {
  return {
    workspaceId: request.submission.workspaceId,
    credentialVersion:
      request.deployment.credentialVersion ?? 'recorded-credential-v1',
  };
}

function recordedMediaIsolationKey(request: ProviderExecutionRequest) {
  const scope = recordedTaskScope(request);
  return `${scope.workspaceId}:${request.deployment.id}:${scope.credentialVersion}`;
}

function assertRecordedTaskScope(
  task: RecordedMediaTask,
  request: ProviderExecutionRequest
) {
  const scope = recordedTaskScope(request);
  if (
    task.workspaceId !== scope.workspaceId ||
    task.credentialVersion !== scope.credentialVersion
  ) {
    throw new Error(
      'Provider task belongs to another workspace or credential.'
    );
  }
}

abstract class ImageRecordedAdapter implements ProviderExecutionPort {
  abstract readonly catalogModelId: string;
  abstract readonly contract: Extract<
    RecordedMediaAdapterContract,
    { modality: 'image' }
  >;
  protected readonly taskRefPrefix: string = 'recorded-task';
  private readonly tasks = new Map<string, RecordedMediaTask>();
  private readonly cooldownUntilByScope = new Map<string, number>();
  private nextPollStatus?: RecordedTaskStatus;
  private nextErrorCode?: string;

  setNextPollStatus(status: RecordedTaskStatus) {
    this.nextPollStatus = status;
  }

  setNextErrorCode(code: string) {
    recordedMediaError(this.contract, code);
    this.nextErrorCode = code;
  }

  get assetTtlSeconds() {
    return this.contract.assetTtlSeconds;
  }

  recoveryTaskRef(request: ProviderExecutionRequest) {
    return recordedTaskRef(
      this.catalogModelId,
      request.jobId,
      this.taskRefPrefix
    );
  }

  async submit(request: ProviderExecutionRequest) {
    this.validate(request);
    const isolationKey = recordedMediaIsolationKey(request);
    if ((this.cooldownUntilByScope.get(isolationKey) ?? 0) > Date.now()) {
      const cooldown = recordedMediaError(
        this.contract,
        'rate_limited',
        'submit'
      );
      throw new RecordedMediaAdapterError(
        cooldown,
        `${this.catalogModelId} deployment is cooling down for this workspace credential.`
      );
    }
    const submissionError = this.takeError('submit');
    if (submissionError) {
      if (submissionError.code === 'rate_limited') {
        this.cooldownUntilByScope.set(isolationKey, Date.now() + 30_000);
      }
      throw new RecordedMediaAdapterError(
        submissionError,
        `${this.catalogModelId} recorded ${submissionError.code}.`
      );
    }
    const createdAt = new Date();
    const scope = recordedTaskScope(request);
    const task: RecordedMediaTask = {
      taskRef: this.recoveryTaskRef(request),
      status: 'queued',
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + this.assetTtlSeconds * 1000
      ).toISOString(),
      deadlineAt: new Date(
        createdAt.getTime() + this.contract.logicalTimeoutSeconds * 1000
      ).toISOString(),
      ...scope,
    };
    this.tasks.set(task.taskRef, task);
    return structuredClone(task);
  }

  async poll(taskRef: string, request: ProviderExecutionRequest) {
    const task = this.requireTask(taskRef, request);
    const providerError = this.takeError('poll');
    if (providerError || Date.now() > Date.parse(task.deadlineAt)) {
      const timeout =
        providerError ??
        recordedMediaError(this.contract, 'logical_timeout', 'poll');
      task.status = 'failed';
      task.errorCode = timeout.code;
      task.retryable = timeout.retryable;
      return structuredClone(task);
    }
    task.status = this.nextPollStatus ?? 'completed';
    this.nextPollStatus = undefined;
    return structuredClone(task);
  }

  async cancel(taskRef: string, request: ProviderExecutionRequest) {
    const task = this.requireTask(taskRef, request);
    const providerError = this.takeError('cancel');
    task.status = 'cancel_requested';
    if (providerError) {
      task.errorCode = providerError.code;
      task.retryable = providerError.retryable;
    }
    return structuredClone(task);
  }

  async execute(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResponse> {
    let task: RecordedMediaTask;
    try {
      task = await this.submit(request);
    } catch (error) {
      if (error instanceof RecordedMediaAdapterError) {
        return recordedMediaFailure(error, this.contract);
      }
      throw error;
    }
    const terminal = await this.poll(task.taskRef, request);
    if (terminal.status === 'unknown') {
      return {
        kind: 'failure',
        acceptance: 'acceptance_unknown',
        errorCode: 'acceptance_unknown',
        retryable: false,
        message: `${this.catalogModelId} task state is unknown.`,
        providerCost: {
          ...recordedMediaCost(this.contract),
        },
      };
    }
    if (
      terminal.status === 'failed' ||
      terminal.status === 'cancel_requested'
    ) {
      const errorContract = terminal.errorCode
        ? recordedMediaError(this.contract, terminal.errorCode)
        : undefined;
      return {
        kind: 'failure',
        acceptance: errorContract?.acceptance ?? 'accepted',
        ...(terminal.errorCode ? { errorCode: terminal.errorCode } : {}),
        ...(terminal.retryable === undefined
          ? {}
          : { retryable: terminal.retryable }),
        message: `${this.catalogModelId} recorded ${terminal.status}.`,
        providerCost: recordedMediaCost(
          this.contract,
          errorContract?.billable === false ? 0 : 1
        ),
      };
    }
    let asset: Awaited<ReturnType<ImageRecordedAdapter['download']>>;
    try {
      asset = await this.download({ ...request, taskRef: task.taskRef });
    } catch (error) {
      if (error instanceof RecordedMediaAdapterError) {
        return recordedMediaFailure(error, this.contract, task.taskRef);
      }
      throw error;
    }
    return {
      kind: 'completed',
      providerTaskRef: task.taskRef,
      assetBytes: asset.bytes,
      contentType: asset.contentType,
      providerCost: recordedMediaCost(this.contract),
    };
  }

  async download(request: ProviderExecutionRequest & { taskRef: string }) {
    const task = this.requireTask(request.taskRef, request);
    const providerError = this.takeError('download');
    if (providerError) {
      throw new RecordedMediaAdapterError(
        providerError,
        `${this.catalogModelId} recorded ${providerError.code}.`
      );
    }
    return {
      bytes: RECORDED_PNG,
      contentType: 'image/png' as const,
      sourceExpiresAt: task.expiresAt,
    };
  }

  private validate(request: ProviderExecutionRequest) {
    if (
      request.model.id !== this.catalogModelId ||
      !this.contract.operations.includes(
        request.submission.operation as 'image.generate' | 'image.edit'
      )
    ) {
      throw new Error(
        `${this.catalogModelId} received an incompatible operation.`
      );
    }
    if (
      request.submission.operation === 'image.edit' &&
      !request.submission.input?.referenceAssetIds?.length
    ) {
      throw new Error(
        `${this.catalogModelId} image.edit requires at least one reference asset.`
      );
    }
    const width = request.submission.input?.width ?? 1024;
    const height = request.submission.input?.height ?? 1024;
    if (
      width < this.contract.dimensions.min ||
      height < this.contract.dimensions.min ||
      width > this.contract.dimensions.max ||
      height > this.contract.dimensions.max
    ) {
      throw new Error(
        `${this.catalogModelId} dimensions must be between ${this.contract.dimensions.min}px and ${this.contract.dimensions.max}px.`
      );
    }
    if (
      (request.submission.input?.referenceAssetIds?.length ?? 0) >
      this.contract.maxReferenceAssets
    ) {
      throw new Error(
        `${this.catalogModelId} accepts at most ${this.contract.maxReferenceAssets} reference assets.`
      );
    }
  }

  assertTaskScope(taskRef: string, request: ProviderExecutionRequest) {
    return this.requireTask(taskRef, request);
  }

  private takeError(phase: RecordedMediaErrorPhase) {
    if (!this.nextErrorCode) return undefined;
    const error = recordedMediaError(this.contract, this.nextErrorCode);
    if (error.phase !== phase) return undefined;
    this.nextErrorCode = undefined;
    return error;
  }

  private requireTask(taskRef: string, request?: ProviderExecutionRequest) {
    let task = this.tasks.get(taskRef);
    if (!task && request && taskRef === this.recoveryTaskRef(request)) {
      task = recoveredTask(taskRef, this.contract, request);
      this.tasks.set(taskRef, task);
    }
    if (!task) throw new Error(`Unknown provider task ${taskRef}.`);
    if (request) assertRecordedTaskScope(task, request);
    return task;
  }
}

export class GptImage2RecordedAdapter extends ImageRecordedAdapter {
  readonly catalogModelId = 'gpt-image-2';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['gpt-image-2'];
}
export class NanoBanana2RecordedAdapter extends ImageRecordedAdapter {
  readonly catalogModelId = 'nano-banana-2';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['nano-banana-2'];
}
export class NanoBananaProRecordedAdapter extends ImageRecordedAdapter {
  readonly catalogModelId = 'nano-banana-pro';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['nano-banana-pro'];
}
export class Seedream5ProRecordedAdapter extends ImageRecordedAdapter {
  readonly catalogModelId = 'seedream-5-pro';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['seedream-5-pro'];
}

export type RecordedTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'unknown'
  | 'cancel_requested';

export interface RecordedMediaTask {
  taskRef: string;
  status: RecordedTaskStatus;
  createdAt: string;
  expiresAt: string;
  deadlineAt: string;
  workspaceId: string;
  credentialVersion: string;
  errorCode?: string;
  retryable?: boolean;
}

abstract class VideoRecordedAdapter implements ProviderExecutionPort {
  abstract readonly catalogModelId: string;
  abstract readonly contract: Extract<
    RecordedMediaAdapterContract,
    { modality: 'video' }
  >;
  protected readonly taskRefPrefix: string = 'recorded-task';
  protected readonly tasks = new Map<string, RecordedMediaTask>();
  private readonly cooldownUntilByScope = new Map<string, number>();
  private nextPollStatus?: RecordedTaskStatus;
  private nextErrorCode?: string;

  setNextPollStatus(status: RecordedTaskStatus) {
    this.nextPollStatus = status;
  }

  setNextErrorCode(code: string) {
    recordedMediaError(this.contract, code);
    this.nextErrorCode = code;
  }

  get assetTtlSeconds() {
    return this.contract.assetTtlSeconds;
  }

  recoveryTaskRef(request: ProviderExecutionRequest) {
    return recordedTaskRef(
      this.catalogModelId,
      request.jobId,
      this.taskRefPrefix
    );
  }

  async submit(request: ProviderExecutionRequest): Promise<RecordedMediaTask> {
    if (
      request.model.id !== this.catalogModelId ||
      request.submission.operation !== 'video.generate'
    ) {
      throw new Error(
        `${this.catalogModelId} received an incompatible operation.`
      );
    }
    const duration = request.submission.input?.durationSeconds ?? 10;
    if (
      duration < this.contract.durationSeconds.min ||
      duration > this.contract.durationSeconds.max
    ) {
      throw new Error(
        `${this.catalogModelId} duration must be between ${this.contract.durationSeconds.min} and ${this.contract.durationSeconds.max} seconds.`
      );
    }
    const isolationKey = recordedMediaIsolationKey(request);
    if ((this.cooldownUntilByScope.get(isolationKey) ?? 0) > Date.now()) {
      const cooldown = recordedMediaError(
        this.contract,
        'rate_limited',
        'submit'
      );
      throw new RecordedMediaAdapterError(
        cooldown,
        `${this.catalogModelId} deployment is cooling down for this workspace credential.`
      );
    }
    const submissionError = this.takeError('submit');
    if (submissionError) {
      if (submissionError.code === 'rate_limited') {
        this.cooldownUntilByScope.set(isolationKey, Date.now() + 30_000);
      }
      throw new RecordedMediaAdapterError(
        submissionError,
        `${this.catalogModelId} recorded ${submissionError.code}.`
      );
    }
    const createdAt = new Date();
    const task: RecordedMediaTask = {
      taskRef: this.recoveryTaskRef(request),
      status: 'queued',
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + this.assetTtlSeconds * 1000
      ).toISOString(),
      deadlineAt: new Date(
        createdAt.getTime() + this.contract.logicalTimeoutSeconds * 1000
      ).toISOString(),
      ...recordedTaskScope(request),
    };
    this.tasks.set(task.taskRef, task);
    return structuredClone(task);
  }

  async poll(
    taskRef: string,
    request: ProviderExecutionRequest
  ): Promise<RecordedMediaTask> {
    const task = this.requireTask(taskRef, request);
    const providerError = this.takeError('poll');
    if (providerError || Date.now() > Date.parse(task.deadlineAt)) {
      const timeout =
        providerError ??
        recordedMediaError(this.contract, 'logical_timeout', 'poll');
      task.status = 'failed';
      task.errorCode = timeout.code;
      task.retryable = timeout.retryable;
      return structuredClone(task);
    }
    task.status = this.nextPollStatus ?? 'completed';
    this.nextPollStatus = undefined;
    return structuredClone(task);
  }

  async cancel(
    taskRef: string,
    request: ProviderExecutionRequest
  ): Promise<RecordedMediaTask> {
    const task = this.requireTask(taskRef, request);
    const providerError = this.takeError('cancel');
    task.status = 'cancel_requested';
    if (providerError) {
      task.errorCode = providerError.code;
      task.retryable = providerError.retryable;
    }
    return structuredClone(task);
  }

  async execute(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResponse> {
    let task: RecordedMediaTask;
    try {
      task = await this.submit(request);
    } catch (error) {
      if (error instanceof RecordedMediaAdapterError) {
        return recordedMediaFailure(error, this.contract);
      }
      throw error;
    }
    const terminal = await this.poll(task.taskRef, request);
    if (terminal.status === 'unknown') {
      return {
        kind: 'failure',
        acceptance: 'acceptance_unknown',
        errorCode: 'acceptance_unknown',
        retryable: false,
        message: `${this.catalogModelId} task state is unknown.`,
        providerCost: {
          ...recordedMediaCost(this.contract),
        },
      };
    }
    if (
      terminal.status === 'failed' ||
      terminal.status === 'cancel_requested'
    ) {
      const errorContract = terminal.errorCode
        ? recordedMediaError(this.contract, terminal.errorCode)
        : undefined;
      return {
        kind: 'failure',
        acceptance: errorContract?.acceptance ?? 'accepted',
        ...(terminal.errorCode ? { errorCode: terminal.errorCode } : {}),
        ...(terminal.retryable === undefined
          ? {}
          : { retryable: terminal.retryable }),
        message: `${this.catalogModelId} recorded ${terminal.status}.`,
        providerCost: recordedMediaCost(
          this.contract,
          errorContract?.billable === false ? 0 : 1
        ),
      };
    }
    let asset: {
      bytes: Uint8Array;
      contentType: 'video/mp4';
      sourceExpiresAt: string;
    };
    try {
      asset = await this.download({ ...request, taskRef: task.taskRef });
    } catch (error) {
      if (error instanceof RecordedMediaAdapterError) {
        return recordedMediaFailure(error, this.contract, task.taskRef);
      }
      throw error;
    }
    return {
      kind: 'completed',
      providerTaskRef: task.taskRef,
      assetBytes: asset.bytes,
      contentType: asset.contentType,
      providerCost: recordedMediaCost(this.contract),
    };
  }

  async download(request: ProviderExecutionRequest & { taskRef: string }) {
    const task = this.requireTask(request.taskRef, request);
    const providerError = this.takeError('download');
    if (providerError) {
      throw new RecordedMediaAdapterError(
        providerError,
        `${this.catalogModelId} recorded ${providerError.code}.`
      );
    }
    return {
      bytes: await recordedH264Video(),
      contentType: 'video/mp4' as const,
      sourceExpiresAt: task.expiresAt,
    };
  }

  assertTaskScope(taskRef: string, request: ProviderExecutionRequest) {
    return this.requireTask(taskRef, request);
  }

  private takeError(phase: RecordedMediaErrorPhase) {
    if (!this.nextErrorCode) return undefined;
    const error = recordedMediaError(this.contract, this.nextErrorCode);
    if (error.phase !== phase) return undefined;
    this.nextErrorCode = undefined;
    return error;
  }

  protected requireTask(taskRef: string, request?: ProviderExecutionRequest) {
    let task = this.tasks.get(taskRef);
    if (!task && request && taskRef === this.recoveryTaskRef(request)) {
      task = recoveredTask(taskRef, this.contract, request);
      this.tasks.set(taskRef, task);
    }
    if (!task) throw new Error(`Unknown provider task ${taskRef}.`);
    if (request) assertRecordedTaskScope(task, request);
    return task;
  }
}

export class Seedance2RecordedAdapter extends VideoRecordedAdapter {
  readonly catalogModelId = 'seedance-2';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['seedance-2'];
}
export class KlingLatestRecordedAdapter extends VideoRecordedAdapter {
  readonly catalogModelId = 'kling-latest';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['kling-latest'];
}
export class GrokLatestVideoRecordedAdapter extends VideoRecordedAdapter {
  readonly catalogModelId = 'grok-latest-video';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['grok-latest-video'];
}
export class VeoLatestRecordedAdapter extends VideoRecordedAdapter {
  readonly catalogModelId = 'veo-latest';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['veo-latest'];
}

abstract class AudioRecordedAdapter implements ProviderExecutionPort {
  abstract readonly catalogModelId: string;
  abstract readonly contract: Extract<
    RecordedMediaAdapterContract,
    { modality: 'audio' }
  >;
  private readonly tasks = new Map<string, RecordedMediaTask>();

  get assetTtlSeconds() {
    return this.contract.assetTtlSeconds;
  }

  recoveryTaskRef(request: ProviderExecutionRequest) {
    return recordedTaskRef(this.catalogModelId, request.jobId, 'recorded-audio');
  }

  async submit(request: ProviderExecutionRequest) {
    this.assertRequest(request);
    const createdAt = new Date();
    const task: RecordedMediaTask = {
      taskRef: this.recoveryTaskRef(request),
      status: 'queued',
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + this.assetTtlSeconds * 1000,
      ).toISOString(),
      deadlineAt: new Date(
        createdAt.getTime() + this.contract.logicalTimeoutSeconds * 1000,
      ).toISOString(),
      ...recordedTaskScope(request),
    };
    this.tasks.set(task.taskRef, task);
    return structuredClone(task);
  }

  async poll(taskRef: string, request: ProviderExecutionRequest) {
    const task = this.requireTask(taskRef, request);
    task.status = 'completed';
    return structuredClone(task);
  }

  async cancel(taskRef: string, request: ProviderExecutionRequest) {
    const task = this.requireTask(taskRef, request);
    task.status = 'cancel_requested';
    return structuredClone(task);
  }

  assertTaskScope(taskRef: string, request: ProviderExecutionRequest) {
    return structuredClone(this.requireTask(taskRef, request));
  }

  async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResponse> {
    const task = await this.submit(request);
    await this.poll(task.taskRef, request);
    const asset = await this.download({ ...request, taskRef: task.taskRef });
    return {
      kind: 'completed',
      providerTaskRef: task.taskRef,
      assetBytes: asset.bytes,
      contentType: asset.contentType,
      providerCost: recordedMediaCost(this.contract),
    };
  }

  async download(request: ProviderExecutionRequest & { taskRef: string }) {
    const task = this.requireTask(request.taskRef, request);
    const format = request.submission.input?.format === 'mp3' ? 'mp3' : 'wav';
    return {
      bytes: await recordedAudio(format),
      contentType:
        format === 'mp3' ? ('audio/mpeg' as const) : ('audio/wav' as const),
      sourceExpiresAt: task.expiresAt,
    };
  }

  private assertRequest(request: ProviderExecutionRequest) {
    if (request.model.id !== this.catalogModelId) {
      throw new Error(`${this.catalogModelId} received another catalog model.`);
    }
    if (request.submission.operation === 'audio.speech') {
      const input = request.submission.input ?? {};
      parseAudioSpeechContract({
        format: input.format,
        language: input.language,
        maxDurationSeconds: input.maxDurationSeconds,
        speed: input.speed,
        tone: input.tone,
        voice: input.voice,
      });
      return;
    }
    if (request.submission.operation === 'audio.sfx') {
      const input = request.submission.input ?? {};
      parseAudioSfxContract({
        description: request.submission.prompt,
        durationSeconds: input.durationSeconds,
        format: input.format,
      });
      return;
    }
    throw new Error(`${this.catalogModelId} received an incompatible operation.`);
  }

  private requireTask(taskRef: string, request: ProviderExecutionRequest) {
    let task = this.tasks.get(taskRef);
    if (!task && taskRef === this.recoveryTaskRef(request)) {
      task = recoveredTask(taskRef, this.contract, request);
      this.tasks.set(taskRef, task);
    }
    if (!task) throw new Error(`Unknown provider task ${taskRef}.`);
    assertRecordedTaskScope(task, request);
    return task;
  }
}

export class AudioSpeechRecordedAdapter extends AudioRecordedAdapter {
  readonly catalogModelId = 'audio-speech-fixture';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['audio-speech-fixture'];
}

export class AudioSfxRecordedAdapter extends AudioRecordedAdapter {
  readonly catalogModelId = 'audio-sfx-fixture';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['audio-sfx-fixture'];
}

abstract class ManagedMediaAdapter extends VideoRecordedAdapter {
  abstract readonly provider: 'fal' | 'replicate';

  async webhook(
    taskRef: string,
    status: RecordedTaskStatus,
    request: ProviderExecutionRequest
  ) {
    const task = this.requireTask(taskRef, request);
    task.status = status;
    return structuredClone(task);
  }

  async ingest(
    taskRef: string,
    scope: { workspaceId: string; credentialVersion: string },
    storage: ModelAssetStoragePort
  ): Promise<OwnedAsset> {
    const task = this.requireTask(taskRef);
    if (
      task.workspaceId !== scope.workspaceId ||
      task.credentialVersion !== scope.credentialVersion
    ) {
      throw new Error(
        'Provider task belongs to another workspace or credential.'
      );
    }
    return storage.persistGeneratedAsset({
      workspaceId: scope.workspaceId,
      bytes: await recordedH264Video(),
      contentType: 'video/mp4',
      sourceTaskRef: task.taskRef,
      sourceExpiresAt: task.expiresAt,
    });
  }
}

export class FalManagedMediaAdapter extends ManagedMediaAdapter {
  readonly catalogModelId = 'veo-latest';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['veo-latest'];
  readonly provider = 'fal' as const;
  protected readonly taskRefPrefix = 'fal-queue-task';
}

export class ReplicateManagedMediaAdapter extends ManagedMediaAdapter {
  readonly catalogModelId = 'veo-latest';
  readonly contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['veo-latest'];
  readonly provider = 'replicate' as const;
  protected readonly taskRefPrefix = 'replicate-prediction';
}

export class RecordedAdapterRouter
  implements ProviderExecutionPort, MediaProviderLifecyclePort
{
  private readonly adapters = new Map<string, ProviderExecutionPort>();

  constructor(adapters: ProviderExecutionPort[] = defaultRecordedAdapters()) {
    for (const adapter of adapters) {
      if (
        'catalogModelId' in adapter &&
        typeof adapter.catalogModelId === 'string'
      ) {
        this.adapters.set(adapter.catalogModelId, adapter);
      }
    }
  }

  async execute(request: ProviderExecutionRequest) {
    const adapter = this.adapters.get(request.model.id);
    if (!adapter)
      throw new Error(`No recorded adapter for ${request.model.id}.`);
    return adapter.execute(request);
  }

  async submit(request: MediaProviderEffectRequest) {
    const adapter = this.mediaAdapter(request.model.id);
    try {
      const task = await adapter.submit(request);
      return {
        acceptance: 'accepted' as const,
        taskRef: task.taskRef,
        sourceExpiresAt: task.expiresAt,
        providerCost: mediaCost(request),
      };
    } catch (error) {
      if (error instanceof RecordedMediaAdapterError) {
        return {
          acceptance: error.contract.acceptance,
          providerCost: recordedMediaCost(
            adapter.contract,
            error.contract.billable ? 1 : 0
          ),
          errorCode: error.code,
          retryable: error.contract.retryable,
          error: error.message,
        };
      }
      return {
        acceptance: 'rejected_before_accept' as const,
        providerCost: mediaCost(request, 0),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async recover(request: MediaProviderEffectRequest) {
    const adapter = this.mediaAdapter(request.model.id);
    const taskRef = adapter.recoveryTaskRef(request);
    const task = adapter.assertTaskScope(taskRef, request);
    return {
      acceptance: 'accepted' as const,
      taskRef,
      sourceExpiresAt: task.expiresAt,
      providerCost: mediaCost(request),
    };
  }

  async poll(request: ProviderExecutionRequest & { taskRef: string }) {
    const task = await this.mediaAdapter(request.model.id).poll(
      request.taskRef,
      request
    );
    return {
      status:
        task.status === 'cancel_requested' ? ('failed' as const) : task.status,
      providerCost: mediaCost(request),
      sourceExpiresAt: task.expiresAt,
      ...(task.errorCode ? { errorCode: task.errorCode } : {}),
      ...(task.retryable === undefined ? {} : { retryable: task.retryable }),
      ...(task.errorCode
        ? { error: `${request.model.id} recorded ${task.errorCode}.` }
        : {}),
    };
  }

  download(request: ProviderExecutionRequest & { taskRef: string }) {
    return this.mediaAdapter(request.model.id).download(request);
  }

  async cancel(request: ProviderExecutionRequest & { taskRef: string }) {
    const task = await this.mediaAdapter(request.model.id).cancel(
      request.taskRef,
      request
    );
    if (task.errorCode === 'cancel_pending') {
      return {
        status: 'pending' as const,
        errorCode: task.errorCode,
        retryable: task.retryable,
        error: `${request.model.id} cancellation is pending provider confirmation.`,
      };
    }
    return { status: 'cancelled' as const };
  }

  private mediaAdapter(catalogModelId: string) {
    const adapter = this.adapters.get(catalogModelId);
    if (!adapter || !isRecordedMediaAdapter(adapter)) {
      throw new Error(
        `No recorded media lifecycle adapter for ${catalogModelId}.`
      );
    }
    return adapter;
  }
}

interface RecordedMediaLifecycleAdapter extends ProviderExecutionPort {
  readonly contract: RecordedMediaAdapterContract;
  readonly assetTtlSeconds: number;
  submit(request: ProviderExecutionRequest): Promise<RecordedMediaTask>;
  poll(
    taskRef: string,
    request: ProviderExecutionRequest
  ): Promise<RecordedMediaTask>;
  cancel(
    taskRef: string,
    request: ProviderExecutionRequest
  ): Promise<RecordedMediaTask>;
  assertTaskScope(
    taskRef: string,
    request: ProviderExecutionRequest
  ): RecordedMediaTask;
  recoveryTaskRef(request: ProviderExecutionRequest): string;
  download(request: ProviderExecutionRequest & { taskRef: string }): Promise<{
    bytes: Uint8Array;
    contentType: OwnedAsset['contentType'];
    sourceExpiresAt?: string;
  }>;
}

function isRecordedMediaAdapter(
  adapter: ProviderExecutionPort
): adapter is RecordedMediaLifecycleAdapter {
  const candidate = adapter as Partial<RecordedMediaLifecycleAdapter>;
  return (
    typeof candidate.submit === 'function' &&
    typeof candidate.poll === 'function' &&
    typeof candidate.cancel === 'function' &&
    typeof candidate.assertTaskScope === 'function' &&
    typeof candidate.download === 'function'
  );
}

function recoveredTask(
  taskRef: string,
  contract: RecordedMediaAdapterContract,
  request: ProviderExecutionRequest
): RecordedMediaTask {
  const createdAt = new Date();
  return {
    taskRef,
    status: 'queued',
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(
      createdAt.getTime() + contract.assetTtlSeconds * 1000
    ).toISOString(),
    deadlineAt: new Date(
      createdAt.getTime() + contract.logicalTimeoutSeconds * 1000
    ).toISOString(),
    ...recordedTaskScope(request),
  };
}

function mediaCost(request: ProviderExecutionRequest, amount?: number) {
  const contract =
    RECORDED_MEDIA_ADAPTER_CONTRACTS[
      request.model.id as keyof typeof RECORDED_MEDIA_ADAPTER_CONTRACTS
    ];
  if (contract) {
    return recordedMediaCost(contract, amount === 0 ? 0 : 1);
  }
  return {
    amount: amount ?? (request.model.modality === 'video' ? 0.5 : 0.1),
    currency: 'USD' as const,
    usage: { mediaUnits: amount === 0 ? 0 : 1 },
  };
}

const RECORDED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zp3sAAAAASUVORK5CYII=',
  'base64'
);

function recordedH264Video() {
  recordedVideoFixture ??= createRecordedH264Video().catch((error) => {
    recordedVideoFixture = undefined;
    throw error;
  });
  return recordedVideoFixture;
}

async function createRecordedH264Video() {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-recorded-video-'));
  const outputPath = join(directory, 'fixture.mp4');
  try {
    await execFileAsync(
      resolveFfmpegPath(),
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=#d8b4ae:s=320x568:r=24',
        '-t',
        '1',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      { maxBuffer: 1024 * 1024 }
    );
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function recordedAudio(format: 'mp3' | 'wav') {
  let fixture = recordedAudioFixtures.get(format);
  if (!fixture) {
    fixture = createRecordedAudio(format).catch((error) => {
      recordedAudioFixtures.delete(format);
      throw error;
    });
    recordedAudioFixtures.set(format, fixture);
  }
  return fixture;
}

async function createRecordedAudio(format: 'mp3' | 'wav') {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-recorded-audio-'));
  const outputPath = join(directory, `fixture.${format}`);
  try {
    await execFileAsync(
      resolveFfmpegPath(),
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=24000:duration=1',
        '-map_metadata',
        '-1',
        ...(format === 'mp3'
          ? ['-c:a', 'libmp3lame', '-b:a', '64k']
          : ['-c:a', 'pcm_s16le']),
        outputPath,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function defaultRecordedAdapters(): ProviderExecutionPort[] {
  return [
    new OpenAiDirectRecordedAdapter(),
    new AnthropicDirectRecordedAdapter(),
    new GeminiDirectRecordedAdapter(),
    new CustomDirectRecordedAdapter(),
    new GptImage2RecordedAdapter(),
    new NanoBanana2RecordedAdapter(),
    new NanoBananaProRecordedAdapter(),
    new Seedream5ProRecordedAdapter(),
    new Seedance2RecordedAdapter(),
    new KlingLatestRecordedAdapter(),
    new GrokLatestVideoRecordedAdapter(),
    new VeoLatestRecordedAdapter(),
    new AudioSpeechRecordedAdapter(),
    new AudioSfxRecordedAdapter(),
  ];
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
}

class ConfiguredMediaExecutionPort
  implements ProviderExecutionPort, MediaProviderLifecyclePort
{
  constructor(
    private readonly fallback: ProviderExecutionPort,
    private readonly ark?: ArkMediaExecutionPort,
    private readonly tuzi?: TuziMediaExecutionPort
  ) {}

  private provider(request: ProviderExecutionRequest) {
    if (request.deployment.executionChannelId?.includes('tuzi')) {
      if (this.tuzi) return this.tuzi;
    } else if (this.ark) {
      return this.ark;
    }
    return this.tuzi ?? this.ark;
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
}

function withConfiguredMedia(
  runtime: ModelExecutionRuntime,
  arkOptions: ArkMediaExecutionOptions | undefined,
  tuziOptions: TuziMediaExecutionOptions | undefined
): ModelExecutionRuntime {
  if (!arkOptions && !tuziOptions) return runtime;
  const media = new ConfiguredMediaExecutionPort(
    runtime.execution,
    arkOptions ? new ArkMediaExecutionPort(arkOptions) : undefined,
    tuziOptions ? new TuziMediaExecutionPort(tuziOptions) : undefined
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
  };
}

class GatewayLlmRecordedMediaExecutionPort
  implements ProviderExecutionPort, MediaProviderLifecyclePort
{
  private readonly gateway: RecordedGatewayPocPort;
  private readonly media: RecordedAdapterRouter;

  constructor(channel: 'bifrost' | 'litellm') {
    this.gateway = new RecordedGatewayPocPort(channel);
    this.media = new RecordedAdapterRouter([
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
}

function recordedTaskRef(
  catalogModelId: string,
  jobId: string,
  prefix = 'recorded-task'
) {
  return `${prefix}-${digest(`${catalogModelId}:${jobId}`).slice(0, 20)}`;
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
      options.tuziMedia
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
      options.tuziMedia
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
      options.tuziMedia
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
      options.tuziMedia
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
    options.tuziMedia
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
