import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ActivationProbeExecutionPort } from './foundation-module.js';
import type {
  CatalogModel,
  MediaProviderEffectRequest,
  MediaProviderLifecyclePort,
  ModelDeployment,
  ModelOperation,
} from './index.js';

const IMAGE_PROMPT =
  'A clean product still life of a white skincare bottle on beige stone, soft daylight, no people, no text, no logo.';
const VIDEO_PROMPT =
  'A white skincare bottle on beige stone, slow camera push in, soft daylight, no people, no text, no logo.';
const AUDIO_SPEECH_PROMPT = '欢迎体验本次门店服务。';
const AUDIO_SFX_PROMPT = 'A soft spa chime with a short natural decay.';

export interface MediaActivationProbeInput {
  actorId: string;
  catalogModelId: string;
  correlationId: string;
  deploymentId: string;
  idempotencyKey: string;
  operation: ModelOperation;
  workspaceId: string;
}

export class MediaActivationProbeError extends Error {
  readonly failureCategory: string;

  constructor(
    readonly phase: 'submit' | 'poll' | 'download' | 'cancel',
    readonly errorCode: string,
    readonly retryable: boolean
  ) {
    super(`Media activation probe failed during ${phase}.`);
    this.name = 'MediaActivationProbeError';
    this.failureCategory = `${phase}:${errorCode}`;
  }
}

export class MediaActivationProbeExecutor
  implements ActivationProbeExecutionPort
{
  private readonly maxPollAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly provider: MediaProviderLifecyclePort,
    private readonly catalog: {
      deployments: readonly ModelDeployment[];
      models: readonly CatalogModel[];
    },
    options: {
      maxPollAttempts?: number;
      pollIntervalMs?: number;
      sleep?: (milliseconds: number) => Promise<void>;
    } = {}
  ) {
    this.maxPollAttempts = options.maxPollAttempts ?? 90;
    this.pollIntervalMs = options.pollIntervalMs ?? 10_000;
    this.sleep = options.sleep ?? ((milliseconds) => delay(milliseconds));
  }

  private request(input: MediaActivationProbeInput) {
    const model = this.catalog.models.find(
      (candidate) => candidate.id === input.catalogModelId
    );
    const deployment = this.catalog.deployments.find(
      (candidate) => candidate.id === input.deploymentId
    );
    if (
      !model ||
      !deployment ||
      deployment.catalogModelId !== model.id ||
      (input.operation !== 'image.generate' &&
        input.operation !== 'video.generate' &&
        input.operation !== 'audio.speech' &&
        input.operation !== 'audio.sfx')
    ) {
      throw new MediaActivationProbeError(
        'submit',
        'deployment_not_configured',
        false
      );
    }
    const contract = activationProbeContract(input.operation);
    return {
      deployment,
      effectIdempotencyKey: input.idempotencyKey,
      jobId: input.idempotencyKey,
      model,
      submission: {
        actorId: input.actorId,
        correlationId: input.correlationId,
        dataClass: [],
        idempotencyKey: input.idempotencyKey,
        input: contract.input,
        operation: input.operation,
        productUsageQuantity: 0,
        prompt: contract.prompt,
        selection: { catalogModelId: model.id, mode: 'fixed' },
        workspaceId: input.workspaceId,
      },
    } satisfies MediaProviderEffectRequest;
  }

  async execute(input: MediaActivationProbeInput) {
    const request = this.request(input);
    let receipt: Awaited<ReturnType<MediaProviderLifecyclePort['submit']>>;
    try {
      receipt = await this.provider.submit(request);
    } catch {
      throw new MediaActivationProbeError('submit', 'provider_exception', true);
    }
    if (receipt.acceptance !== 'accepted' || !receipt.taskRef) {
      throw new MediaActivationProbeError(
        'submit',
        receipt.errorCode ?? receipt.acceptance,
        receipt.retryable ?? receipt.acceptance === 'acceptance_unknown'
      );
    }

    let state: Awaited<ReturnType<MediaProviderLifecyclePort['poll']>> | null =
      null;
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      try {
        state = await this.provider.poll({
          ...request,
          taskRef: receipt.taskRef,
        });
      } catch {
        throw new MediaActivationProbeError('poll', 'provider_exception', true);
      }
      if (state.status === 'completed') break;
      if (state.status === 'failed') {
        throw new MediaActivationProbeError(
          'poll',
          state.errorCode ?? 'provider_failed',
          state.retryable ?? false
        );
      }
      if (attempt + 1 < this.maxPollAttempts) {
        await this.sleep(this.pollIntervalMs);
      }
    }
    if (!state || state.status !== 'completed') {
      throw new MediaActivationProbeError('poll', 'timeout', true);
    }
    let downloaded: Awaited<ReturnType<MediaProviderLifecyclePort['download']>>;
    try {
      downloaded = await this.provider.download({
        ...request,
        taskRef: receipt.taskRef,
      });
    } catch {
      throw new MediaActivationProbeError(
        'download',
        'provider_exception',
        true
      );
    }
    if (downloaded.bytes.byteLength === 0) {
      throw new MediaActivationProbeError('download', 'empty_asset', false);
    }
    const expectedContentType = activationProbeContract(
      input.operation
    ).contentType;
    if (downloaded.contentType !== expectedContentType) {
      throw new MediaActivationProbeError(
        'download',
        'unexpected_asset_type',
        false
      );
    }
    return {
      outputDigestSource: {
        contentType: downloaded.contentType,
        sha256: createHash('sha256').update(downloaded.bytes).digest('hex'),
        sizeBytes: downloaded.bytes.byteLength,
      },
      providerCost: {
        amount: state.providerCost.amount,
        currency: state.providerCost.currency,
        status: 'observed' as const,
        usage: structuredClone(state.providerCost.usage),
      },
    };
  }

  async cancel(input: MediaActivationProbeInput & { taskRef: string }) {
    const request = this.request(input);
    try {
      return await this.provider.cancel({ ...request, taskRef: input.taskRef });
    } catch {
      throw new MediaActivationProbeError('cancel', 'provider_exception', true);
    }
  }
}

function activationProbeContract(operation: ModelOperation) {
  if (operation === 'image.generate') {
    return { contentType: 'image/png' as const, input: {}, prompt: IMAGE_PROMPT };
  }
  if (operation === 'video.generate') {
    return {
      contentType: 'video/mp4' as const,
      input: { durationSeconds: 5 },
      prompt: VIDEO_PROMPT,
    };
  }
  if (operation === 'audio.speech') {
    return {
      contentType: 'audio/wav' as const,
      input: {
        format: 'wav',
        language: 'zh-CN',
        maxDurationSeconds: 30,
        speed: 1,
        tone: 'natural',
        voice: 'default',
      },
      prompt: AUDIO_SPEECH_PROMPT,
    };
  }
  if (operation === 'audio.sfx') {
    return {
      contentType: 'audio/wav' as const,
      input: { durationSeconds: 3, format: 'wav' },
      prompt: AUDIO_SFX_PROMPT,
    };
  }
  throw new MediaActivationProbeError('submit', 'unsupported_operation', false);
}
