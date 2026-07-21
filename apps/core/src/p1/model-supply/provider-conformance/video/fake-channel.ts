/**
 * Dual-channel fake video providers for MP-04V unit conformance.
 * official_direct + upstream_reseller share the MediaProviderLifecyclePort surface
 * with durable receipt stores so kill-restart recover can be simulated.
 *
 * Video-specific: duration-based usage evidence + provider URL TTL on receipts.
 */
import { createHash } from 'node:crypto';
import type {
  MediaProviderDrainMode,
  MediaProviderEffectRequest,
  MediaProviderHealthReport,
  MediaProviderLifecyclePort,
  MediaProviderReceiptStore,
  MediaProviderSubmissionReceipt,
} from '../../provider-lifecycle.js';
import { recordedRequest } from '../../adapters.js';

/** Minimal non-empty MP4-ish payload (ftyp box header bytes). */
export const FAKE_MP4 = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00,
  0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
]);

export class MemoryReceiptStore implements MediaProviderReceiptStore {
  private readonly receipts = new Map<string, MediaProviderSubmissionReceipt>();

  async get(scope: string) {
    const value = this.receipts.get(scope);
    return value ? structuredClone(value) : undefined;
  }

  async put(scope: string, receipt: MediaProviderSubmissionReceipt) {
    this.receipts.set(scope, structuredClone(receipt));
  }
}

export interface FakeVideoChannelOptions {
  channelId: string;
  channelKind: 'official_direct' | 'upstream_reseller';
  catalogModelId?: 'seedance-1-5-pro' | 'seedance-2' | 'veo-latest';
  /** Cost per second of requested duration. */
  costPerSecond?: number;
  currency?: 'CNY' | 'USD';
  estimatedTokensPerSecond?: number;
  sourceUrlTtlSeconds?: number;
  defaultDurationSeconds?: number;
  receiptStore?: MediaProviderReceiptStore;
}

export class FakeVideoChannelPort implements MediaProviderLifecyclePort {
  readonly channelId: string;
  readonly channelKind: 'official_direct' | 'upstream_reseller';
  submitCount = 0;
  private readonly receiptStore: MediaProviderReceiptStore;
  private readonly catalogModelId:
    | 'seedance-1-5-pro'
    | 'seedance-2'
    | 'veo-latest';
  private readonly costPerSecond: number;
  private readonly currency: 'CNY' | 'USD';
  private readonly estimatedTokensPerSecond: number;
  private readonly sourceUrlTtlSeconds: number;
  private readonly defaultDurationSeconds: number;
  private drainMode: MediaProviderDrainMode = 'accepting';
  private forceUnknown = false;
  private lateTerminal = new Map<string, true>();
  private cancelled = new Set<string>();
  private lastHealth: MediaProviderHealthReport = {
    state: 'healthy',
    reason: 'adapter_ready',
    source: 'adapter',
    observedAt: new Date(0).toISOString(),
  };

  constructor(options: FakeVideoChannelOptions) {
    this.channelId = options.channelId;
    this.channelKind = options.channelKind;
    this.catalogModelId = options.catalogModelId ?? 'seedance-2';
    this.costPerSecond = options.costPerSecond ?? 0.05;
    this.currency = options.currency ?? 'CNY';
    this.estimatedTokensPerSecond = options.estimatedTokensPerSecond ?? 10_000;
    this.sourceUrlTtlSeconds = options.sourceUrlTtlSeconds ?? 3_600;
    this.defaultDurationSeconds = options.defaultDurationSeconds ?? 5;
    this.receiptStore = options.receiptStore ?? new MemoryReceiptStore();
  }

  buildRequest(input: {
    effectIdempotencyKey?: string;
    workspaceId?: string;
    durationSeconds?: number;
  } = {}): MediaProviderEffectRequest {
    const durationSeconds =
      input.durationSeconds ?? this.defaultDurationSeconds;
    const base = recordedRequest(this.catalogModelId, 'video.generate', {
      durationSeconds,
    });
    return {
      ...base,
      effectIdempotencyKey:
        input.effectIdempotencyKey ?? `${this.channelId}-effect`,
      submission: {
        ...base.submission,
        workspaceId: input.workspaceId ?? base.submission.workspaceId,
        prompt: `${this.channelId} video conformance`,
        input: {
          ...base.submission.input,
          durationSeconds,
        },
      },
      deployment: {
        ...base.deployment,
        executionChannelId: this.channelId,
      },
    };
  }

  forceAcceptanceUnknown() {
    this.forceUnknown = true;
  }

  forceLateTerminalSuccess(taskRef: string) {
    this.lateTerminal.set(taskRef, true);
    this.cancelled.delete(taskRef);
  }

  async submit(
    request: MediaProviderEffectRequest,
  ): Promise<MediaProviderSubmissionReceipt> {
    const scope = this.scope(request);
    const existing = await this.receiptStore.get(scope);
    if (existing) return structuredClone(existing);

    if (this.drainMode === 'draining') {
      return {
        acceptance: 'rejected_before_accept',
        providerCost: this.emptyCost(),
        errorCode: 'channel_draining',
        retryable: false,
        error: `${this.channelId} is draining.`,
      };
    }

    this.submitCount += 1;
    if (this.forceUnknown) {
      const unknown: MediaProviderSubmissionReceipt = {
        acceptance: 'acceptance_unknown',
        taskRef: `fake-video-unknown-${scope.slice(0, 16)}`,
        providerCost: this.emptyCost(),
        errorCode: 'acceptance_unknown',
        retryable: false,
        error: `${this.channelId} acceptance is unresolved.`,
      };
      await this.receiptStore.put(scope, unknown);
      this.lastHealth = {
        state: 'degraded',
        reason: 'acceptance_unknown',
        source: 'adapter',
        observedAt: new Date().toISOString(),
        drainMode: this.drainMode,
      };
      return structuredClone(unknown);
    }

    const durationSeconds = this.durationSeconds(request);
    const sourceExpiresAt = new Date(
      Date.now() + this.sourceUrlTtlSeconds * 1_000,
    ).toISOString();
    const receipt: MediaProviderSubmissionReceipt = {
      acceptance: 'accepted',
      taskRef: `fake-video-${this.channelKind}-${scope.slice(0, 20)}`,
      sourceExpiresAt,
      providerCost: this.costForDuration(durationSeconds),
    };
    await this.receiptStore.put(scope, receipt);
    this.lastHealth = {
      state: 'healthy',
      reason: 'submit_accepted',
      source: 'adapter',
      observedAt: new Date().toISOString(),
      drainMode: this.drainMode,
    };
    return structuredClone(receipt);
  }

  async recover(request: MediaProviderEffectRequest) {
    const existing = await this.receiptStore.get(this.scope(request));
    if (existing) return structuredClone(existing);
    return {
      acceptance: 'acceptance_unknown' as const,
      providerCost: this.emptyCost(),
      errorCode: 'recovery_unavailable',
      retryable: false,
      error: `${this.channelId} has no durable receipt for this effect.`,
    };
  }

  async poll(request: MediaProviderEffectRequest & { taskRef: string }) {
    const receipt = await this.receiptStore.get(this.scope(request));
    if (!receipt || receipt.taskRef !== request.taskRef) {
      return {
        status: 'unknown' as const,
        providerCost: this.emptyCost(),
        errorCode: 'unknown_task',
        retryable: false,
        error: 'Unknown fake video task.',
      };
    }
    if (receipt.acceptance === 'acceptance_unknown') {
      return {
        status: 'unknown' as const,
        providerCost: receipt.providerCost,
        errorCode: receipt.errorCode,
        retryable: false,
        error: receipt.error,
      };
    }
    // Late terminal after cancel still surfaces completed + duration usage cost.
    if (this.lateTerminal.has(request.taskRef)) {
      const durationSeconds = this.durationSeconds(request);
      return {
        status: 'completed' as const,
        providerCost: this.costForDuration(durationSeconds, 1.25),
        sourceExpiresAt: receipt.sourceExpiresAt,
      };
    }
    if (this.cancelled.has(request.taskRef)) {
      return {
        status: 'failed' as const,
        providerCost: receipt.providerCost,
        errorCode: 'provider_cancelled',
        retryable: false,
        error: 'Fake video task was cancelled.',
      };
    }
    return {
      status: 'completed' as const,
      providerCost: receipt.providerCost,
      sourceExpiresAt: receipt.sourceExpiresAt,
    };
  }

  async download(request: MediaProviderEffectRequest & { taskRef: string }) {
    const polled = await this.poll(request);
    if (polled.status !== 'completed') {
      throw new Error('Fake video asset is not ready.');
    }
    if (polled.sourceExpiresAt && Date.parse(polled.sourceExpiresAt) <= Date.now()) {
      throw new Error('Fake video provider URL TTL expired before owned persist.');
    }
    return {
      bytes: Uint8Array.from(FAKE_MP4),
      contentType: 'video/mp4' as const,
      sourceExpiresAt: polled.sourceExpiresAt,
    };
  }

  async cancel(request: MediaProviderEffectRequest & { taskRef: string }) {
    const receipt = await this.receiptStore.get(this.scope(request));
    if (!receipt || receipt.taskRef !== request.taskRef) {
      return {
        status: 'pending' as const,
        errorCode: 'unknown_task',
        retryable: false,
        error: 'Unknown fake video task.',
      };
    }
    if (this.lateTerminal.has(request.taskRef)) {
      return {
        status: 'pending' as const,
        errorCode: 'already_completed',
        retryable: false,
        error: 'Fake video already reached a late terminal success.',
      };
    }
    this.cancelled.add(request.taskRef);
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

  getDrainMode() {
    return this.drainMode;
  }

  private durationSeconds(request: MediaProviderEffectRequest) {
    const value = request.submission.input?.durationSeconds;
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : this.defaultDurationSeconds;
  }

  private costForDuration(durationSeconds: number, multiplier = 1) {
    const outputTokens = durationSeconds * this.estimatedTokensPerSecond;
    return {
      amount:
        Math.round(this.costPerSecond * durationSeconds * multiplier * 1_000_000) /
        1_000_000,
      currency: this.currency,
      usage: {
        mediaUnits: durationSeconds,
        outputTokens,
      },
    };
  }

  private scope(request: MediaProviderEffectRequest) {
    return createHash('sha256')
      .update(
        [
          this.channelId,
          request.submission.workspaceId,
          request.effectIdempotencyKey,
          request.model.id,
        ].join('\0'),
      )
      .digest('hex');
  }

  private emptyCost() {
    return {
      amount: 0,
      currency: this.currency,
      usage: {},
    };
  }
}

export function createDualChannelHarnesses(sharedStores?: {
  official?: MediaProviderReceiptStore;
  reseller?: MediaProviderReceiptStore;
}) {
  const officialStore = sharedStores?.official ?? new MemoryReceiptStore();
  const resellerStore = sharedStores?.reseller ?? new MemoryReceiptStore();

  let officialPort = new FakeVideoChannelPort({
    channelId: 'channel-ark-seedance-official',
    channelKind: 'official_direct',
    catalogModelId: 'seedance-2',
    costPerSecond: 0.05,
    currency: 'CNY',
    receiptStore: officialStore,
  });
  let resellerPort = new FakeVideoChannelPort({
    channelId: 'channel-tuzi-veo-reseller',
    channelKind: 'upstream_reseller',
    catalogModelId: 'veo-latest',
    costPerSecond: 0.08,
    currency: 'USD',
    receiptStore: resellerStore,
  });

  const official = {
    channelId: officialPort.channelId,
    channelKind: 'official_direct' as const,
    createPort: () => {
      officialPort = new FakeVideoChannelPort({
        channelId: 'channel-ark-seedance-official',
        channelKind: 'official_direct',
        catalogModelId: 'seedance-2',
        costPerSecond: 0.05,
        currency: 'CNY',
        receiptStore: officialStore,
      });
      return officialPort;
    },
    restartPort: () =>
      new FakeVideoChannelPort({
        channelId: 'channel-ark-seedance-official',
        channelKind: 'official_direct',
        catalogModelId: 'seedance-2',
        costPerSecond: 0.05,
        currency: 'CNY',
        receiptStore: officialStore,
      }),
    buildRequest: (input?: {
      effectIdempotencyKey?: string;
      workspaceId?: string;
      durationSeconds?: number;
    }) => officialPort.buildRequest(input),
    forceAcceptanceUnknown: (port: MediaProviderLifecyclePort) => {
      (port as FakeVideoChannelPort).forceAcceptanceUnknown();
    },
    forceLateTerminalSuccess: (
      port: MediaProviderLifecyclePort,
      taskRef: string,
    ) => {
      (port as FakeVideoChannelPort).forceLateTerminalSuccess(taskRef);
    },
    submitCount: () => officialPort.submitCount,
  };

  const reseller = {
    channelId: resellerPort.channelId,
    channelKind: 'upstream_reseller' as const,
    createPort: () => {
      resellerPort = new FakeVideoChannelPort({
        channelId: 'channel-tuzi-veo-reseller',
        channelKind: 'upstream_reseller',
        catalogModelId: 'veo-latest',
        costPerSecond: 0.08,
        currency: 'USD',
        receiptStore: resellerStore,
      });
      return resellerPort;
    },
    restartPort: () =>
      new FakeVideoChannelPort({
        channelId: 'channel-tuzi-veo-reseller',
        channelKind: 'upstream_reseller',
        catalogModelId: 'veo-latest',
        costPerSecond: 0.08,
        currency: 'USD',
        receiptStore: resellerStore,
      }),
    buildRequest: (input?: {
      effectIdempotencyKey?: string;
      workspaceId?: string;
      durationSeconds?: number;
    }) => resellerPort.buildRequest(input),
    forceAcceptanceUnknown: (port: MediaProviderLifecyclePort) => {
      (port as FakeVideoChannelPort).forceAcceptanceUnknown();
    },
    forceLateTerminalSuccess: (
      port: MediaProviderLifecyclePort,
      taskRef: string,
    ) => {
      (port as FakeVideoChannelPort).forceLateTerminalSuccess(taskRef);
    },
    submitCount: () => resellerPort.submitCount,
  };

  return { official, reseller, officialStore, resellerStore };
}
