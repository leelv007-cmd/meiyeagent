import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  type GeneratedVideoClip,
  type GenerateVideoClipRequest,
  type ProviderCost,
  type VideoProvider,
  VideoProviderError,
} from './provider.js';

interface ArkTask {
  id: string;
  status?: 'queued' | 'running' | 'cancelled' | 'succeeded' | 'failed';
  content?: { video_url?: string };
  usage?: Record<string, number>;
  error?: { code?: string; message?: string };
}

interface ArkDirectVideoProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  pollIntervalMs: number;
  timeoutMs: number;
  estimateCost: (request: GenerateVideoClipRequest, task: ArkTask) => ProviderCost;
  fetch?: typeof fetch;
}

interface ProviderResponseError {
  code?: string;
  message: string;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResponseError(value: unknown, fallback: string): ProviderResponseError {
  if (!isRecord(value)) return { message: fallback };
  const nested = isRecord(value.error) ? value.error : value;
  return {
    ...(typeof nested.code === 'string' ? { code: nested.code } : {}),
    message: typeof nested.message === 'string' ? nested.message : fallback,
  };
}

function errorCodeForHttp(status: number, providerCode?: string) {
  const normalized = providerCode?.toLowerCase() ?? '';
  if (normalized.includes('sensitive') || normalized.includes('contentpolicy')) {
    return { code: 'content_policy' as const, retryable: false };
  }
  if (status === 401 || status === 403) {
    return { code: 'authentication' as const, retryable: false };
  }
  if (status === 402 || normalized.includes('quota')) {
    return { code: 'quota_exhausted' as const, retryable: false };
  }
  if (status === 429) return { code: 'rate_limit' as const, retryable: true };
  if (status === 408 || status >= 500) {
    return { code: 'transient' as const, retryable: true };
  }
  return { code: 'invalid_request' as const, retryable: false };
}

async function sleep(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * @deprecated Use `P1ModelSupply.ArkMediaExecutionPort`; it owns the durable
 * submit, poll, download, cancel, cost, and recovery lifecycle used in production.
 */
export class ArkDirectVideoProvider implements VideoProvider {
  readonly name = 'volcengine-ark';
  readonly model: string;
  readonly zeroCost: ProviderCost = { amount: 0, currency: 'CNY', estimated: true };
  private readonly fetch: typeof fetch;

  constructor(private readonly options: ArkDirectVideoProviderOptions) {
    this.model = options.model;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async generateClip(
    request: GenerateVideoClipRequest,
    signal?: AbortSignal
  ): Promise<GeneratedVideoClip> {
    const startedAt = performance.now();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Ark video generation timed out.'));
    }, this.options.timeoutMs);
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const created = await this.requestJson(
        `${trimTrailingSlash(this.options.baseUrl)}/contents/generations/tasks`,
        {
          method: 'POST',
          body: JSON.stringify(this.requestBody(request)),
        },
        controller.signal,
        request.correlationId
      );
      if (!isRecord(created) || typeof created.id !== 'string') {
        throw this.invalidResponse('Ark task creation did not return an id.');
      }
      const task = await this.waitForTask(
        created.id,
        controller.signal,
        request.correlationId
      );
      const videoUrl = task.content?.video_url;
      if (!videoUrl) {
        throw this.invalidResponse('A succeeded Ark task did not return content.video_url.');
      }
      await this.download(videoUrl, request.outputPath, controller.signal);
      const cost = this.options.estimateCost(request, task);
      if (!Number.isFinite(cost.amount) || cost.amount < 0 || !cost.currency) {
        throw this.invalidResponse('The configured Ark cost estimator returned invalid evidence.');
      }
      return {
        path: request.outputPath,
        provider: this.name,
        model: this.model,
        taskId: task.id,
        cost,
        latencyMs: Math.max(0, performance.now() - startedAt),
      };
    } catch (error) {
      if (error instanceof VideoProviderError) throw error;
      if (timedOut) {
        throw new VideoProviderError({
          code: 'timeout',
          message: `Ark video generation exceeded ${this.options.timeoutMs}ms.`,
          provider: this.name,
          retryable: true,
          refund: 'required',
          cause: error,
        });
      }
      if (signal?.aborted) {
        throw new VideoProviderError({
          code: 'cancelled',
          message: 'Ark video generation was cancelled.',
          provider: this.name,
          retryable: true,
          refund: 'required',
          cause: error,
        });
      }
      throw new VideoProviderError({
        code: 'network',
        message: error instanceof Error ? error.message : 'Ark network request failed.',
        provider: this.name,
        retryable: true,
        refund: 'required',
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  private requestBody(request: GenerateVideoClipRequest) {
    const content: Array<Record<string, unknown>> = [{
      type: 'text',
      text: `${request.prompt} --ratio ${request.aspectRatio}`,
    }];
    if (request.firstFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: request.firstFrameUrl },
        role: 'first_frame',
      });
    }
    if (request.lastFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: request.lastFrameUrl },
        role: 'last_frame',
      });
    }
    return {
      model: this.model,
      content,
      duration: request.durationSeconds,
    };
  }

  private async waitForTask(
    id: string,
    signal: AbortSignal,
    correlationId: string
  ): Promise<ArkTask> {
    const url = `${trimTrailingSlash(this.options.baseUrl)}/contents/generations/tasks/${encodeURIComponent(id)}`;
    while (true) {
      const value = await this.requestJson(
        url,
        { method: 'GET' },
        signal,
        correlationId
      );
      if (!isRecord(value) || typeof value.id !== 'string' || typeof value.status !== 'string') {
        throw this.invalidResponse('Ark task polling returned an invalid response.');
      }
      const task = value as unknown as ArkTask;
      if (task.status === 'succeeded') return task;
      if (task.status === 'failed' || task.status === 'cancelled') {
        const providerCode = task.error?.code;
        const isPolicy = providerCode?.toLowerCase().includes('sensitive') ?? false;
        throw new VideoProviderError({
          code: isPolicy ? 'content_policy' : 'provider_failed',
          message: task.error?.message ?? `Ark task ${id} ended as ${task.status}.`,
          provider: this.name,
          providerCode,
          retryable: !isPolicy,
          refund: 'required',
        });
      }
      if (task.status !== 'queued' && task.status !== 'running') {
        throw this.invalidResponse(`Ark task ${id} returned unknown status ${task.status}.`);
      }
      await sleep(this.options.pollIntervalMs, signal);
    }
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    correlationId: string
  ): Promise<unknown> {
    const response = await this.fetch(url, {
      ...init,
      signal,
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
        'x-client-request-id': correlationId,
        ...init.headers,
      },
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw this.invalidResponse(`Ark returned non-JSON HTTP ${response.status}.`, error);
    }
    if (!response.ok) {
      const providerError = parseResponseError(body, `Ark returned HTTP ${response.status}.`);
      const classification = errorCodeForHttp(response.status, providerError.code);
      throw new VideoProviderError({
        ...classification,
        message: providerError.message,
        provider: this.name,
        providerCode: providerError.code,
        httpStatus: response.status,
        refund: 'required',
      });
    }
    return body;
  }

  private async download(url: string, outputPath: string, signal: AbortSignal) {
    const partialPath = `${outputPath}.${process.pid}.part`;
    await mkdir(dirname(outputPath), { recursive: true });
    try {
      const response = await this.fetch(url, { signal });
      if (!response.ok || !response.body) {
        throw new VideoProviderError({
          code: 'download_failed',
          message: `Ark clip download returned HTTP ${response.status}.`,
          provider: this.name,
          retryable: true,
          refund: 'required',
          httpStatus: response.status,
        });
      }
      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
        createWriteStream(partialPath, { flags: 'wx' }),
        { signal }
      );
      await rename(partialPath, outputPath);
    } catch (error) {
      await rm(partialPath, { force: true });
      if (error instanceof VideoProviderError) throw error;
      throw new VideoProviderError({
        code: 'download_failed',
        message: 'Ark clip download failed.',
        provider: this.name,
        retryable: true,
        refund: 'required',
        cause: error,
      });
    }
  }

  private invalidResponse(message: string, cause?: unknown) {
    return new VideoProviderError({
      code: 'invalid_response',
      message,
      provider: this.name,
      retryable: false,
      refund: 'required',
      cause,
    });
  }
}
