/**
 * Dual-channel fake image providers for MP-04I unit conformance.
 * official_direct + upstream_reseller share the MediaProviderLifecyclePort surface
 * with durable receipt stores so kill-restart recover can be simulated.
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

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
);

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

export interface FakeImageChannelOptions {
  channelId: string;
  channelKind: 'official_direct' | 'upstream_reseller';
  catalogModelId?: 'seedream-5-pro' | 'gpt-image-2';
  costPerImage?: number;
  currency?: 'CNY' | 'USD';
  sourceUrlTtlSeconds?: number;
  receiptStore?: MediaProviderReceiptStore;
}

export class FakeImageChannelPort implements MediaProviderLifecyclePort {
  readonly channelId: string;
  readonly channelKind: 'official_direct' | 'upstream_reseller';
  submitCount = 0;
  private readonly receiptStore: MediaProviderReceiptStore;
  private readonly catalogModelId: 'seedream-5-pro' | 'gpt-image-2';
  private readonly costPerImage: number;
  private readonly currency: 'CNY' | 'USD';
  private readonly sourceUrlTtlSeconds: number;
  private drainMode: MediaProviderDrainMode = 'accepting';
  private forceUnknown = false;
  private lateTerminal = new Map<string, true>();
  private lastHealth: MediaProviderHealthReport = {
    state: 'healthy',
    reason: 'adapter_ready',
    source: 'adapter',
    observedAt: new Date(0).toISOString(),
  };

  constructor(options: FakeImageChannelOptions) {
    this.channelId = options.channelId;
    this.channelKind = options.channelKind;
    this.catalogModelId = options.catalogModelId ?? 'seedream-5-pro';
    this.costPerImage = options.costPerImage ?? 0.2;
    this.currency = options.currency ?? 'CNY';
    this.sourceUrlTtlSeconds = options.sourceUrlTtlSeconds ?? 3_600;
    this.receiptStore = options.receiptStore ?? new MemoryReceiptStore();
  }

  buildRequest(input: {
    effectIdempotencyKey?: string;
    workspaceId?: string;
  } = {}): MediaProviderEffectRequest {
    const base = recordedRequest(this.catalogModelId, 'image.generate', {
      width: 1024,
      height: 1024,
    });
    return {
      ...base,
      effectIdempotencyKey:
        input.effectIdempotencyKey ?? `${this.channelId}-effect`,
      submission: {
        ...base.submission,
        workspaceId: input.workspaceId ?? base.submission.workspaceId,
        prompt: `${this.channelId} image conformance`,
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
        taskRef: `fake-unknown-${scope.slice(0, 16)}`,
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

    const sourceExpiresAt = new Date(
      Date.now() + this.sourceUrlTtlSeconds * 1_000,
    ).toISOString();
    const receipt: MediaProviderSubmissionReceipt = {
      acceptance: 'accepted',
      taskRef: `fake-${this.channelKind}-${scope.slice(0, 24)}`,
      sourceExpiresAt,
      providerCost: {
        amount: this.costPerImage,
        currency: this.currency,
        usage: { mediaUnits: 1 },
      },
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
        error: 'Unknown fake image task.',
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
    // Late terminal after cancel still surfaces completed + cost.
    if (this.lateTerminal.has(request.taskRef)) {
      return {
        status: 'completed' as const,
        providerCost: {
          amount: this.costPerImage * 1.5,
          currency: this.currency,
          usage: { mediaUnits: 1 },
        },
        sourceExpiresAt: receipt.sourceExpiresAt,
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
      throw new Error('Fake image asset is not ready.');
    }
    return {
      bytes: Uint8Array.from(PNG_1X1),
      contentType: 'image/png' as const,
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
        error: 'Unknown fake image task.',
      };
    }
    // Sync-style image: cancel after receipt is already completed.
    return {
      status: 'pending' as const,
      errorCode: 'already_completed',
      retryable: false,
      error: 'Fake image completes synchronously and cannot be cancelled.',
    };
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

  // Live ports for counting; restart recreates with same store.
  let officialPort = new FakeImageChannelPort({
    channelId: 'channel-ark-seedream-official',
    channelKind: 'official_direct',
    catalogModelId: 'seedream-5-pro',
    costPerImage: 0.22,
    currency: 'CNY',
    receiptStore: officialStore,
  });
  let resellerPort = new FakeImageChannelPort({
    channelId: 'channel-tuzi-seedream-reseller',
    channelKind: 'upstream_reseller',
    catalogModelId: 'gpt-image-2',
    costPerImage: 0.18,
    currency: 'USD',
    receiptStore: resellerStore,
  });

  const official = {
    channelId: officialPort.channelId,
    channelKind: 'official_direct' as const,
    createPort: () => {
      officialPort = new FakeImageChannelPort({
        channelId: 'channel-ark-seedream-official',
        channelKind: 'official_direct',
        catalogModelId: 'seedream-5-pro',
        costPerImage: 0.22,
        currency: 'CNY',
        receiptStore: officialStore,
      });
      return officialPort;
    },
    restartPort: () =>
      new FakeImageChannelPort({
        channelId: 'channel-ark-seedream-official',
        channelKind: 'official_direct',
        catalogModelId: 'seedream-5-pro',
        costPerImage: 0.22,
        currency: 'CNY',
        receiptStore: officialStore,
      }),
    buildRequest: (input?: {
      effectIdempotencyKey?: string;
      workspaceId?: string;
    }) => officialPort.buildRequest(input),
    forceAcceptanceUnknown: (port: MediaProviderLifecyclePort) => {
      (port as FakeImageChannelPort).forceAcceptanceUnknown();
    },
    forceLateTerminalSuccess: (
      port: MediaProviderLifecyclePort,
      taskRef: string,
    ) => {
      (port as FakeImageChannelPort).forceLateTerminalSuccess(taskRef);
    },
    submitCount: () => officialPort.submitCount,
  };

  const reseller = {
    channelId: resellerPort.channelId,
    channelKind: 'upstream_reseller' as const,
    createPort: () => {
      resellerPort = new FakeImageChannelPort({
        channelId: 'channel-tuzi-seedream-reseller',
        channelKind: 'upstream_reseller',
        catalogModelId: 'gpt-image-2',
        costPerImage: 0.18,
        currency: 'USD',
        receiptStore: resellerStore,
      });
      return resellerPort;
    },
    restartPort: () =>
      new FakeImageChannelPort({
        channelId: 'channel-tuzi-seedream-reseller',
        channelKind: 'upstream_reseller',
        catalogModelId: 'gpt-image-2',
        costPerImage: 0.18,
        currency: 'USD',
        receiptStore: resellerStore,
      }),
    buildRequest: (input?: {
      effectIdempotencyKey?: string;
      workspaceId?: string;
    }) => resellerPort.buildRequest(input),
    forceAcceptanceUnknown: (port: MediaProviderLifecyclePort) => {
      (port as FakeImageChannelPort).forceAcceptanceUnknown();
    },
    forceLateTerminalSuccess: (
      port: MediaProviderLifecyclePort,
      taskRef: string,
    ) => {
      (port as FakeImageChannelPort).forceLateTerminalSuccess(taskRef);
    },
    submitCount: () => resellerPort.submitCount,
  };

  return { official, reseller, officialStore, resellerStore };
}
