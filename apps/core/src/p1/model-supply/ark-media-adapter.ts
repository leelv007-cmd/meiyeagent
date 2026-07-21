import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {
  ProviderSafeFetch,
  type ReferenceAssetDeliveryPort,
  type SafeFetchResult,
} from './reference-asset-delivery.js';
import type {
  MediaProviderDrainMode,
  MediaProviderEffectRequest,
  MediaProviderHealthReport,
  MediaProviderLifecyclePort,
  MediaProviderReceiptStore,
  MediaProviderSubmissionReceipt,
  ProviderExecutionPort,
  ProviderExecutionRequest,
  ProviderExecutionResponse,
} from './index.js';

type ImageCatalogModelId = 'gpt-image-2' | 'seedream-4-5' | 'seedream-5-pro';
const MAX_PROVIDER_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PROVIDER_VIDEO_BYTES = 250 * 1024 * 1024;

export type ProviderAssetFetchPort = ReferenceAssetDeliveryPort;

export interface ArkMediaExecutionOptions<
  VideoCatalogModelId extends string = 'seedance-2',
> {
  apiKey: string;
  assetFetch?: ProviderAssetFetchPort;
  assetSourceHosts?: string[];
  baseUrl: string;
  credentialVersion: string;
  endpointRevision: string;
  image: {
    catalogModelId: ImageCatalogModelId;
    model: string;
    costPerImage: number;
  };
  video: {
    catalogModelId: VideoCatalogModelId;
    model: string;
    costPerMillionTokens: number;
    estimatedTokensPerSecond: number;
  };
  sourceUrlTtlSeconds: number;
  fetch?: typeof fetch;
  now?: () => Date;
  /**
   * Durable receipt store for cross-process recover (MP-04I).
   * Defaults to process-local memory; production should inject filesystem/Postgres.
   */
  receiptStore?: MediaProviderReceiptStore;
}

interface ArkImageResponse {
  created?: number;
  data: Array<{ url: string }>;
  usage?: {
    generated_images?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

interface ArkVideoTask {
  id: string;
  status: 'queued' | 'running' | 'cancelled' | 'succeeded' | 'failed';
  content?: { video_url?: string };
  usage?: { completion_tokens?: number; output_tokens?: number };
  error?: { code?: string; message?: string };
  updated_at?: number | string;
}

interface ArkTaskReference {
  version: 1;
  kind: 'image' | 'video';
  scope: string;
  providerTaskId?: string;
  sourceUrl?: string;
  sourceExpiresAt?: string;
  usage?: {
    mediaUnits?: number;
    outputTokens?: number;
  };
}

interface ClassifiedError {
  code: string;
  retryable: boolean;
}

class ArkHttpError extends Error {
  constructor(
    readonly status: number,
    readonly providerCode: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

class ArkAdapterError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
    readonly submissionAcceptance:
      | 'rejected_before_accept'
      | 'acceptance_unknown' = 'rejected_before_accept',
  ) {
    super(message);
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegative(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }
}

function classify(status: number, providerCode?: string): ClassifiedError {
  const code = providerCode?.toLowerCase() ?? '';
  if (code.includes('sensitive') || code.includes('contentpolicy')) {
    return { code: 'content_policy', retryable: false };
  }
  if (status === 401 || status === 403) {
    return { code: 'authentication', retryable: false };
  }
  if (status === 429) return { code: 'rate_limit', retryable: true };
  if (status === 402 || code.includes('quota')) {
    return { code: 'quota_exhausted', retryable: false };
  }
  if (status === 408 || status >= 500) {
    return { code: 'transient', retryable: true };
  }
  return { code: 'invalid_request', retryable: false };
}

function providerError(value: unknown, fallback: string) {
  const root = isRecord(value) ? value : undefined;
  const nested = root && isRecord(root.error) ? root.error : root;
  return {
    code: typeof nested?.code === 'string' ? nested.code : undefined,
    message:
      typeof nested?.message === 'string' ? nested.message : fallback,
  };
}

class InMemoryMediaProviderReceiptStore implements MediaProviderReceiptStore {
  private readonly receipts = new Map<string, MediaProviderSubmissionReceipt>();

  async get(scope: string) {
    const receipt = this.receipts.get(scope);
    return receipt ? structuredClone(receipt) : undefined;
  }

  async put(scope: string, receipt: MediaProviderSubmissionReceipt) {
    this.receipts.set(scope, structuredClone(receipt));
  }

  size() {
    return this.receipts.size;
  }
}

/**
 * Filesystem-backed receipt store for cross-process recover after kill-restart.
 * Scope keys are hashed so path characters stay safe.
 */
export class FileSystemMediaProviderReceiptStore
  implements MediaProviderReceiptStore
{
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    if (!rootDirectory.trim()) {
      throw new Error('Media receipt store directory is required.');
    }
    this.rootDirectory = resolve(rootDirectory.trim());
  }

  async get(scope: string) {
    try {
      const raw = await readFile(this.pathFor(scope), 'utf8');
      return JSON.parse(raw) as MediaProviderSubmissionReceipt;
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }

  async put(scope: string, receipt: MediaProviderSubmissionReceipt) {
    await mkdir(this.rootDirectory, { mode: 0o700, recursive: true });
    const path = this.pathFor(scope);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(receipt), {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private pathFor(scope: string) {
    if (!/^[a-f0-9]{64}$/u.test(scope)) {
      throw new Error('Media receipt scope is invalid.');
    }
    return `${this.rootDirectory}/${scope}.json`;
  }
}

/**
 * Direct Volcengine Ark media adapter. Seedream is a synchronous HTTP API, so
 * its temporary source URL and observed usage are carried in an opaque task
 * receipt. Seedance keeps Ark's native async task id. Both receipts are scoped
 * to the workspace, effect key, catalog model, and credential revision.
 *
 * MP-04I gaps covered here (without reworking submit/poll/download/cancel):
 * - durable receipt store for cross-process recover
 * - idempotent submit replay from stored receipt
 * - drain mode (reject new submit, continue in-flight)
 * - health reporting (adapter-local observation)
 */
export class ArkMediaExecutionPort<
  VideoCatalogModelId extends string = 'seedance-2',
>
  implements ProviderExecutionPort, MediaProviderLifecyclePort
{
  private readonly fetch: typeof fetch;
  private readonly assetFetch: ProviderAssetFetchPort;
  private readonly assetAuthorizationHost: string;
  private readonly now: () => Date;
  private readonly receiptStore: MediaProviderReceiptStore;
  private drainMode: MediaProviderDrainMode = 'accepting';
  private lastHealth: MediaProviderHealthReport = {
    state: 'healthy',
    reason: 'adapter_ready',
    source: 'adapter',
    observedAt: new Date(0).toISOString(),
  };

  constructor(
    private readonly options: ArkMediaExecutionOptions<VideoCatalogModelId>,
  ) {
    if (!options.apiKey.trim()) throw new Error('Ark API key is required.');
    if (!options.baseUrl.trim()) throw new Error('Ark base URL is required.');
    if (!options.credentialVersion.trim()) {
      throw new Error('Ark credential version is required.');
    }
    if (!options.endpointRevision.trim()) {
      throw new Error('Ark endpoint revision is required.');
    }
    if (!options.image.model.trim() || !options.video.model.trim()) {
      throw new Error('Ark image and video provider models are required.');
    }
    nonNegative(options.image.costPerImage, 'Ark image cost');
    nonNegative(options.video.costPerMillionTokens, 'Ark video token cost');
    nonNegative(
      options.video.estimatedTokensPerSecond,
      'Ark estimated video tokens per second',
    );
    if (
      !Number.isInteger(options.sourceUrlTtlSeconds) ||
      options.sourceUrlTtlSeconds <= 0
    ) {
      throw new Error('Ark source URL TTL must be a positive integer.');
    }
    this.fetch = options.fetch ?? globalThis.fetch;
    let baseUrl: URL;
    try {
      baseUrl = new URL(options.baseUrl);
    } catch {
      throw new Error('Ark base URL must be an absolute URL.');
    }
    this.assetAuthorizationHost = baseUrl.hostname.toLowerCase();
    this.assetFetch =
      options.assetFetch ??
      new ProviderSafeFetch({
        allowedHosts: [
          this.assetAuthorizationHost,
          ...(options.assetSourceHosts ?? []),
        ],
      });
    this.now = options.now ?? (() => new Date());
    // F-I-03: production/staging must inject durable FS/PG receipt store;
    // InMemory is harness-only and cannot recover across process restarts.
    if (options.receiptStore) {
      this.receiptStore = options.receiptStore;
    } else {
      const appEnv = process.env.APP_ENV ?? '';
      const strict =
        appEnv === 'production' ||
        appEnv === 'staging' ||
        (!appEnv && process.env.NODE_ENV === 'production');
      if (strict) {
        throw new Error(
          'Ark media adapter requires an explicit durable receiptStore in production/staging (FileSystemMediaProviderReceiptStore or equivalent).',
        );
      }
      this.receiptStore = new InMemoryMediaProviderReceiptStore();
    }
    this.lastHealth = {
      state: 'healthy',
      reason: 'adapter_ready',
      source: 'adapter',
      observedAt: this.now().toISOString(),
    };
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
        kind: 'failure',
        acceptance: receipt.acceptance,
        ...(receipt.taskRef ? { providerTaskRef: receipt.taskRef } : {}),
        ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
        ...(receipt.retryable === undefined
          ? {}
          : { retryable: receipt.retryable }),
        message: receipt.error ?? 'Ark media submission did not return a task.',
        providerCost: receipt.providerCost,
      };
    }
    const state = await this.poll({ ...effectRequest, taskRef: receipt.taskRef });
    if (state.status !== 'completed') {
      return {
        kind: 'failure',
        acceptance: 'accepted',
        providerTaskRef: receipt.taskRef,
        ...(state.errorCode ? { errorCode: state.errorCode } : {}),
        ...(state.retryable === undefined ? {} : { retryable: state.retryable }),
        message:
          state.error ??
          `Ark media task remains ${state.status}; use the durable media lifecycle.`,
        providerCost: state.providerCost,
      };
    }
    const asset = await this.download({
      ...effectRequest,
      taskRef: receipt.taskRef,
    });
    return {
      kind: 'completed',
      providerTaskRef: receipt.taskRef,
      assetBytes: asset.bytes,
      contentType: asset.contentType,
      providerCost: state.providerCost,
    };
  }

  async submit(
    request: MediaProviderEffectRequest,
  ): Promise<MediaProviderSubmissionReceipt> {
    try {
      this.assertCompatible(request);
      const scope = this.scope(request);
      const existing = await this.receiptStore.get(scope);
      if (existing) {
        // Idempotent replay: never re-hit the provider once a receipt is durable.
        return structuredClone(existing);
      }
      if (this.drainMode === 'draining') {
        return {
          acceptance: 'rejected_before_accept',
          providerCost: this.estimatedCost(request, 0),
          errorCode: 'channel_draining',
          retryable: false,
          error:
            'Media channel is draining; new submissions are rejected while in-flight tasks continue.',
        };
      }
      const receipt =
        request.model.id === this.options.image.catalogModelId
          ? await this.submitImage(request)
          : await this.submitVideo(request);
      await this.receiptStore.put(scope, receipt);
      this.observeHealth({
        state: 'healthy',
        reason: 'submit_accepted',
      });
      return structuredClone(receipt);
    } catch (error) {
      const cost = this.estimatedCost(request, 0);
      if (error instanceof ArkHttpError) {
        const classified = classify(error.status, error.providerCode);
        this.observeHealth({
          state: classified.code === 'rate_limited' ? 'cooldown' : 'degraded',
          reason: classified.code,
        });
        return {
          acceptance: 'rejected_before_accept',
          providerCost: cost,
          errorCode: classified.code,
          retryable: classified.retryable,
          error: this.redact(error.message),
        };
      }
      if (error instanceof ArkAdapterError) {
        if (error.submissionAcceptance === 'acceptance_unknown') {
          // Persist unknown so restart recover will not resubmit.
          const unknown: MediaProviderSubmissionReceipt = {
            acceptance: 'acceptance_unknown',
            providerCost: cost,
            errorCode: error.code,
            retryable: error.retryable,
            error: this.redact(error.message),
          };
          await this.receiptStore.put(this.scope(request), unknown);
          this.observeHealth({
            state: 'degraded',
            reason: error.code,
          });
          return structuredClone(unknown);
        }
        this.observeHealth({
          state: 'degraded',
          reason: error.code,
        });
        return {
          acceptance: error.submissionAcceptance,
          providerCost: cost,
          errorCode: error.code,
          retryable: error.retryable,
          error: this.redact(error.message),
        };
      }
      const unknown: MediaProviderSubmissionReceipt = {
        acceptance: 'acceptance_unknown',
        providerCost: cost,
        errorCode: 'network',
        retryable: true,
        error: this.redact(
          error instanceof Error ? error.message : 'Ark media submission failed.',
        ),
      };
      await this.receiptStore.put(this.scope(request), unknown);
      this.observeHealth({
        state: 'degraded',
        reason: 'network',
      });
      return structuredClone(unknown);
    }
  }

  async recover(
    request: MediaProviderEffectRequest,
  ): Promise<MediaProviderSubmissionReceipt> {
    this.assertCompatible(request);
    const receipt = await this.receiptStore.get(this.scope(request));
    if (receipt) return structuredClone(receipt);
    return {
      acceptance: 'acceptance_unknown',
      providerCost: this.estimatedCost(request),
      errorCode: 'recovery_unavailable',
      retryable: false,
      error:
        'Ark does not expose lookup by client request id; the adapter will not resubmit a possibly accepted task.',
    };
  }

  reportHealth(): MediaProviderHealthReport {
    return {
      ...this.lastHealth,
      drainMode: this.drainMode,
      observedAt: this.now().toISOString(),
    };
  }

  setDrainMode(mode: MediaProviderDrainMode) {
    this.drainMode = mode;
    this.observeHealth({
      state: mode === 'draining' ? 'degraded' : 'healthy',
      reason: mode === 'draining' ? 'channel_draining' : 'drain_cleared',
    });
  }

  getDrainMode(): MediaProviderDrainMode {
    return this.drainMode;
  }

  async poll(request: MediaProviderEffectRequest & { taskRef: string }) {
    try {
      this.assertCompatible(request);
      const reference = this.decodeTaskRef(request.taskRef, request);
      if (reference.kind === 'image') {
        return {
          status: 'completed' as const,
          providerCost: this.imageCost(reference.usage),
          ...(reference.sourceExpiresAt
            ? { sourceExpiresAt: reference.sourceExpiresAt }
            : {}),
        };
      }
      const task = await this.readVideoTask(reference, request);
      const providerCost = this.videoCost(task, request);
      if (task.status === 'succeeded') {
        if (!task.content?.video_url) {
          return {
            status: 'unknown' as const,
            providerCost,
            errorCode: 'invalid_response',
            retryable: false,
            error: 'A succeeded Ark video task returned no content.video_url.',
          };
        }
        return {
          status: 'completed' as const,
          providerCost,
          sourceExpiresAt: this.taskSourceExpiresAt(task),
        };
      }
      if (task.status === 'failed' || task.status === 'cancelled') {
        const classified = classify(400, task.error?.code);
        return {
          status: 'failed' as const,
          providerCost,
          errorCode:
            task.status === 'cancelled' ? 'provider_cancelled' : classified.code,
          retryable: task.status === 'cancelled' ? false : classified.retryable,
          error: this.redact(
            task.error?.message ?? `Ark video task ended as ${task.status}.`,
          ),
        };
      }
      return { status: task.status, providerCost };
    } catch (error) {
      return this.unknownPoll(request, error);
    }
  }

  async download(request: MediaProviderEffectRequest & { taskRef: string }) {
    this.assertCompatible(request);
    const reference = this.decodeTaskRef(request.taskRef, request);
    let sourceUrl: string;
    let sourceExpiresAt = reference.sourceExpiresAt;
    if (reference.kind === 'image') {
      if (!reference.sourceUrl) {
        throw new ArkAdapterError(
          'invalid_task_reference',
          false,
          'Ark image task receipt has no source URL.',
        );
      }
      sourceUrl = reference.sourceUrl;
    } else {
      const task = await this.readVideoTask(reference, request);
      if (task.status !== 'succeeded' || !task.content?.video_url) {
        throw new ArkAdapterError(
          'asset_not_ready',
          true,
          'Ark video asset is not ready for download.',
        );
      }
      sourceUrl = task.content.video_url;
      sourceExpiresAt = this.taskSourceExpiresAt(task);
    }
    this.assertHttpsSourceUrl(sourceUrl);
    let fetched: SafeFetchResult;
    try {
      fetched = await this.assetFetch.get(sourceUrl, {
        allowedMimeTypes:
          reference.kind === 'image'
            ? ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
            : ['video/mp4'],
        authorization: {
          host: this.assetAuthorizationHost,
          value: `Bearer ${this.options.apiKey}`,
        },
        maxBytes:
          reference.kind === 'image'
            ? MAX_PROVIDER_IMAGE_BYTES
            : MAX_PROVIDER_VIDEO_BYTES,
      });
    } catch (error) {
      throw new ArkAdapterError(
        'download_failed',
        providerAssetFetchRetryable(error),
        this.redact(error instanceof Error ? error.message : 'Ark download failed.'),
      );
    }
    const bytes = fetched.bytes;
    if (bytes.byteLength === 0) {
      throw new ArkAdapterError(
        'download_failed',
        true,
        'Ark asset download returned an empty body.',
      );
    }
    if (reference.kind === 'image') {
      const png = await sharp(bytes).png().toBuffer();
      return {
        bytes: Uint8Array.from(png),
        contentType: 'image/png' as const,
        ...(sourceExpiresAt ? { sourceExpiresAt } : {}),
      };
    }
    return {
      bytes,
      contentType: 'video/mp4' as const,
      ...(sourceExpiresAt ? { sourceExpiresAt } : {}),
    };
  }

  async cancel(request: MediaProviderEffectRequest & { taskRef: string }) {
    this.assertCompatible(request);
    const reference = this.decodeTaskRef(request.taskRef, request);
    if (reference.kind === 'image') {
      return {
        status: 'pending' as const,
        errorCode: 'already_completed',
        retryable: false,
        error: 'Ark Seedream completes synchronously and cannot be cancelled after receipt.',
      };
    }
    try {
      await this.requestJson(
        this.videoTaskUrl(reference),
        { method: 'DELETE' },
        request.effectIdempotencyKey,
        true,
      );
      return { status: 'cancelled' as const };
    } catch (error) {
      if (error instanceof ArkHttpError && error.status === 404) {
        return { status: 'cancelled' as const };
      }
      const classified =
        error instanceof ArkHttpError
          ? classify(error.status, error.providerCode)
          : { code: 'network', retryable: true };
      return {
        status: 'pending' as const,
        errorCode: classified.code,
        retryable: classified.retryable,
        error: this.redact(
          error instanceof Error ? error.message : 'Ark cancellation is unresolved.',
        ),
      };
    }
  }

  private async submitImage(
    request: MediaProviderEffectRequest,
  ): Promise<MediaProviderSubmissionReceipt> {
    const declaredInputs = request.submission.input?.inputAssets ??
      (request.submission.input?.referenceAssetIds ?? []).map((assetId) => ({
        assetId,
        role: 'reference_image' as const,
      }));
    const resolvedReferences = request.resolvedInputAssets ??
      (request.submission.input?.inputAssets
        ? []
        : (request.resolvedReferenceAssets ?? []).map((asset) => ({
            ...asset,
            role: 'reference_image' as const,
          })));
    const referencesMatch =
      declaredInputs.length === resolvedReferences.length &&
      declaredInputs.every(
        (input, index) =>
          resolvedReferences[index]?.assetId === input.assetId &&
          resolvedReferences[index]?.role === input.role &&
          input.role === 'reference_image' &&
          resolvedReferences[index]?.contentType.startsWith('image/') &&
          Boolean(resolvedReferences[index]?.providerReadableUrl),
      );
    if (declaredInputs.length > 0 && !referencesMatch) {
      throw new ArkAdapterError(
        'reference_asset_resolution_required',
        false,
        'Ark image editing requires provider-readable reference asset URLs.',
      );
    }
    if (
      request.submission.operation === 'image.edit' &&
      resolvedReferences.length === 0
    ) {
      throw new ArkAdapterError(
        'reference_asset_resolution_required',
        false,
        'Ark image editing requires at least one provider-readable reference asset URL.',
      );
    }
    const width = request.submission.input?.width;
    const height = request.submission.input?.height;
    const body = await this.requestJson(
      `${trimTrailingSlash(this.options.baseUrl)}/images/generations`,
      {
        method: 'POST',
        body: JSON.stringify({
          model: this.options.image.model,
          prompt: request.submission.prompt,
          ...(resolvedReferences.length
            ? {
                image: resolvedReferences.map(
                  (asset) => asset.providerReadableUrl,
                ),
              }
            : {}),
          size: width && height ? `${width}x${height}` : '2K',
          sequential_image_generation: 'disabled',
          stream: false,
          response_format: 'url',
        }),
      },
      request.effectIdempotencyKey,
    );
    const parsed = this.parseImage(body);
    const usage = {
      mediaUnits: parsed.usage?.generated_images ?? 1,
      ...(typeof parsed.usage?.output_tokens === 'number'
        ? { outputTokens: parsed.usage.output_tokens }
        : typeof parsed.usage?.total_tokens === 'number'
          ? { outputTokens: parsed.usage.total_tokens }
          : {}),
    };
    const sourceExpiresAt = this.sourceExpiresAt(parsed.created);
    return {
      acceptance: 'accepted',
      taskRef: this.encodeTaskRef({
        version: 1,
        kind: 'image',
        scope: this.scope(request),
        sourceUrl: parsed.data[0]!.url,
        sourceExpiresAt,
        usage,
      }),
      sourceExpiresAt,
      providerCost: this.imageCost(usage),
    };
  }

  private async submitVideo(
    request: MediaProviderEffectRequest,
  ): Promise<MediaProviderSubmissionReceipt> {
    const declaredInputs = request.submission.input?.inputAssets ??
      (request.submission.input?.referenceAssetIds ?? []).map((assetId) => ({
        assetId,
        role: 'reference_image' as const,
      }));
    const resolvedReferences = request.resolvedInputAssets ??
      (request.submission.input?.inputAssets
        ? []
        : (request.resolvedReferenceAssets ?? []).map((asset) => ({
            ...asset,
            role: asset.contentType.startsWith('video/')
              ? ('reference_video' as const)
              : ('reference_image' as const),
          })));
    const referencesMatch =
      declaredInputs.length === resolvedReferences.length &&
      declaredInputs.every(
        (input, index) =>
          resolvedReferences[index]?.assetId === input.assetId &&
          resolvedReferences[index]?.role === input.role &&
          (input.role === 'reference_image' ||
            input.role === 'reference_video') &&
          (input.role === 'reference_video'
            ? resolvedReferences[index]?.contentType.startsWith('video/')
            : resolvedReferences[index]?.contentType.startsWith('image/')) &&
          Boolean(resolvedReferences[index]?.providerReadableUrl),
      );
    if (declaredInputs.length > 0 && !referencesMatch) {
      throw new ArkAdapterError(
        'reference_asset_resolution_required',
        false,
        'Video generation requires provider-readable reference Asset URLs.',
      );
    }
    const body = await this.requestJson(
      `${trimTrailingSlash(this.options.baseUrl)}/contents/generations/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({
          model: this.options.video.model,
          content: [
            { type: 'text', text: this.videoPrompt(request) },
            ...resolvedReferences.map((asset) =>
              asset.role === 'reference_video'
                ? {
                    type: 'video_url',
                    video_url: { url: asset.providerReadableUrl },
                    role: 'reference_video',
                  }
                : {
                    type: 'image_url',
                    image_url: { url: asset.providerReadableUrl },
                    role: 'reference_image',
                  },
            ),
          ],
          ...(request.submission.input?.durationSeconds
            ? { duration: request.submission.input.durationSeconds }
            : {}),
        }),
      },
      request.effectIdempotencyKey,
    );
    if (!isRecord(body) || typeof body.id !== 'string' || !body.id.trim()) {
      throw new Error('Ark video submission returned no task id.');
    }
    return {
      acceptance: 'accepted',
      taskRef: this.encodeTaskRef({
        version: 1,
        kind: 'video',
        scope: this.scope(request),
        providerTaskId: body.id,
      }),
      providerCost: this.estimatedCost(request),
    };
  }

  private async readVideoTask(
    reference: ArkTaskReference,
    request: MediaProviderEffectRequest,
  ) {
    const value = await this.requestJson(
      this.videoTaskUrl(reference),
      { method: 'GET' },
      request.effectIdempotencyKey,
    );
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      value.id !== reference.providerTaskId ||
      !['queued', 'running', 'cancelled', 'succeeded', 'failed'].includes(
        String(value.status),
      )
    ) {
      throw new ArkAdapterError(
        'invalid_response',
        false,
        'Ark video task polling returned an invalid response.',
      );
    }
    return value as unknown as ArkVideoTask;
  }

  private videoTaskUrl(reference: ArkTaskReference) {
    if (!reference.providerTaskId) {
      throw new ArkAdapterError(
        'invalid_task_reference',
        false,
        'Ark video task receipt has no provider task id.',
      );
    }
    return `${trimTrailingSlash(this.options.baseUrl)}/contents/generations/tasks/${encodeURIComponent(reference.providerTaskId)}`;
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    clientRequestId: string,
    allowEmpty = false,
  ) {
    const response = await this.fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
        'x-client-request-id': clientRequestId,
        ...init.headers,
      },
    });
    if (allowEmpty && (response.status === 204 || response.headers.get('content-length') === '0')) {
      if (!response.ok) {
        throw new ArkHttpError(response.status, undefined, `Ark returned HTTP ${response.status}.`);
      }
      return undefined;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (allowEmpty && response.ok) return undefined;
      if (!response.ok) {
        throw new ArkHttpError(
          response.status,
          undefined,
          `Ark returned non-JSON HTTP ${response.status}.`,
        );
      }
      throw new ArkAdapterError(
        'invalid_response',
        false,
        `Ark returned non-JSON HTTP ${response.status}.`,
        'acceptance_unknown',
      );
    }
    if (!response.ok) {
      const details = providerError(body, `Ark returned HTTP ${response.status}.`);
      throw new ArkHttpError(response.status, details.code, details.message);
    }
    return body;
  }

  private parseImage(value: unknown): ArkImageResponse {
    if (!isRecord(value) || !Array.isArray(value.data)) {
      throw new Error('Ark image generation returned an invalid response.');
    }
    const first = value.data[0];
    if (!isRecord(first) || typeof first.url !== 'string' || !first.url.trim()) {
      throw new Error('Ark image generation returned no source URL.');
    }
    return value as unknown as ArkImageResponse;
  }

  private assertCompatible(request: ProviderExecutionRequest) {
    const id = request.model.id;
    if (
      id !== this.options.image.catalogModelId &&
      id !== this.options.video.catalogModelId
    ) {
      throw new ArkAdapterError(
        'unsupported_model',
        false,
        `Ark media adapter does not support catalog model ${id}.`,
      );
    }
    const operation = request.submission.operation;
    if (
      (id === this.options.image.catalogModelId &&
        operation !== 'image.generate' &&
        operation !== 'image.edit') ||
      (id === this.options.video.catalogModelId && operation !== 'video.generate')
    ) {
      throw new ArkAdapterError(
        'unsupported_operation',
        false,
        `Ark media adapter does not support ${operation} for ${id}.`,
      );
    }
  }

  private scope(request: MediaProviderEffectRequest) {
    return createHash('sha256')
      .update(
        [
          request.submission.workspaceId,
          request.effectIdempotencyKey,
          request.model.id,
          this.options.credentialVersion,
        ].join('\0'),
      )
      .digest('hex');
  }

  private encodeTaskRef(reference: ArkTaskReference) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.taskReferenceKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(reference), 'utf8'),
      cipher.final(),
    ]);
    return [
      'ark-media-v1',
      iv.toString('base64url'),
      encrypted.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }

  private decodeTaskRef(
    taskRef: string,
    request: MediaProviderEffectRequest,
  ): ArkTaskReference {
    const parts = taskRef.split('.');
    if (
      parts.length !== 4 ||
      parts[0] !== 'ark-media-v1' ||
      taskRef.length > 16_384
    ) {
      throw new ArkAdapterError(
        'invalid_task_reference',
        false,
        'Invalid Ark media task reference.',
      );
    }
    let parsed: unknown;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.taskReferenceKey(),
        Buffer.from(parts[1]!, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(parts[3]!, 'base64url'));
      parsed = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(parts[2]!, 'base64url')),
          decipher.final(),
        ]).toString('utf8'),
      );
    } catch {
      throw new ArkAdapterError(
        'invalid_task_reference',
        false,
        'Invalid Ark media task reference.',
      );
    }
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      (parsed.kind !== 'image' && parsed.kind !== 'video') ||
      parsed.scope !== this.scope(request) ||
      (request.model.id === this.options.image.catalogModelId
        ? parsed.kind !== 'image'
        : parsed.kind !== 'video')
    ) {
      throw new ArkAdapterError(
        'invalid_task_reference',
        false,
        'Ark media task reference does not match this request scope.',
      );
    }
    return parsed as unknown as ArkTaskReference;
  }

  private imageCost(usage?: ArkTaskReference['usage']) {
    const mediaUnits = usage?.mediaUnits ?? 1;
    return {
      amount: this.options.image.costPerImage * mediaUnits,
      currency: 'CNY' as const,
      usage: {
        mediaUnits,
        ...(usage?.outputTokens === undefined
          ? {}
          : { outputTokens: usage.outputTokens }),
      },
    };
  }

  private videoCost(
    task: ArkVideoTask,
    request: MediaProviderEffectRequest,
  ) {
    const outputTokens =
      task.usage?.completion_tokens ??
      task.usage?.output_tokens ??
      this.estimatedVideoTokens(request);
    return {
      amount:
        Math.round(
          (outputTokens / 1_000_000) *
            this.options.video.costPerMillionTokens *
            1_000_000,
        ) / 1_000_000,
      currency: 'CNY' as const,
      usage: { outputTokens, mediaUnits: 1 },
    };
  }

  private estimatedCost(request: ProviderExecutionRequest, units = 1) {
    if (request.model.id === this.options.image.catalogModelId) {
      return this.imageCost({ mediaUnits: units });
    }
    const outputTokens = units === 0 ? 0 : this.estimatedVideoTokens(request);
    return {
      amount:
        Math.round(
          (outputTokens / 1_000_000) *
            this.options.video.costPerMillionTokens *
            1_000_000,
        ) / 1_000_000,
      currency: 'CNY' as const,
      usage: { outputTokens, mediaUnits: units },
    };
  }

  private estimatedVideoTokens(request: ProviderExecutionRequest) {
    return (
      (request.submission.input?.durationSeconds ?? 1) *
      this.options.video.estimatedTokensPerSecond
    );
  }

  private videoPrompt(request: ProviderExecutionRequest) {
    const width = request.submission.input?.width;
    const height = request.submission.input?.height;
    if (!width || !height) return request.submission.prompt;
    const divisor = greatestCommonDivisor(width, height);
    return `${request.submission.prompt} --ratio ${width / divisor}:${height / divisor}`;
  }

  private unknownPoll(
    request: MediaProviderEffectRequest,
    error: unknown,
  ) {
    if (error instanceof ArkHttpError) {
      const classified = classify(error.status, error.providerCode);
      return {
        status: 'unknown' as const,
        providerCost: this.estimatedCost(request),
        errorCode: classified.code,
        retryable: classified.retryable,
        error: this.redact(error.message),
      };
    }
    if (error instanceof ArkAdapterError) {
      return {
        status: 'unknown' as const,
        providerCost: this.estimatedCost(request),
        errorCode: error.code,
        retryable: error.retryable,
        error: this.redact(error.message),
      };
    }
    return {
      status: 'unknown' as const,
      providerCost: this.estimatedCost(request),
      errorCode: 'network',
      retryable: true,
      error: this.redact(
        error instanceof Error ? error.message : 'Ark task polling failed.',
      ),
    };
  }

  private sourceExpiresAt(epochSeconds?: number) {
    const base =
      typeof epochSeconds === 'number' && Number.isFinite(epochSeconds)
        ? epochSeconds * 1_000
        : this.now().getTime();
    return new Date(
      base + this.options.sourceUrlTtlSeconds * 1_000,
    ).toISOString();
  }

  private taskSourceExpiresAt(task: ArkVideoTask) {
    const updatedAt = Number(task.updated_at);
    return this.sourceExpiresAt(Number.isFinite(updatedAt) ? updatedAt : undefined);
  }

  private taskReferenceKey() {
    return createHash('sha256')
      .update(
        `ark-media-task-reference\0${this.options.apiKey}\0${this.options.credentialVersion}`,
      )
      .digest();
  }

  private assertHttpsSourceUrl(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ArkAdapterError(
        'invalid_response',
        false,
        'Ark returned an invalid asset source URL.',
      );
    }
    if (url.protocol !== 'https:') {
      throw new ArkAdapterError(
        'invalid_response',
        false,
        'Ark asset source URL must use HTTPS.',
      );
    }
  }

  private redact(message: string) {
    return message.split(this.options.apiKey).join('[REDACTED]');
  }

  private observeHealth(input: {
    state: MediaProviderHealthReport['state'];
    reason: string;
    endsAt?: string;
  }) {
    this.lastHealth = {
      state: input.state,
      reason: input.reason,
      source: 'adapter',
      observedAt: this.now().toISOString(),
      drainMode: this.drainMode,
      ...(input.endsAt ? { endsAt: input.endsAt } : {}),
    };
  }
}

function isMissingFile(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function providerAssetFetchRetryable(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return true;
  return [
    'SAFE_FETCH_CONCURRENCY_LIMIT',
    'SAFE_FETCH_DNS_EMPTY',
    'SAFE_FETCH_TIMEOUT',
    'SAFE_FETCH_UPSTREAM_STATUS',
  ].includes(String(error.code));
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}
