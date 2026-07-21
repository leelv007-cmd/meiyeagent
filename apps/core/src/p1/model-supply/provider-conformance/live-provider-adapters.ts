import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenAiCompatibleLlmExecutionPort } from '../adapters.js';
import {
  ArkMediaExecutionPort,
  FileSystemMediaProviderReceiptStore,
} from '../ark-media-adapter.js';
import type {
  MediaProviderEffectRequest,
  MediaProviderLifecyclePort,
  ProviderExecutionRequest,
} from '../provider-lifecycle.js';
import type { ModelOperation } from '../supply-contracts.js';
import { TuziMediaExecutionPort } from '../tuzi-media-adapter.js';
import { ProviderSafeFetch } from '../reference-asset-delivery.js';
import {
  DUAL_CHANNEL_MATRIX_MODELS,
  type DualChannelMatrixModel,
} from './fault-injection/matrix-models.js';
import type {
  LiveProviderAdapterKind,
  LiveProviderChannel,
  LiveProviderProbeEvidence,
} from './live-provider-gate.js';

export interface ResolvedLiveProviderChannel extends LiveProviderChannel {
  apiKey: string;
  baseUrl: string;
  providerModel: string;
  assetSourceHosts: string[];
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  mediaUnitCost: number;
  videoCostPerMillionTokens: number;
  videoEstimatedTokensPerSecond: number;
  sourceUrlTtlSeconds: number;
  credentialVersion: string;
  endpointRevision: string;
}

export interface LiveProviderChannelResolution {
  channels: ResolvedLiveProviderChannel[];
  missingByChannel: Array<{
    operation: ModelOperation;
    channelKind: DualChannelMatrixModel['channelKind'];
    missing: string[];
  }>;
}

type Environment = Readonly<Record<string, string | undefined>>;

function env(source: Environment, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = source[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function numberEnv(
  source: Environment,
  names: string[],
  fallback: number,
): number {
  const raw = env(source, ...names);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function hosts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function resolveLiveProviderChannels(
  source: Environment = process.env,
): LiveProviderChannelResolution {
  const channels: ResolvedLiveProviderChannel[] = [];
  const missingByChannel: LiveProviderChannelResolution['missingByChannel'] = [];

  for (const matrixModel of DUAL_CHANNEL_MATRIX_MODELS) {
    const resolved = resolveChannel(matrixModel, source);
    if ('missing' in resolved) {
      missingByChannel.push({
        operation: matrixModel.operation,
        channelKind: matrixModel.channelKind,
        missing: resolved.missing,
      });
    } else {
      channels.push(resolved);
    }
  }
  return { channels, missingByChannel };
}

function resolveChannel(
  model: DualChannelMatrixModel,
  source: Environment,
): ResolvedLiveProviderChannel | { missing: string[] } {
  const providerModel = env(source, model.modelEnv);
  const isOfficial = model.channelKind === 'official_direct';
  const catalogModelId =
    env(source, catalogModelEnvName(model)) ?? model.catalogModelId;
  const adapterKind: LiveProviderAdapterKind =
    model.modality === 'llm'
      ? 'openai_compatible_llm'
      : isOfficial
        ? 'ark_media'
        : 'tuzi_media';
  const apiKey =
    model.modality === 'llm'
      ? isOfficial
        ? env(source, 'ARK_TEXT_API_KEY', 'ARK_API_KEY', 'ARK_MEDIA_API_KEY')
        : env(source, 'MODEL_DIRECT_API_KEY')
      : isOfficial
        ? env(source, 'ARK_MEDIA_API_KEY', 'ARK_API_KEY')
        : env(source, 'TUZI_MEDIA_API_KEY', 'TUZI_API_KEY');
  const baseUrl =
    model.modality === 'llm'
      ? isOfficial
        ? env(source, 'ARK_TEXT_BASE_URL', 'ARK_BASE_URL') ??
          'https://ark.cn-beijing.volces.com/api/v3'
        : env(source, 'MODEL_DIRECT_BASE_URL')
      : isOfficial
        ? env(source, 'ARK_MEDIA_BASE_URL', 'ARK_BASE_URL') ??
          'https://ark.cn-beijing.volces.com/api/v3'
        : env(source, 'TUZI_MEDIA_BASE_URL', 'TUZI_BASE_URL');
  const assetSourceHostValue =
    model.modality === 'llm'
      ? undefined
      : isOfficial
        ? env(source, 'ARK_MEDIA_ASSET_SOURCE_HOSTS')
        : env(source, 'TUZI_MEDIA_ASSET_SOURCE_HOSTS');
  const accountIdentity = isOfficial
    ? env(source, 'ARK_PROVIDER_ACCOUNT_IDENTITY')
    : model.modality === 'llm'
      ? env(source, 'MODEL_DIRECT_PROVIDER_ACCOUNT_IDENTITY')
      : env(source, 'TUZI_PROVIDER_ACCOUNT_IDENTITY');
  const maxProbeCostName =
    model.modality === 'llm'
      ? isOfficial
        ? 'ARK_TEXT_MAX_PROBE_COST_USD'
        : 'MODEL_DIRECT_MAX_PROBE_COST_USD'
      : model.modality === 'image'
        ? isOfficial
          ? 'ARK_IMAGE_MAX_PROBE_COST_USD'
          : 'TUZI_IMAGE_MAX_PROBE_COST_USD'
        : isOfficial
          ? 'ARK_VIDEO_MAX_PROBE_COST_USD'
          : 'TUZI_VIDEO_MAX_PROBE_COST_USD';
  const maxProbeCostRaw = env(source, maxProbeCostName);
  const maxProbeCostUsd = Number(maxProbeCostRaw);
  const hasValidMaxProbeCost =
    Boolean(maxProbeCostRaw) &&
    Number.isFinite(maxProbeCostUsd) &&
    maxProbeCostUsd > 0;
  const priceNames = priceEnvNames(model);
  const prices = Object.fromEntries(
    priceNames.map((name) => [name, positiveNumberEnv(source, name)]),
  );
  let endpointOrigin: string | undefined;
  if (baseUrl) {
    try {
      endpointOrigin = new URL(baseUrl).origin;
    } catch {
      endpointOrigin = undefined;
    }
  }
  const missing = [
    ...(apiKey ? [] : [credentialLabel(model)]),
    ...(baseUrl ? [] : [baseUrlLabel(model)]),
    ...(providerModel ? [] : [model.modelEnv]),
    ...(accountIdentity ? [] : [accountIdentityLabel(model)]),
    ...(hasValidMaxProbeCost ? [] : [maxProbeCostName]),
    ...priceNames.filter((name) => prices[name] === undefined),
    ...(endpointOrigin ? [] : [`${baseUrlLabel(model)} (valid URL required)`]),
    ...(model.modality !== 'llm' && !assetSourceHostValue
      ? [
          isOfficial
            ? 'ARK_MEDIA_ASSET_SOURCE_HOSTS'
            : 'TUZI_MEDIA_ASSET_SOURCE_HOSTS',
        ]
      : []),
  ];
  if (missing.length > 0) return { missing };

  return {
    model: { ...model, catalogModelId },
    adapterKind,
    accountIdentityFingerprint: fingerprint(accountIdentity!),
    endpointFingerprint: fingerprint(endpointOrigin!),
    maxProbeCostUsd,
    apiKey: apiKey!,
    baseUrl: baseUrl!,
    providerModel: providerModel!,
    assetSourceHosts: hosts(assetSourceHostValue),
    inputCostPerMillion: price(
      prices,
      isOfficial
        ? 'ARK_TEXT_INPUT_COST_PER_MILLION'
        : 'MODEL_DIRECT_INPUT_COST_PER_MILLION',
    ),
    outputCostPerMillion: price(
      prices,
      isOfficial
        ? 'ARK_TEXT_OUTPUT_COST_PER_MILLION'
        : 'MODEL_DIRECT_OUTPUT_COST_PER_MILLION',
    ),
    mediaUnitCost: price(
      prices,
      isOfficial
        ? 'ARK_SEEDREAM_COST_PER_IMAGE_CNY'
        : 'TUZI_IMAGE_COST_PER_IMAGE_USD',
    ),
    videoCostPerMillionTokens: price(
      prices,
      isOfficial
        ? 'ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY'
        : 'TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_USD',
    ),
    videoEstimatedTokensPerSecond: price(
      prices,
      isOfficial
        ? 'ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND'
        : 'TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND',
    ),
    sourceUrlTtlSeconds: numberEnv(
      source,
      isOfficial
        ? ['ARK_MEDIA_SOURCE_URL_TTL_SECONDS']
        : ['TUZI_MEDIA_SOURCE_URL_TTL_SECONDS'],
      3600,
    ),
    credentialVersion:
      env(
        source,
        isOfficial
          ? 'ARK_MEDIA_CREDENTIAL_VERSION'
          : 'TUZI_MEDIA_CREDENTIAL_VERSION',
      ) ?? 'provider-live-v1',
    endpointRevision:
      env(
        source,
        isOfficial
          ? 'ARK_MEDIA_ENDPOINT_REVISION'
          : 'TUZI_MEDIA_ENDPOINT_REVISION',
      ) ?? `${adapterKind}:provider-live-v1`,
  };
}

function priceEnvNames(model: DualChannelMatrixModel): string[] {
  const official = model.channelKind === 'official_direct';
  if (model.modality === 'llm') {
    return official
      ? [
          'ARK_TEXT_INPUT_COST_PER_MILLION',
          'ARK_TEXT_OUTPUT_COST_PER_MILLION',
        ]
      : [
          'MODEL_DIRECT_INPUT_COST_PER_MILLION',
          'MODEL_DIRECT_OUTPUT_COST_PER_MILLION',
        ];
  }
  if (model.modality === 'image') {
    return [
      official
        ? 'ARK_SEEDREAM_COST_PER_IMAGE_CNY'
        : 'TUZI_IMAGE_COST_PER_IMAGE_USD',
    ];
  }
  return [
    official
      ? 'ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY'
      : 'TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_USD',
    official
      ? 'ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND'
      : 'TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND',
  ];
}

function positiveNumberEnv(
  source: Environment,
  name: string,
): number | undefined {
  const value = Number(env(source, name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function price(
  prices: Readonly<Record<string, number | undefined>>,
  name: string,
): number {
  return prices[name] ?? 0;
}

function catalogModelEnvName(model: DualChannelMatrixModel): string {
  if (model.modality === 'llm') {
    return model.channelKind === 'official_direct'
      ? 'ARK_TEXT_CATALOG_MODEL_ID'
      : 'MODEL_DIRECT_CATALOG_MODEL_ID';
  }
  if (model.modality === 'image') {
    return model.channelKind === 'official_direct'
      ? 'ARK_IMAGE_CATALOG_MODEL_ID'
      : 'TUZI_IMAGE_CATALOG_MODEL_ID';
  }
  return model.channelKind === 'official_direct'
    ? 'ARK_VIDEO_CATALOG_MODEL_ID'
    : 'TUZI_VIDEO_CATALOG_MODEL_ID';
}

function accountIdentityLabel(model: DualChannelMatrixModel): string {
  if (model.channelKind === 'official_direct') {
    return 'ARK_PROVIDER_ACCOUNT_IDENTITY';
  }
  return model.modality === 'llm'
    ? 'MODEL_DIRECT_PROVIDER_ACCOUNT_IDENTITY'
    : 'TUZI_PROVIDER_ACCOUNT_IDENTITY';
}

function credentialLabel(model: DualChannelMatrixModel): string {
  if (model.modality === 'llm') {
    return model.channelKind === 'official_direct'
      ? 'ARK_TEXT_API_KEY|ARK_API_KEY'
      : 'MODEL_DIRECT_API_KEY';
  }
  return model.channelKind === 'official_direct'
    ? 'ARK_MEDIA_API_KEY|ARK_API_KEY'
    : 'TUZI_MEDIA_API_KEY|TUZI_API_KEY';
}

function baseUrlLabel(model: DualChannelMatrixModel): string {
  if (model.modality === 'llm') {
    return model.channelKind === 'official_direct'
      ? 'ARK_TEXT_BASE_URL|ARK_BASE_URL (default available)'
      : 'MODEL_DIRECT_BASE_URL';
  }
  return model.channelKind === 'official_direct'
    ? 'ARK_MEDIA_BASE_URL|ARK_BASE_URL (default available)'
    : 'TUZI_MEDIA_BASE_URL|TUZI_BASE_URL';
}

export async function probeLiveProviderChannel(
  channel: ResolvedLiveProviderChannel,
): Promise<LiveProviderProbeEvidence> {
  return channel.model.modality === 'llm'
    ? probeLiveTextChannel(channel)
    : probeLiveMediaChannel(channel);
}

async function probeLiveTextChannel(
  channel: ResolvedLiveProviderChannel,
): Promise<LiveProviderProbeEvidence> {
  const observedAt = new Date().toISOString();
  const request = createProviderRequest(channel, randomUUID());
  try {
    const adapter = new OpenAiCompatibleLlmExecutionPort({
      catalogModelId: channel.model.catalogModelId,
      baseUrl: channel.baseUrl,
      apiKey: channel.apiKey,
      model: channel.providerModel,
      inputCostPerMillion: channel.inputCostPerMillion,
      outputCostPerMillion: channel.outputCostPerMillion,
      currency:
        channel.model.channelKind === 'official_direct' ? 'CNY' : 'USD',
    });
    const response = await adapter.execute(request);
    if (response.kind === 'failure') {
      return failedEvidence(channel, observedAt, {
        acceptance: response.acceptance,
        adapterExecuted: true,
        failureCode: response.errorCode,
        failureMessage: response.message,
        providerCost: response.providerCost,
      });
    }
    return {
      ...baseEvidence(channel, observedAt),
      acceptance: 'accepted',
      adapterExecuted: true,
      providerCallSucceeded: Boolean(response.providerTaskRef),
      providerTaskRef: response.providerTaskRef,
      providerCost: providerCostEvidence(response.providerCost),
      lifecycle: {
        submitted: true,
        recovered: true,
        pollStatus: 'completed',
        downloaded: false,
      },
    };
  } catch (error) {
    return failedEvidence(channel, observedAt, {
      acceptance: 'acceptance_unknown',
      adapterExecuted: true,
      failureCode: 'adapter_exception',
      failureMessage: safeError(error),
    });
  }
}

async function probeLiveMediaChannel(
  channel: ResolvedLiveProviderChannel,
): Promise<LiveProviderProbeEvidence> {
  const observedAt = new Date().toISOString();
  const receiptDirectory = await mkdtemp(
    join(tmpdir(), `provider-live-${channel.model.modality}-`),
  );
  try {
    const receiptStore = new FileSystemMediaProviderReceiptStore(
      receiptDirectory,
    );
    const request = {
      ...createProviderRequest(channel, randomUUID()),
      effectIdempotencyKey: `provider-live:${randomUUID()}`,
    } satisfies MediaProviderEffectRequest;
    const adapter = createMediaAdapter(channel, receiptStore);
    const receipt = await adapter.submit(request);
    if (receipt.acceptance !== 'accepted' || !receipt.taskRef) {
      return failedEvidence(channel, observedAt, {
        acceptance: receipt.acceptance,
        adapterExecuted: true,
        failureCode: receipt.errorCode,
        failureMessage: receipt.error,
        providerCost: receipt.providerCost,
      });
    }

    // Reconstruct the adapter around the durable store. A matching receipt is
    // the executable process-restart recovery seam, not an in-memory lookup.
    const recoveredAdapter = createMediaAdapter(
      channel,
      new FileSystemMediaProviderReceiptStore(receiptDirectory),
    );
    const recovered = await recoveredAdapter.recover(request);
    const recoveredMatches =
      recovered?.acceptance === 'accepted' &&
      recovered.taskRef === receipt.taskRef;
    const terminal = await waitForMediaTerminal(
      recoveredAdapter,
      request,
      receipt.taskRef,
    );
    if (terminal.status !== 'completed') {
      return failedEvidence(channel, observedAt, {
        acceptance: 'accepted',
        adapterExecuted: true,
        failureCode: terminal.errorCode ?? `terminal_${terminal.status}`,
        failureMessage: terminal.error,
        providerCost: terminal.providerCost,
        providerTaskRef: receipt.taskRef,
        lifecycle: {
          submitted: true,
          recovered: recoveredMatches,
          pollStatus: terminal.status,
          downloaded: false,
        },
      });
    }
    const asset = await recoveredAdapter.download({
      ...request,
      taskRef: receipt.taskRef,
    });

    // Prove drain on a newly reconstructed live adapter. This rejection is
    // local and must happen before another paid provider request.
    recoveredAdapter.setDrainMode?.('draining');
    const drainReceipt = await recoveredAdapter.submit({
      ...request,
      effectIdempotencyKey: `${request.effectIdempotencyKey}:drain`,
      submission: {
        ...request.submission,
        idempotencyKey: `${request.submission.idempotencyKey}:drain`,
      },
    });
    recoveredAdapter.setDrainMode?.('accepting');
    const drainPassed =
      drainReceipt.acceptance === 'rejected_before_accept' &&
      drainReceipt.errorCode === 'channel_draining';
    const providerCallSucceeded =
      recoveredMatches && drainPassed && asset.bytes.byteLength > 0;

    return {
      ...baseEvidence(channel, observedAt),
      acceptance: 'accepted',
      adapterExecuted: true,
      providerCallSucceeded,
      providerTaskRef: receipt.taskRef,
      providerCost: providerCostEvidence(terminal.providerCost),
      lifecycle: {
        submitted: true,
        recovered: recoveredMatches,
        pollStatus: terminal.status,
        downloaded: asset.bytes.byteLength > 0,
        downloadedBytes: asset.bytes.byteLength,
        contentType: asset.contentType,
        assetSha256: createHash('sha256').update(asset.bytes).digest('hex'),
      },
      ...(!drainPassed
        ? {
            failureCode: 'drain_conformance_failed',
            failureMessage:
              'Reconstructed adapter did not reject a new submit while draining.',
          }
        : {}),
    };
  } catch (error) {
    return failedEvidence(channel, observedAt, {
      acceptance: 'acceptance_unknown',
      adapterExecuted: true,
      failureCode: 'adapter_exception',
      failureMessage: safeError(error),
    });
  } finally {
    await rm(receiptDirectory, { force: true, recursive: true });
  }
}

function createMediaAdapter(
  channel: ResolvedLiveProviderChannel,
  receiptStore: FileSystemMediaProviderReceiptStore,
): MediaProviderLifecyclePort {
  const configuredAssetHosts = new Set(
    [new URL(channel.baseUrl).hostname, ...channel.assetSourceHosts].map(
      (host) => host.toLowerCase(),
    ),
  );
  const safeAssetFetch = new ProviderSafeFetch({
    allowedHosts: [...configuredAssetHosts],
    resolver: { resolve: resolveThroughPublicDoh },
  });
  const common = {
    apiKey: channel.apiKey,
    assetFetch: {
      get: async (
        target: string,
        constraints: Parameters<typeof safeAssetFetch.get>[1],
      ) => {
        const targetHost = new URL(target).hostname.toLowerCase();
        if (!configuredAssetHosts.has(targetHost)) {
          throw new Error(
            `provider_asset_host_unconfigured:${createHash('sha256')
              .update(targetHost)
              .digest('hex')}`,
          );
        }
        return safeAssetFetch.get(target, constraints);
      },
    },
    assetSourceHosts: channel.assetSourceHosts,
    baseUrl: channel.baseUrl,
    credentialVersion: channel.credentialVersion,
    endpointRevision: channel.endpointRevision,
    image: {
      catalogModelId:
        channel.model.modality === 'image'
          ? channel.model.catalogModelId === 'gpt-image-2'
            ? ('gpt-image-2' as const)
            : ('seedream-5-pro' as const)
          : ('seedream-5-pro' as const),
      costPerImage: channel.mediaUnitCost,
      model:
        channel.model.modality === 'image'
          ? channel.providerModel
          : 'unused-provider-live-image',
    },
    receiptStore,
    sourceUrlTtlSeconds: channel.sourceUrlTtlSeconds,
    video: {
      catalogModelId:
        channel.model.modality === 'video'
          ? channel.model.catalogModelId
          : 'unused-provider-live-video',
      costPerMillionTokens: channel.videoCostPerMillionTokens,
      estimatedTokensPerSecond: channel.videoEstimatedTokensPerSecond,
      model:
        channel.model.modality === 'video'
          ? channel.providerModel
          : 'unused-provider-live-video',
    },
  };
  return channel.adapterKind === 'ark_media'
    ? new ArkMediaExecutionPort(common)
    : new TuziMediaExecutionPort({
        ...common,
        video: {
          ...common.video,
          catalogModelId:
            channel.model.modality === 'video'
              ? ('seedance-1-5-pro' as const)
              : ('seedance-1-5-pro' as const),
        },
      });
}

async function resolveThroughPublicDoh(hostname: string): Promise<string[]> {
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', 'A');
  const response = await fetch(url, {
    headers: { accept: 'application/dns-json' },
  });
  if (!response.ok) {
    throw new Error(`Public DNS returned HTTP ${response.status}.`);
  }
  const body = (await response.json()) as {
    Answer?: Array<{ data?: unknown; type?: unknown }>;
    Status?: unknown;
  };
  if (body.Status !== 0) {
    throw new Error('Public DNS did not resolve the provider host.');
  }
  return (body.Answer ?? []).flatMap((answer) =>
    answer.type === 1 && typeof answer.data === 'string' ? [answer.data] : [],
  );
}

async function waitForMediaTerminal(
  adapter: MediaProviderLifecyclePort,
  request: MediaProviderEffectRequest,
  taskRef: string,
) {
  const timeoutMs = numberEnv(
    process.env,
    ['PROVIDER_LIVE_MEDIA_TIMEOUT_MS'],
    18 * 60_000,
  );
  const intervalMs = Math.max(
    250,
    numberEnv(process.env, ['PROVIDER_LIVE_POLL_INTERVAL_MS'], 10_000),
  );
  const deadline = Date.now() + timeoutMs;
  let state = await adapter.poll({ ...request, taskRef });
  while (
    (state.status === 'queued' || state.status === 'running') &&
    Date.now() < deadline
  ) {
    await delay(intervalMs);
    state = await adapter.poll({ ...request, taskRef });
  }
  return state;
}

function createProviderRequest(
  channel: ResolvedLiveProviderChannel,
  idempotencyKey: string,
): ProviderExecutionRequest {
  const operation = channel.model.operation as ModelOperation;
  const prompt =
    channel.model.modality === 'llm'
      ? JSON.stringify({
          grounding: {
            name: '真机验收门店',
            city: '北京',
            project: '指甲护理',
            price: 199,
          },
          brief: { hook: '生成三条可核对且表达不同的门店文案' },
        })
      : channel.model.modality === 'image'
        ? 'A clean editorial still life of a white skincare bottle on warm beige stone, soft daylight, no text, no logo.'
        : 'A calm close-up of neutral nail polish bottles on a clean studio table, subtle camera movement, no people, no text.';
  return {
    jobId: `provider-live-${randomUUID()}`,
    model: {
      id: channel.model.catalogModelId,
      displayName: channel.model.catalogModelId,
      modality: channel.model.modality,
      operations: [operation],
      qualityRank: 80,
      manufacturer: channel.model.manufacturer,
      stableModelName: channel.providerModel,
    },
    deployment: {
      id: deploymentId(channel),
      catalogModelId: channel.model.catalogModelId,
      providerProfileId: channel.model.providerProfileId,
      executionChannelId: `live-${channel.model.channelKind}`,
      providerModel: channel.providerModel,
      endpointRevision: channel.endpointRevision,
      apiFamily:
        channel.model.modality === 'llm'
          ? 'openai'
          : channel.model.modality === 'image'
            ? 'image'
            : 'media',
      channel:
        channel.model.channelKind === 'official_direct' ? 'direct' : 'managed',
      region:
        channel.model.channelKind === 'official_direct'
          ? 'domestic'
          : 'overseas',
      status: 'active',
      credentialMode: 'platform',
      credentialVersion: channel.credentialVersion,
    },
    submission: {
      workspaceId: 'provider-live-gate',
      actorId: 'provider-live-ci',
      idempotencyKey,
      operation,
      selection: {
        mode: 'fixed',
        catalogModelId: channel.model.catalogModelId,
      },
      dataClass: [],
      prompt,
      ...(channel.model.modality === 'image'
        ? { input: { width: 2048, height: 2048 } }
        : channel.model.modality === 'video'
          ? { input: { durationSeconds: 5, width: 720, height: 1280 } }
          : {}),
    },
  };
}

function baseEvidence(
  channel: ResolvedLiveProviderChannel,
  observedAt: string,
): Pick<
  LiveProviderProbeEvidence,
  | 'operation'
  | 'modality'
  | 'channelKind'
  | 'catalogModelId'
  | 'providerProfileId'
  | 'deploymentId'
  | 'adapterKind'
  | 'accountIdentityFingerprint'
  | 'endpointFingerprint'
  | 'evidenceRef'
  | 'observedAt'
> {
  return {
    operation: channel.model.operation,
    modality: channel.model.modality,
    channelKind: channel.model.channelKind,
    catalogModelId: channel.model.catalogModelId,
    providerProfileId: channel.model.providerProfileId,
    deploymentId: deploymentId(channel),
    adapterKind: channel.adapterKind,
    accountIdentityFingerprint: channel.accountIdentityFingerprint,
    endpointFingerprint: channel.endpointFingerprint,
    evidenceRef: `provider-live:${channel.model.operation}:${channel.model.channelKind}:${randomUUID()}`,
    observedAt,
  };
}

function deploymentId(channel: ResolvedLiveProviderChannel): string {
  return (
    channel.deploymentId ??
    `live-${channel.model.modality}-${channel.model.channelKind}`
  );
}

function failedEvidence(
  channel: ResolvedLiveProviderChannel,
  observedAt: string,
  detail: {
    acceptance: LiveProviderProbeEvidence['acceptance'];
    adapterExecuted: boolean;
    providerTaskRef?: string;
    providerCost?: LiveProviderProbeEvidence['providerCost'];
    lifecycle?: LiveProviderProbeEvidence['lifecycle'];
    failureCode?: string;
    failureMessage?: string;
  },
): LiveProviderProbeEvidence {
  return {
    ...baseEvidence(channel, observedAt),
    acceptance: detail.acceptance,
    adapterExecuted: detail.adapterExecuted,
    providerCallSucceeded: false,
    providerTaskRef: detail.providerTaskRef,
    providerCost: providerCostEvidence(
      detail.providerCost ?? {
        amount: 0,
        currency:
          channel.model.channelKind === 'official_direct' ? 'CNY' : 'USD',
      },
    ),
    lifecycle: detail.lifecycle ?? {
      submitted: false,
      recovered: false,
      downloaded: false,
    },
    failureCode: detail.failureCode,
    failureMessage: redactedFailureMessage(detail.failureMessage),
    ...(detail.failureMessage
      ? {
          failureDetailSha256: createHash('sha256')
            .update(detail.failureMessage)
            .digest('hex'),
        }
      : {}),
  };
}

function providerCostEvidence(
  cost: LiveProviderProbeEvidence['providerCost'],
): LiveProviderProbeEvidence['providerCost'] {
  if (cost.currency === 'USD') return { ...cost, amountUsd: cost.amount };
  if (cost.amount === 0) return { ...cost, amountUsd: 0 };
  const cnyPerUsd = Number(process.env.PROVIDER_LIVE_CNY_PER_USD);
  const evidenceRef = process.env.PROVIDER_LIVE_FX_EVIDENCE_REF?.trim();
  if (
    !Number.isFinite(cnyPerUsd) ||
    cnyPerUsd <= 0 ||
    !evidenceRef
  ) {
    return cost;
  }
  return {
    ...cost,
    amountUsd: cost.amount / cnyPerUsd,
    fx: {
      cnyPerUsd,
      evidenceRef,
      observedAt: new Date().toISOString(),
    },
  };
}

function safeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown';
}

function redactedFailureMessage(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/does not exist or you do not have access/iu.test(value)) {
    return 'Configured provider model is unavailable to this credential.';
  }
  if (/duration[^.]{0,160}not supported/iu.test(value)) {
    return 'Configured provider model rejected the requested duration.';
  }
  if (/provider_asset_host_unconfigured:[a-f0-9]{64}/u.test(value)) {
    return value.match(/provider_asset_host_unconfigured:[a-f0-9]{64}/u)?.[0];
  }
  return 'Provider adapter returned a redacted failure.';
}
