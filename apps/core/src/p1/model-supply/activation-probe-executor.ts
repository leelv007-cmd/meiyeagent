import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  ActivationProbeExecutionPort,
  ActivationProbeRun,
} from './foundation-module.js';
import type {
  CatalogModel,
  MediaProviderEffectRequest,
  MediaProviderLifecyclePort,
  ModelDeployment,
  ModelOperation,
} from './index.js';

const IMAGE_PROMPT =
  'A clean product still life of a white skincare bottle on beige stone, soft daylight, no people, no text, no logo.';
const IMAGE_EDIT_PROMPT =
  'Keep the product unchanged and replace only the background with warm beige stone, soft daylight, no people, no text, no logo.';
const IMAGE_EDIT_REFERENCE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const IMAGE_EDIT_REFERENCE_ID = 'activation-probe-sanitized-image';
const IMAGE_EDIT_REFERENCE_URL = `data:image/png;base64,${IMAGE_EDIT_REFERENCE_BYTES.toString('base64')}`;
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
    readonly retryable: boolean,
    readonly providerCost?: NonNullable<ActivationProbeRun['providerCost']>
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
        input.operation !== 'image.edit' &&
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
      ...(contract.resolvedInputAssets
        ? { resolvedInputAssets: contract.resolvedInputAssets }
        : {}),
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

  private async submit(input: MediaActivationProbeInput) {
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
        receipt.retryable ?? receipt.acceptance === 'acceptance_unknown',
        estimatedProviderCost(receipt.providerCost)
      );
    }
    return { receipt, request, taskRef: receipt.taskRef };
  }

  async execute(input: MediaActivationProbeInput) {
    const { receipt, request, taskRef } = await this.submit(input);

    let state: Awaited<ReturnType<MediaProviderLifecyclePort['poll']>> | null =
      null;
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      try {
        state = await this.provider.poll({
          ...request,
          taskRef,
        });
      } catch {
        throw new MediaActivationProbeError('poll', 'provider_exception', true);
      }
      if (state.status === 'completed') break;
      if (state.status === 'failed') {
        throw new MediaActivationProbeError(
          'poll',
          state.errorCode ?? 'provider_failed',
          state.retryable ?? false,
          estimatedProviderCost(state.providerCost)
        );
      }
      if (attempt + 1 < this.maxPollAttempts) {
        await this.sleep(this.pollIntervalMs);
      }
    }
    if (!state || state.status !== 'completed') {
      throw new MediaActivationProbeError(
        'poll',
        'timeout',
        true,
        state ? estimatedProviderCost(state.providerCost) : undefined
      );
    }
    const observedProviderCost = providerCostEvidence(
      state.providerCost,
      'observed'
    );
    let downloaded: Awaited<ReturnType<MediaProviderLifecyclePort['download']>>;
    try {
      downloaded = await this.provider.download({
        ...request,
        taskRef,
      });
    } catch {
      throw new MediaActivationProbeError(
        'download',
        'provider_exception',
        true,
        observedProviderCost
      );
    }
    if (downloaded.bytes.byteLength === 0) {
      throw new MediaActivationProbeError(
        'download',
        'empty_asset',
        false,
        observedProviderCost
      );
    }
    const expectedContentType = activationProbeContract(
      input.operation
    ).contentType;
    if (downloaded.contentType !== expectedContentType) {
      throw new MediaActivationProbeError(
        'download',
        'unexpected_asset_type',
        false,
        observedProviderCost
      );
    }
    return {
      outputDigestSource: {
        contentType: downloaded.contentType,
        sha256: createHash('sha256').update(downloaded.bytes).digest('hex'),
        sizeBytes: downloaded.bytes.byteLength,
      },
      providerCost: observedProviderCost,
    };
  }

  async executeCancellation(input: MediaActivationProbeInput) {
    if (input.operation !== 'video.generate') {
      throw new MediaActivationProbeError(
        'cancel',
        'unsupported_operation',
        false
      );
    }
    const { receipt, request, taskRef } = await this.submit(input);
    const cancellation = await this.cancel({
      ...input,
      taskRef,
    });
    if (!cancellation || cancellation.status !== 'cancelled') {
      throw new MediaActivationProbeError(
        'cancel',
        cancellation?.errorCode ?? 'cancellation_unconfirmed',
        cancellation?.retryable ?? true,
        estimatedProviderCost(receipt.providerCost)
      );
    }
    let confirmation: Awaited<ReturnType<MediaProviderLifecyclePort['poll']>>;
    try {
      confirmation = await this.provider.poll({
        ...request,
        taskRef,
      });
    } catch {
      throw new MediaActivationProbeError(
        'cancel',
        'confirmation_failed',
        true,
        estimatedProviderCost(receipt.providerCost)
      );
    }
    const confirmationCost = providerCostEvidence(
      confirmation.providerCost,
      confirmation.status === 'completed' || confirmation.status === 'failed'
        ? 'observed'
        : 'estimated'
    );
    if (
      confirmation.status !== 'failed' ||
      confirmation.errorCode !== 'provider_cancelled'
    ) {
      throw new MediaActivationProbeError(
        'cancel',
        'cancellation_unconfirmed',
        confirmation.status === 'queued' || confirmation.status === 'running',
        confirmationCost
      );
    }
    return {
      providerCost: confirmationCost,
      status: 'cancelled' as const,
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

function estimatedProviderCost(
  providerCost: Omit<
    NonNullable<ActivationProbeRun['providerCost']>,
    'status'
  >
) {
  return providerCostEvidence(providerCost, 'estimated');
}

function providerCostEvidence<
  Status extends NonNullable<ActivationProbeRun['providerCost']>['status'],
>(
  providerCost: Omit<
    NonNullable<ActivationProbeRun['providerCost']>,
    'status'
  >,
  status: Status
) {
  return {
    amount: providerCost.amount,
    currency: providerCost.currency,
    status,
    usage: structuredClone(providerCost.usage),
  };
}

function activationProbeContract(operation: ModelOperation) {
  if (operation === 'image.generate') {
    return {
      contentType: 'image/png' as const,
      input: {},
      prompt: IMAGE_PROMPT,
    };
  }
  if (operation === 'image.edit') {
    return {
      contentType: 'image/png' as const,
      input: {
        inputAssets: [
          { assetId: IMAGE_EDIT_REFERENCE_ID, role: 'reference_image' as const },
        ],
      },
      prompt: IMAGE_EDIT_PROMPT,
      resolvedInputAssets: [
        {
          assetId: IMAGE_EDIT_REFERENCE_ID,
          bytes: IMAGE_EDIT_REFERENCE_BYTES,
          contentType: 'image/png',
          kind: 'resolved' as const,
          providerReadableUrl: IMAGE_EDIT_REFERENCE_URL,
          role: 'reference_image' as const,
          sha256: createHash('sha256')
            .update(IMAGE_EDIT_REFERENCE_BYTES)
            .digest('hex'),
        },
      ],
    };
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
