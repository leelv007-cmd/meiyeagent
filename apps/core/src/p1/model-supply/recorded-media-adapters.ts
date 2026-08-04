/**
 * Recorded/fake media adapters (image/video/audio) extracted from adapters.ts
 * for MP-04I lifecycle conformance (health/drain) without parallel-edit risk.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveFfmpegPath } from './media-tool-paths.js';
import type { ProviderExecutionPort } from '../foundation/ports.js';
import {
  parseAudioSfxContract,
  parseAudioSpeechContract,
} from './audio-contracts.js';
import type {
  MediaProviderDrainMode,
  MediaProviderEffectRequest,
  MediaProviderHealthReport,
  MediaProviderLifecyclePort,
  MediaProviderSubmissionReceipt,
  ModelAssetStoragePort,
  ModelOperation,
  OwnedAsset,
  ProviderExecutionRequest,
  ProviderExecutionResponse,
} from './index.js';
import {
  getSharedRecordedHealthOverlay,
  healthOverlayIsolationTargetId,
  isHealthOverlayBlocking,
} from '../supply-registry/health-overlay.js';

const execFileAsync = promisify(execFile);
const recordedVideoFixtures = new Map<string, Promise<Buffer>>();
const recordedAudioFixtures = new Map<'mp3' | 'wav', Promise<Buffer>>();

function digest(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
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
  'seedream-4-5': {
    catalogModelId: 'seedream-4-5',
    adapterRevision: 'seedream-4-5-adapter-v1',
    capabilityRevision: 'seedream-4-5:image-v1',
    priceRevision: 'seedream-4-5:price-v1',
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
    cost: { amount: 0.05, currency: 'USD', unit: 'recorded_media_unit' },
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
  'seedance-1-5-pro': {
    catalogModelId: 'seedance-1-5-pro',
    adapterRevision: 'seedance-1-5-pro-adapter-v1',
    capabilityRevision: 'seedance-1-5-pro:video-v1',
    priceRevision: 'seedance-1-5-pro:price-v1',
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

type RecordedMediaCatalogModelId = keyof typeof RECORDED_MEDIA_ADAPTER_CONTRACTS;
type RecordedMediaCatalogModelIdFor<
  Modality extends RecordedMediaAdapterContract['modality'],
> = {
  [CatalogModelId in RecordedMediaCatalogModelId]:
    (typeof RECORDED_MEDIA_ADAPTER_CONTRACTS)[CatalogModelId]['modality'] extends Modality
      ? CatalogModelId
      : never;
}[RecordedMediaCatalogModelId];
type ImageRecordedCatalogModelId = RecordedMediaCatalogModelIdFor<'image'>;
type VideoRecordedCatalogModelId = RecordedMediaCatalogModelIdFor<'video'>;
type AudioRecordedCatalogModelId = RecordedMediaCatalogModelIdFor<'audio'>;

function recordedMediaCost(
  contract: RecordedMediaAdapterContract,
  units = 1,
  currencyOverride?: 'CNY' | 'USD',
) {
  return {
    amount: units === 0 ? 0 : contract.cost.amount * units,
    currency: currencyOverride ?? contract.cost.currency,
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

class ImageRecordedAdapter implements ProviderExecutionPort {
  readonly contract: Extract<
    RecordedMediaAdapterContract,
    { modality: 'image' }
  >;
  protected readonly taskRefPrefix: string = 'recorded-task';
  private readonly tasks = new Map<string, RecordedMediaTask>();
  /** G4 / F-G-05: shared process overlay (single map owner across recorded adapters). */
  private readonly healthOverlay = getSharedRecordedHealthOverlay();
  private nextPollStatus?: RecordedTaskStatus;
  private nextErrorCode?: string;

  constructor(readonly catalogModelId: ImageRecordedCatalogModelId) {
    this.contract = RECORDED_MEDIA_ADAPTER_CONTRACTS[catalogModelId];
  }

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
    const isolationKey = healthOverlayIsolationTargetId({
      workspaceId: request.submission.workspaceId,
      deploymentId: request.deployment.id,
      credentialVersion: recordedTaskScope(request).credentialVersion,
    });
    const overlay = await this.healthOverlay.get('deployment', isolationKey);
    if (isHealthOverlayBlocking(overlay?.state)) {
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
        // I reports failure fact; G owns overlay SM (rate_limited → cooldown).
        await this.healthOverlay.reportFact({
          targetKind: 'deployment',
          targetId: isolationKey,
          kind: 'rate_limited',
          reason: 'rate_limited',
          source: 'recorded_image_adapter',
        });
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
    const referenceAssetCount =
      request.submission.input?.inputAssets?.filter(
        ({ role }) => role === 'reference_image',
      ).length ??
      request.submission.input?.referenceAssetIds?.length ??
      0;
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
      referenceAssetCount === 0
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
      referenceAssetCount > this.contract.maxReferenceAssets
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

class VideoRecordedAdapter implements ProviderExecutionPort {
  readonly contract: Extract<
    RecordedMediaAdapterContract,
    { modality: 'video' }
  >;
  protected readonly taskRefPrefix: string = 'recorded-task';
  protected readonly tasks = new Map<string, RecordedMediaTask>();
  /** G4 / F-G-05: shared process overlay (single map owner across recorded adapters). */
  private readonly healthOverlay = getSharedRecordedHealthOverlay();
  private nextPollStatus?: RecordedTaskStatus;
  private nextErrorCode?: string;

  constructor(
    readonly catalogModelId: VideoRecordedCatalogModelId = 'veo-latest',
  ) {
    this.contract = RECORDED_MEDIA_ADAPTER_CONTRACTS[catalogModelId];
  }

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
    const isolationKey = healthOverlayIsolationTargetId({
      workspaceId: request.submission.workspaceId,
      deploymentId: request.deployment.id,
      credentialVersion: recordedTaskScope(request).credentialVersion,
    });
    const overlay = await this.healthOverlay.get('deployment', isolationKey);
    if (isHealthOverlayBlocking(overlay?.state)) {
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
        // I reports failure fact; G owns overlay SM (rate_limited → cooldown).
        await this.healthOverlay.reportFact({
          targetKind: 'deployment',
          targetId: isolationKey,
          kind: 'rate_limited',
          reason: 'rate_limited',
          source: 'recorded_video_adapter',
        });
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

class AudioRecordedAdapter implements ProviderExecutionPort {
  readonly contract: Extract<
    RecordedMediaAdapterContract,
    { modality: 'audio' }
  >;
  private readonly tasks = new Map<string, RecordedMediaTask>();

  constructor(readonly catalogModelId: AudioRecordedCatalogModelId) {
    this.contract = RECORDED_MEDIA_ADAPTER_CONTRACTS[catalogModelId];
  }

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
  readonly provider = 'fal' as const;
  protected readonly taskRefPrefix = 'fal-queue-task';
}

export class ReplicateManagedMediaAdapter extends ManagedMediaAdapter {
  readonly provider = 'replicate' as const;
  protected readonly taskRefPrefix = 'replicate-prediction';
}

type RecordedMediaAdapterFor<CatalogModelId extends RecordedMediaCatalogModelId> =
  (typeof RECORDED_MEDIA_ADAPTER_CONTRACTS)[CatalogModelId]['modality'] extends 'image'
    ? ImageRecordedAdapter
    : (typeof RECORDED_MEDIA_ADAPTER_CONTRACTS)[CatalogModelId]['modality'] extends 'video'
      ? VideoRecordedAdapter
      : AudioRecordedAdapter;

export function createRecordedMediaAdapter<
  CatalogModelId extends RecordedMediaCatalogModelId,
>(catalogModelId: CatalogModelId): RecordedMediaAdapterFor<CatalogModelId> {
  const contract = RECORDED_MEDIA_ADAPTER_CONTRACTS[catalogModelId];
  switch (contract.modality) {
    case 'image':
      return new ImageRecordedAdapter(
        catalogModelId as ImageRecordedCatalogModelId,
      ) as RecordedMediaAdapterFor<CatalogModelId>;
    case 'video':
      return new VideoRecordedAdapter(
        catalogModelId as VideoRecordedCatalogModelId,
      ) as RecordedMediaAdapterFor<CatalogModelId>;
    case 'audio':
      return new AudioRecordedAdapter(
        catalogModelId as AudioRecordedCatalogModelId,
      ) as RecordedMediaAdapterFor<CatalogModelId>;
  }
}

export function defaultRecordedMediaAdapters(): ProviderExecutionPort[] {
  return (Object.keys(RECORDED_MEDIA_ADAPTER_CONTRACTS) as RecordedMediaCatalogModelId[])
    .map((catalogModelId) => createRecordedMediaAdapter(catalogModelId));
}

export interface RecordedMediaRouterOptions {
  costCurrencyOverride?: 'CNY' | 'USD';
}

export class RecordedAdapterRouter
  implements ProviderExecutionPort, MediaProviderLifecyclePort
{
  private readonly adapters = new Map<string, ProviderExecutionPort>();
  /** Accepted receipts keyed by recovery task ref for idempotent drain replay. */
  private readonly acceptedReceipts = new Map<
    string,
    {
      taskRef: string;
      sourceExpiresAt?: string;
      providerCost: ReturnType<typeof mediaCost>;
    }
  >();
  private drainMode: MediaProviderDrainMode = 'accepting';
  private lastHealth: MediaProviderHealthReport = {
    state: 'healthy',
    reason: 'adapter_ready',
    source: 'adapter',
    observedAt: new Date(0).toISOString(),
  };

  constructor(
    adapters: ProviderExecutionPort[] = defaultRecordedMediaAdapters(),
    private readonly options: RecordedMediaRouterOptions = {},
  ) {
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

  async submit(
    request: MediaProviderEffectRequest,
  ): Promise<MediaProviderSubmissionReceipt> {
    const adapter = this.mediaAdapter(request.model.id);
    const recoveryRef = adapter.recoveryTaskRef(request);
    const prior = this.acceptedReceipts.get(recoveryRef);
    if (prior) {
      return {
        acceptance: 'accepted',
        taskRef: prior.taskRef,
        ...(prior.sourceExpiresAt
          ? { sourceExpiresAt: prior.sourceExpiresAt }
          : {}),
        providerCost: prior.providerCost,
      };
    }
    if (this.drainMode === 'draining') {
      return {
        acceptance: 'rejected_before_accept',
        providerCost: mediaCost(
          request,
          0,
          this.options.costCurrencyOverride,
        ),
        errorCode: 'channel_draining',
        retryable: false,
        error:
          'Recorded media channel is draining; new submissions are rejected while in-flight tasks continue.',
      };
    }
    try {
      const task = await adapter.submit(request);
      const providerCost = mediaCost(
        request,
        undefined,
        this.options.costCurrencyOverride,
      );
      this.acceptedReceipts.set(recoveryRef, {
        taskRef: task.taskRef,
        sourceExpiresAt: task.expiresAt,
        providerCost,
      });
      this.lastHealth = {
        state: 'healthy',
        reason: 'submit_accepted',
        source: 'adapter',
        observedAt: new Date().toISOString(),
        drainMode: this.drainMode,
      };
      return {
        acceptance: 'accepted',
        taskRef: task.taskRef,
        sourceExpiresAt: task.expiresAt,
        providerCost,
      };
    } catch (error) {
      if (error instanceof RecordedMediaAdapterError) {
        this.lastHealth = {
          state:
            error.contract.code === 'rate_limited' ? 'cooldown' : 'degraded',
          reason: error.contract.code,
          source: 'adapter',
          observedAt: new Date().toISOString(),
          drainMode: this.drainMode,
        };
        return {
          acceptance: error.contract.acceptance,
          providerCost: recordedMediaCost(
            adapter.contract,
            error.contract.billable ? 1 : 0,
            this.options.costCurrencyOverride,
          ),
          errorCode: error.code,
          retryable: error.contract.retryable,
          error: error.message,
        };
      }
      return {
        acceptance: 'rejected_before_accept',
        providerCost: mediaCost(
          request,
          0,
          this.options.costCurrencyOverride,
        ),
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
      providerCost: mediaCost(
        request,
        undefined,
        this.options.costCurrencyOverride,
      ),
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
      providerCost: mediaCost(
        request,
        undefined,
        this.options.costCurrencyOverride,
      ),
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

  reportHealth(): MediaProviderHealthReport {
    return {
      ...this.lastHealth,
      drainMode: this.drainMode,
      observedAt: new Date().toISOString(),
    };
  }

  setDrainMode(mode: MediaProviderDrainMode) {
    this.drainMode = mode;
    this.lastHealth = {
      state: mode === 'draining' ? 'degraded' : 'healthy',
      reason: mode === 'draining' ? 'channel_draining' : 'drain_cleared',
      source: 'adapter',
      observedAt: new Date().toISOString(),
      drainMode: mode,
    };
  }

  getDrainMode(): MediaProviderDrainMode {
    return this.drainMode;
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

function mediaCost(
  request: ProviderExecutionRequest,
  amount?: number,
  currencyOverride?: 'CNY' | 'USD',
) {
  const contract =
    RECORDED_MEDIA_ADAPTER_CONTRACTS[
      request.model.id as keyof typeof RECORDED_MEDIA_ADAPTER_CONTRACTS
    ];
  if (contract) {
    return recordedMediaCost(
      contract,
      amount === 0 ? 0 : 1,
      currencyOverride,
    );
  }
  return {
    amount: amount ?? (request.model.modality === 'video' ? 0.5 : 0.1),
    currency: currencyOverride ?? ('USD' as const),
    usage: { mediaUnits: amount === 0 ? 0 : 1 },
  };
}

const RECORDED_PNG = Buffer.from(
  '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'.replaceAll(
    ' ',
    '',
  ),
  'base64'
);

export function recordedH264Video(options: {
  durationSeconds?: number;
  height?: number;
  width?: number;
} = {}) {
  const durationSeconds =
    typeof options.durationSeconds === 'number' && options.durationSeconds > 0
      ? options.durationSeconds
      : 1;
  const width =
    typeof options.width === 'number' && options.width > 0
      ? options.width
      : 320;
  const height =
    typeof options.height === 'number' && options.height > 0
      ? options.height
      : 568;
  const key = `${width}x${height}:${durationSeconds}`;
  let fixture = recordedVideoFixtures.get(key);
  if (!fixture) {
    fixture = createRecordedH264Video({ durationSeconds, height, width }).catch(
      (error) => {
        recordedVideoFixtures.delete(key);
        throw error;
      }
    );
    recordedVideoFixtures.set(key, fixture);
  }
  return fixture;
}

async function createRecordedH264Video(input: {
  durationSeconds: number;
  height: number;
  width: number;
}) {
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
        `color=c=#d8b4ae:s=${input.width}x${input.height}:r=24`,
        '-t',
        String(input.durationSeconds),
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


function recordedTaskRef(
  catalogModelId: string,
  jobId: string,
  prefix = 'recorded-task'
) {
  return `${prefix}-${digest(`${catalogModelId}:${jobId}`).slice(0, 20)}`;
}
