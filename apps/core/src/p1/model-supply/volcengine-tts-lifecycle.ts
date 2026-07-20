import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateGeneratedAudio } from '../../pro-studio-runtime/audio-asset-pipeline.js';
import {
  parseAudioSpeechContract,
  type AudioSpeechContract,
} from '../../pro-studio-runtime/audio-contracts.js';
import type {
  AdapterRuntimeConfig,
  MediaProviderEffectRequest,
  MediaProviderLifecyclePort,
  ProviderExecutionPort,
  ProviderExecutionRequest,
  ProviderExecutionResponse,
} from './index.js';
import type {
  VolcengineTtsSynthesisRequest,
  VolcengineTtsSynthesisResult,
} from './volcengine-tts-adapter.js';

export interface VolcengineTtsSynthesisPort {
  synthesize(
    request: VolcengineTtsSynthesisRequest,
  ): Promise<VolcengineTtsSynthesisResult>;
  withCredential?(secret: string): VolcengineTtsSynthesisPort;
  withRuntimeBinding?(input: {
    secret: string;
    endpoint?: string;
    model?: string;
    resourceId?: 'seed-tts-2.0' | 'seed-icl-2.0';
    defaultSpeaker?: string;
  }): VolcengineTtsSynthesisPort;
}

type PublishedTtsRuntime = {
  config: AdapterRuntimeConfig & {
    approvedPricePerTextWordCny: number;
    defaultSpeaker: string;
    endpoint: string;
    priceRevision: string;
    providerModel: string;
    resourceId: 'seed-tts-2.0' | 'seed-icl-2.0';
  };
  credential: NonNullable<
    NonNullable<ProviderExecutionRequest['runtimeBinding']>['credential']
  >;
};

export interface VolcengineTtsLifecycleOptions {
  approvedPricePerTextWordCny: number;
  credentialVersion: string;
  priceRevision: string;
  synthesis: VolcengineTtsSynthesisPort;
  taskStore?: VolcengineTtsTaskStore;
  validateAudio?: VolcengineTtsAudioValidator;
}

type ProviderCost = {
  amount: number;
  currency: 'CNY';
  usage: { mediaUnits?: number };
};

export type VolcengineTtsStoredTask = {
  cost: ProviderCost;
  credentialVersion: string;
  deploymentId: string;
  errorCode?: string;
  output?: {
    bytes: Uint8Array;
    contentType: 'audio/mpeg' | 'audio/wav';
  };
  status: 'completed' | 'failed' | 'received' | 'unknown';
  taskRef: string;
  usageErrorCode?: 'tts_usage_invalid' | 'tts_usage_missing';
  workspaceId: string;
};

export interface VolcengineTtsTaskStore {
  claim(task: VolcengineTtsStoredTask): Promise<boolean>;
  get(taskRef: string): Promise<VolcengineTtsStoredTask | undefined>;
  put(task: VolcengineTtsStoredTask): Promise<void>;
}

export type VolcengineTtsAudioValidator = (input: {
  bytes: Uint8Array;
  contentType: 'audio/mpeg' | 'audio/wav';
}) => Promise<{ durationSeconds: number }>;

class InMemoryVolcengineTtsTaskStore implements VolcengineTtsTaskStore {
  private readonly tasks = new Map<string, VolcengineTtsStoredTask>();

  async claim(task: VolcengineTtsStoredTask) {
    if (this.tasks.has(task.taskRef)) return false;
    this.tasks.set(task.taskRef, cloneTask(task));
    return true;
  }

  async get(taskRef: string) {
    const task = this.tasks.get(taskRef);
    return task ? cloneTask(task) : undefined;
  }

  async put(task: VolcengineTtsStoredTask) {
    this.tasks.set(task.taskRef, cloneTask(task));
  }
}

export class FileSystemVolcengineTtsTaskStore
  implements VolcengineTtsTaskStore
{
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(
      requireText(rootDirectory, 'Volcengine TTS task-store directory'),
    );
  }

  async get(taskRef: string) {
    const path = this.pathFor(taskRef);
    try {
      return deserializeTask(await readFile(path, 'utf8'), taskRef);
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }

  async claim(task: VolcengineTtsStoredTask) {
    const path = this.pathFor(task.taskRef);
    await mkdir(this.rootDirectory, { mode: 0o700, recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, serializeTask(task), {
        flag: 'wx',
        mode: 0o600,
      });
      try {
        await link(temporaryPath, path);
        return true;
      } catch (error) {
        if (isAlreadyExists(error)) return false;
        throw error;
      }
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async put(task: VolcengineTtsStoredTask) {
    const path = this.pathFor(task.taskRef);
    await mkdir(this.rootDirectory, { mode: 0o700, recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, serializeTask(task), {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private pathFor(taskRef: string) {
    if (!/^volcengine-tts-[a-f0-9]{32}$/u.test(taskRef)) {
      throw new Error('Volcengine TTS task reference is invalid.');
    }
    return `${this.rootDirectory}/${taskRef}.json`;
  }
}

export class VolcengineTtsLifecyclePort
  implements ProviderExecutionPort, MediaProviderLifecyclePort
{
  private readonly taskStore: VolcengineTtsTaskStore;
  private readonly validateAudio: VolcengineTtsAudioValidator;

  constructor(private readonly options: VolcengineTtsLifecycleOptions) {
    if (
      !Number.isFinite(options.approvedPricePerTextWordCny) ||
      options.approvedPricePerTextWordCny < 0
    ) {
      throw new Error(
        'Volcengine TTS approved price must be a non-negative finite number.',
      );
    }
    requireText(options.credentialVersion, 'Volcengine TTS credential version');
    requireText(options.priceRevision, 'Volcengine TTS price revision');
    this.taskStore = options.taskStore ?? new InMemoryVolcengineTtsTaskStore();
    this.validateAudio = options.validateAudio ?? validateGeneratedAudio;
  }

  async execute(
    request: ProviderExecutionRequest,
  ): Promise<ProviderExecutionResponse> {
    const effectRequest: MediaProviderEffectRequest = {
      ...request,
      effectIdempotencyKey: `direct:${request.submission.workspaceId}:${request.submission.idempotencyKey}`,
    };
    const receipt = await this.submit(effectRequest);
    if (receipt.acceptance !== 'accepted' || !receipt.taskRef) {
      return {
        acceptance: receipt.acceptance,
        ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
        kind: 'failure',
        message: receipt.error ?? 'Volcengine TTS submission is unresolved.',
        providerCost: receipt.providerCost,
        ...(receipt.retryable === undefined
          ? {}
          : { retryable: receipt.retryable }),
        ...(receipt.taskRef ? { providerTaskRef: receipt.taskRef } : {}),
      };
    }
    const state = await this.poll({ ...effectRequest, taskRef: receipt.taskRef });
    if (state.status !== 'completed') {
      return {
        acceptance: 'accepted',
        ...(state.errorCode ? { errorCode: state.errorCode } : {}),
        kind: 'failure',
        message: state.error,
        providerCost: state.providerCost,
        providerTaskRef: receipt.taskRef,
        ...(state.retryable === undefined ? {} : { retryable: state.retryable }),
      };
    }
    const output = await this.download({
      ...effectRequest,
      taskRef: receipt.taskRef,
    });
    return {
      assetBytes: output.bytes,
      contentType: output.contentType,
      kind: 'completed',
      providerCost: state.providerCost,
      providerTaskRef: receipt.taskRef,
    };
  }

  async submit(request: MediaProviderEffectRequest) {
    const contract = this.contract(request);
    const runtime = this.publishedRuntime(request);
    const taskRef = this.taskRef(request);
    const existing = await this.taskStore.get(taskRef);
    if (existing) return receipt(await this.settleReceived(existing, contract));
    const preflightFailure = this.preflightFailure(request, contract, runtime);
    if (preflightFailure) return preflightFailure;

    const unknown: VolcengineTtsStoredTask = {
      cost: emptyCost(),
      credentialVersion: deploymentCredentialVersion(request),
      deploymentId: request.deployment.id,
      errorCode: 'tts_acceptance_unknown',
      status: 'unknown',
      taskRef,
      workspaceId: request.submission.workspaceId,
    };
    if (!(await this.taskStore.claim(unknown))) {
      const claimed = await this.taskStore.get(taskRef);
      if (!claimed) {
        throw new Error('Volcengine TTS durable task claim disappeared.');
      }
      return receipt(await this.settleReceived(claimed, contract));
    }
    let result: Awaited<ReturnType<VolcengineTtsSynthesisPort['synthesize']>>;
    try {
      const synthesis = runtime
        ? this.options.synthesis.withRuntimeBinding!({
            secret: runtime.credential.secret,
            endpoint: runtime.config.endpoint,
            model: runtime.config.providerModel,
            resourceId: runtime.config.resourceId,
            defaultSpeaker: runtime.config.defaultSpeaker,
          })
        : request.runtimeBinding?.credential
          ? (this.options.synthesis.withCredential?.(
              request.runtimeBinding.credential.secret,
            ) ?? this.options.synthesis)
          : this.options.synthesis;
      result = await synthesis.synthesize({
        format: contract.format,
        language: contract.language,
        speaker: contract.voice === 'default' ? undefined : contract.voice,
        speed: contract.speed,
        text: request.submission.prompt,
      });
    } catch {
      await this.taskStore.put(unknown);
      return receipt(unknown);
    }
    const usageErrorCode =
      result.billedTextWords === undefined
        ? 'tts_usage_missing'
        : !Number.isSafeInteger(result.billedTextWords) ||
            result.billedTextWords < 0
          ? 'tts_usage_invalid'
          : undefined;
    const received: VolcengineTtsStoredTask = {
      cost: usageErrorCode
        ? emptyCost()
        : observedCost(
            result.billedTextWords!,
            runtime?.config.approvedPricePerTextWordCny ??
              this.options.approvedPricePerTextWordCny,
          ),
      credentialVersion: deploymentCredentialVersion(request),
      deploymentId: request.deployment.id,
      output: {
        bytes: Uint8Array.from(result.bytes),
        contentType: result.contentType,
      },
      status: 'received',
      taskRef,
      ...(usageErrorCode ? { usageErrorCode } : {}),
      workspaceId: request.submission.workspaceId,
    };
    await this.taskStore.put(received);
    return receipt(await this.settleReceived(received, contract));
  }

  async recover(request: MediaProviderEffectRequest) {
    const contract = this.contract(request);
    const taskRef = this.taskRef(request);
    const task = (await this.taskStore.get(taskRef)) ?? {
      cost: emptyCost(),
      credentialVersion: deploymentCredentialVersion(request),
      deploymentId: request.deployment.id,
      errorCode: 'tts_acceptance_unknown',
      status: 'unknown' as const,
      taskRef,
      workspaceId: request.submission.workspaceId,
    };
    return receipt(await this.settleReceived(task, contract));
  }

  async poll(request: MediaProviderEffectRequest & { taskRef: string }) {
    const contract = this.contract(request);
    const task = await this.settleReceived(
      await this.requireTask(request),
      contract,
    );
    if (task.status === 'completed') {
      return { providerCost: task.cost, status: 'completed' as const };
    }
    if (task.status === 'failed') {
      return {
        error: 'Volcengine TTS output failed contract validation.',
        errorCode: task.errorCode,
        providerCost: task.cost,
        retryable: false,
        status: 'failed' as const,
      };
    }
    return {
      error: 'Volcengine TTS acceptance is unresolved; synthesis will not be repeated.',
      errorCode: task.errorCode ?? 'tts_acceptance_unknown',
      providerCost: task.cost,
      retryable: false,
      status: 'unknown' as const,
    };
  }

  async download(request: MediaProviderEffectRequest & { taskRef: string }) {
    const contract = this.contract(request);
    const task = await this.settleReceived(
      await this.requireTask(request),
      contract,
    );
    if (task.status !== 'completed' || !task.output) {
      throw new Error('Volcengine TTS task is not completed.');
    }
    return {
      bytes: Uint8Array.from(task.output.bytes),
      contentType: task.output.contentType,
    };
  }

  async cancel(request: MediaProviderEffectRequest & { taskRef: string }) {
    this.contract(request);
    await this.requireTask(request);
    return {
      error: 'Volcengine TTS synthesis cannot be cancelled after submission.',
      errorCode: 'tts_cancel_unavailable',
      retryable: false,
      status: 'pending' as const,
    };
  }

  private contract(request: MediaProviderEffectRequest) {
    if (
      request.model.id !== 'seed-tts-2' ||
      request.deployment.id !== 'seed-tts-2-volcengine-direct' ||
      request.submission.operation !== 'audio.speech'
    ) {
      throw new Error(
        'Volcengine TTS lifecycle received an incompatible deployment or operation.',
      );
    }
    return parseAudioSpeechContract(request.submission.input);
  }

  private taskRef(request: MediaProviderEffectRequest) {
    return `volcengine-tts-${createHash('sha256')
      .update(
        JSON.stringify({
          credentialVersion: deploymentCredentialVersion(request),
          deploymentId: request.deployment.id,
          effectIdempotencyKey: request.effectIdempotencyKey,
          priceRevision: request.deployment.priceRevision,
          workspaceId: request.submission.workspaceId,
        }),
      )
      .digest('hex')
      .slice(0, 32)}`;
  }

  private async requireTask(
    request: MediaProviderEffectRequest & { taskRef: string },
  ): Promise<VolcengineTtsStoredTask> {
    if (request.taskRef !== this.taskRef(request)) {
      throw new Error('Volcengine TTS task reference does not match its scope.');
    }
    return (await this.taskStore.get(request.taskRef)) ?? {
      cost: emptyCost(),
      credentialVersion: deploymentCredentialVersion(request),
      deploymentId: request.deployment.id,
      errorCode: 'tts_acceptance_unknown',
      status: 'unknown',
      taskRef: request.taskRef,
      workspaceId: request.submission.workspaceId,
    };
  }

  private async settleReceived(
    task: VolcengineTtsStoredTask,
    contract: AudioSpeechContract,
  ): Promise<VolcengineTtsStoredTask> {
    if (task.status !== 'received') return task;
    if (!task.output) {
      throw new Error('Volcengine TTS received task has no durable output.');
    }
    if (task.usageErrorCode) {
      const failed: VolcengineTtsStoredTask = {
        ...task,
        errorCode: task.usageErrorCode,
        status: 'failed',
        usageErrorCode: undefined,
      };
      await this.taskStore.put(failed);
      return failed;
    }
    const expectedContentType =
      contract.format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    if (task.output.contentType !== expectedContentType) {
      const failed: VolcengineTtsStoredTask = {
        ...task,
        errorCode: 'tts_output_type_mismatch',
        status: 'failed',
      };
      await this.taskStore.put(failed);
      return failed;
    }
    let validation: { durationSeconds: number };
    try {
      validation = await this.validateAudio(task.output);
    } catch {
      const failed: VolcengineTtsStoredTask = {
        ...task,
        errorCode: 'tts_output_invalid',
        status: 'failed',
      };
      await this.taskStore.put(failed);
      return failed;
    }
    if (validation.durationSeconds > contract.maxDurationSeconds) {
      const failed: VolcengineTtsStoredTask = {
        ...task,
        errorCode: 'tts_duration_exceeded',
        status: 'failed',
      };
      await this.taskStore.put(failed);
      return failed;
    }
    const completed: VolcengineTtsStoredTask = {
      ...task,
      status: 'completed',
    };
    await this.taskStore.put(completed);
    return completed;
  }

  private preflightFailure(
    request: MediaProviderEffectRequest,
    contract: AudioSpeechContract,
    runtime: PublishedTtsRuntime | undefined,
  ) {
    if (contract.tone !== 'natural') {
      return rejectedReceipt(
        'tts_tone_unsupported',
        'Volcengine TTS currently supports only the natural tone.',
      );
    }
    const price = request.deployment.unitPrice;
    const approvedPrice =
      runtime?.config.approvedPricePerTextWordCny ??
      this.options.approvedPricePerTextWordCny;
    const priceRevision =
      runtime?.config.priceRevision ?? this.options.priceRevision;
    const expectedAmountMicros = Math.round(
      approvedPrice * 1_000_000,
    );
    if (
      !runtime &&
      request.deployment.credentialVersion !== this.options.credentialVersion
    ) {
      return rejectedReceipt(
        'tts_configuration_revision_mismatch',
        'Volcengine TTS execution credential revision is no longer active.',
      );
    }
    if (
      request.deployment.priceRevision !== priceRevision ||
      price?.amountMicros !== expectedAmountMicros ||
      price.currency !== 'CNY' ||
      price.unit !== 'text_word'
    ) {
      return rejectedReceipt(
        'tts_price_revision_mismatch',
        'Volcengine TTS execution price does not match the approved revision.',
      );
    }
    return undefined;
  }

  private publishedRuntime(
    request: MediaProviderEffectRequest,
  ): PublishedTtsRuntime | undefined {
    const binding = request.runtimeBinding;
    if (!binding) return undefined;
    if (binding.adapterKey !== 'volcengine-tts') {
      throw new Error(
        `Published adapter binding ${binding.adapterKey} cannot execute through volcengine-tts.`,
      );
    }
    if (!binding.adapterBindingRevision) return undefined;
    const config = binding.adapterConfig;
    if (!config) {
      throw new Error(
        `Published adapter binding ${binding.adapterBindingRevision} has no runtime config.`,
      );
    }
    const credential = binding.credential;
    if (!credential?.secret.trim()) {
      throw new Error(
        'Published volcengine-tts binding has no runtime credential.',
      );
    }
    if (!this.options.synthesis.withRuntimeBinding) {
      throw new Error(
        'Published volcengine-tts binding requires a runtime-configurable synthesis adapter.',
      );
    }
    const endpoint = requiredRuntimeText(config.endpoint, 'TTS endpoint');
    if (!endpoint.startsWith('wss://')) {
      throw new Error('Published TTS endpoint must use wss.');
    }
    const approvedPricePerTextWordCny = requiredRuntimeNumber(
      config.approvedPricePerTextWordCny,
      'TTS approved text-word price',
    );
    const resourceId = config.resourceId;
    if (resourceId !== 'seed-tts-2.0' && resourceId !== 'seed-icl-2.0') {
      throw new Error('Published adapter binding requires a TTS resource ID.');
    }
    return {
      config: {
        ...config,
        approvedPricePerTextWordCny,
        defaultSpeaker: requiredRuntimeText(
          config.defaultSpeaker,
          'TTS default speaker',
        ),
        endpoint,
        priceRevision: requiredRuntimeText(
          config.priceRevision,
          'TTS price revision',
        ),
        providerModel: requiredRuntimeText(
          config.providerModel,
          'TTS provider model',
        ),
        resourceId,
      },
      credential,
    };
  }
}

function requiredRuntimeText(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Published adapter binding requires ${name}.`);
  }
  return value.trim();
}

function requiredRuntimeNumber(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `Published adapter binding requires a non-negative finite ${name}.`,
    );
  }
  return value;
}

function receipt(task: VolcengineTtsStoredTask) {
  if (task.status === 'unknown') {
    return {
      acceptance: 'acceptance_unknown' as const,
      error: 'Volcengine TTS acceptance is unresolved; synthesis will not be repeated.',
      errorCode: task.errorCode ?? 'tts_acceptance_unknown',
      providerCost: task.cost,
      retryable: false,
      taskRef: task.taskRef,
    };
  }
  return {
    acceptance: 'accepted' as const,
    providerCost: task.cost,
    taskRef: task.taskRef,
  };
}

function observedCost(textWords: number, unitPrice: number): ProviderCost {
  if (!Number.isSafeInteger(textWords) || textWords < 0) {
    throw new Error('Volcengine TTS billed text words must be a non-negative integer.');
  }
  return {
    amount: Number((textWords * unitPrice).toFixed(12)),
    currency: 'CNY',
    usage: { mediaUnits: textWords },
  };
}

function emptyCost(): ProviderCost {
  return { amount: 0, currency: 'CNY', usage: {} };
}

function rejectedReceipt(errorCode: string, error: string) {
  return {
    acceptance: 'rejected_before_accept' as const,
    error,
    errorCode,
    providerCost: emptyCost(),
    retryable: false,
    taskRef: undefined,
  };
}

function cloneTask(task: VolcengineTtsStoredTask): VolcengineTtsStoredTask {
  return {
    ...structuredClone(task),
    ...(task.output
      ? {
          output: {
            ...task.output,
            bytes: Uint8Array.from(task.output.bytes),
          },
        }
      : {}),
  };
}

function serializeTask(task: VolcengineTtsStoredTask) {
  const { output, ...metadata } = task;
  return JSON.stringify({
    ...metadata,
    ...(output
      ? {
          output: {
            bytesBase64: Buffer.from(output.bytes).toString('base64'),
            contentType: output.contentType,
          },
        }
      : {}),
  });
}

function deserializeTask(value: string, expectedTaskRef: string) {
  const parsed = JSON.parse(value) as VolcengineTtsStoredTask & {
    output?: {
      bytesBase64?: unknown;
      contentType?: unknown;
    };
  };
  if (
    parsed.taskRef !== expectedTaskRef ||
    (parsed.status !== 'completed' &&
      parsed.status !== 'failed' &&
      parsed.status !== 'received' &&
      parsed.status !== 'unknown') ||
    typeof parsed.workspaceId !== 'string' ||
    typeof parsed.deploymentId !== 'string' ||
    typeof parsed.credentialVersion !== 'string' ||
    !parsed.cost ||
    parsed.cost.currency !== 'CNY' ||
    !Number.isFinite(parsed.cost.amount)
  ) {
    throw new Error('Volcengine TTS durable task record is invalid.');
  }
  const { output, ...metadata } = parsed;
  if (!output) return metadata;
  if (
    typeof output.bytesBase64 !== 'string' ||
    (output.contentType !== 'audio/mpeg' &&
      output.contentType !== 'audio/wav')
  ) {
    throw new Error('Volcengine TTS durable output record is invalid.');
  }
  const bytes = Uint8Array.from(Buffer.from(output.bytesBase64, 'base64'));
  if (bytes.byteLength === 0) {
    throw new Error('Volcengine TTS durable output is empty.');
  }
  return {
    ...metadata,
    output: { bytes, contentType: output.contentType },
  };
}

function isMissingFile(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function isAlreadyExists(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}

function requireText(value: string, name: string) {
  if (!value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function deploymentCredentialVersion(request: MediaProviderEffectRequest) {
  return requireText(
    request.deployment.credentialVersion ?? '',
    'Volcengine TTS deployment credential version',
  );
}
