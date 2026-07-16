import { createHash } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ProviderCost {
  amount: number;
  currency: string;
  estimated: boolean;
}

export interface GenerateVideoClipRequest {
  prompt: string;
  durationSeconds: number;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  correlationId: string;
  outputPath: string;
}

export interface GeneratedVideoClip {
  path: string;
  provider: string;
  model: string;
  taskId: string;
  cost: ProviderCost;
  latencyMs: number;
}

export interface VideoProvider {
  readonly name: string;
  readonly model: string;
  readonly zeroCost: ProviderCost;
  generateClip(
    request: GenerateVideoClipRequest,
    signal?: AbortSignal
  ): Promise<GeneratedVideoClip>;
}

export type VideoProviderErrorCode =
  | 'authentication'
  | 'quota_exhausted'
  | 'rate_limit'
  | 'content_policy'
  | 'invalid_request'
  | 'timeout'
  | 'cancelled'
  | 'network'
  | 'transient'
  | 'provider_failed'
  | 'invalid_response'
  | 'download_failed';

interface VideoProviderErrorOptions {
  code: VideoProviderErrorCode;
  message: string;
  provider: string;
  retryable: boolean;
  refund: 'required' | 'not_required';
  providerCode?: string;
  httpStatus?: number;
  cause?: unknown;
}

export class VideoProviderError extends Error {
  readonly code: VideoProviderErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  readonly refund: 'required' | 'not_required';
  readonly providerCode?: string;
  readonly httpStatus?: number;

  constructor(options: VideoProviderErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'VideoProviderError';
    this.code = options.code;
    this.provider = options.provider;
    this.retryable = options.retryable;
    this.refund = options.refund;
    this.providerCode = options.providerCode;
    this.httpStatus = options.httpStatus;
  }
}

interface DeterministicFakeVideoProviderOptions {
  provider?: string;
  model?: string;
  clipBytes?: Uint8Array;
  sourceClipPath?: string;
  cost: ProviderCost;
  failure?: VideoProviderError;
}

export class DeterministicFakeVideoProvider implements VideoProvider {
  readonly name: string;
  readonly model: string;
  readonly zeroCost: ProviderCost;

  constructor(private readonly options: DeterministicFakeVideoProviderOptions) {
    if (!options.clipBytes && !options.sourceClipPath) {
      throw new Error('The fake video provider requires clipBytes or sourceClipPath.');
    }
    this.name = options.provider ?? 'deterministic-fake';
    this.model = options.model ?? 'fake-video-v1';
    this.zeroCost = {
      amount: 0,
      currency: options.cost.currency,
      estimated: options.cost.estimated,
    };
  }

  async generateClip(
    request: GenerateVideoClipRequest,
    signal?: AbortSignal
  ): Promise<GeneratedVideoClip> {
    if (signal?.aborted) throw signal.reason;
    if (this.options.failure) throw this.options.failure;
    await mkdir(dirname(request.outputPath), { recursive: true });
    if (this.options.sourceClipPath) {
      await copyFile(this.options.sourceClipPath, request.outputPath);
    } else {
      await writeFile(request.outputPath, this.options.clipBytes ?? new Uint8Array());
    }
    const taskId = createHash('sha256')
      .update(JSON.stringify({
        prompt: request.prompt,
        durationSeconds: request.durationSeconds,
        aspectRatio: request.aspectRatio,
        firstFrameUrl: request.firstFrameUrl ?? null,
        lastFrameUrl: request.lastFrameUrl ?? null,
        correlationId: request.correlationId,
        provider: this.name,
        model: this.model,
      }))
      .digest('hex')
      .slice(0, 24);
    return {
      path: request.outputPath,
      provider: this.name,
      model: this.model,
      taskId: `fake-${taskId}`,
      cost: { ...this.options.cost },
      latencyMs: 0,
    };
  }
}
