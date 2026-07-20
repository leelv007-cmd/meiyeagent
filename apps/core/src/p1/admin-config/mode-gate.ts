import type {
  MediaProviderEffectRequest,
  MediaProviderLifecyclePort,
  ProviderExecutionPort,
  ProviderExecutionRequest,
} from '../model-supply/index.js';
import type { AdminConfigRepository } from './foundation-module.js';

const GLOBAL_WORKSPACE_ID = '__global__';

type RuntimeModeHeadReader = Pick<AdminConfigRepository, 'get'>;

/**
 * Shared kill-switch probe. Both the non-streaming provider ports and the
 * streaming choke points (copy stream, assistant stream) consult this so the
 * "disabled" runtime mode stops new provider work uniformly — streaming copy
 * is a locked invariant (ADR-0007/0010) and must not bypass the safety valve.
 */
export interface SubmissionModeGate {
  blocksNewSubmission(): Promise<boolean>;
}

interface ModeGateOptions {
  clock?: () => number;
  ttlMs?: number;
}

class DisabledHeadGate {
  private disabled = false;
  private expiresAt = Number.NEGATIVE_INFINITY;
  private readonly clock: () => number;
  private readonly ttlMs: number;

  constructor(
    private readonly reader: RuntimeModeHeadReader,
    private readonly key: 'model.execution.mode' | 'model.media.execution.mode',
    private readonly assembledMode: string,
    options: ModeGateOptions,
  ) {
    this.clock = options.clock ?? Date.now;
    this.ttlMs = options.ttlMs ?? 5_000;
  }

  async blocksNewSubmission() {
    if (this.assembledMode === 'disabled') return true;
    const now = this.clock();
    if (now < this.expiresAt) return this.disabled;
    try {
      const head = await this.reader.get('global', GLOBAL_WORKSPACE_ID, this.key);
      this.disabled = head?.value === 'disabled';
      this.expiresAt = now + this.ttlMs;
      return this.disabled;
    } catch {
      this.expiresAt = now + this.ttlMs;
      return this.disabled;
    }
  }
}

/**
 * Builds a standalone model-execution kill switch for the streaming choke
 * points (copy stream / assistant stream), which cannot route through the
 * ProviderExecutionPort decorator because their runner methods are synchronous.
 */
export function createModelExecutionModeGate(
  reader: RuntimeModeHeadReader,
  assembledMode: string,
  options: ModeGateOptions = {},
): SubmissionModeGate {
  return new DisabledHeadGate(reader, 'model.execution.mode', assembledMode, options);
}

export class ModeGateExecutionPort implements ProviderExecutionPort {
  private readonly gate: DisabledHeadGate;

  constructor(
    private readonly inner: ProviderExecutionPort,
    reader: RuntimeModeHeadReader,
    assembledMode: string,
    options: ModeGateOptions = {},
  ) {
    this.gate = new DisabledHeadGate(
      reader,
      'model.execution.mode',
      assembledMode,
      options,
    );
  }

  async execute(request: ProviderExecutionRequest) {
    if (!(await this.gate.blocksNewSubmission())) {
      return this.inner.execute(request);
    }
    return {
      acceptance: 'rejected_before_accept' as const,
      kind: 'failure' as const,
      message: '模型执行已停用。',
      providerCost: {
        amount: 0,
        currency: request.deployment.region === 'domestic' ? 'CNY' as const : 'USD' as const,
        usage: {},
      },
    };
  }
}

export class ModeGateMediaLifecyclePort implements MediaProviderLifecyclePort {
  private readonly gate: DisabledHeadGate;

  constructor(
    private readonly inner: MediaProviderLifecyclePort,
    reader: RuntimeModeHeadReader,
    assembledMode: string,
    options: ModeGateOptions = {},
  ) {
    this.gate = new DisabledHeadGate(
      reader,
      'model.media.execution.mode',
      assembledMode,
      options,
    );
  }

  async submit(request: MediaProviderEffectRequest) {
    if (!(await this.gate.blocksNewSubmission())) {
      return this.inner.submit(request);
    }
    return {
      acceptance: 'rejected_before_accept' as const,
      error: '媒体执行已停用。',
      errorCode: 'media_execution_disabled',
      providerCost: {
        amount: 0,
        currency: request.deployment.region === 'domestic' ? 'CNY' as const : 'USD' as const,
        usage: {},
      },
      retryable: false,
    };
  }

  recover(request: MediaProviderEffectRequest) {
    return this.inner.recover(request);
  }

  poll(request: MediaProviderEffectRequest & { taskRef: string }) {
    return this.inner.poll(request);
  }

  download(request: MediaProviderEffectRequest & { taskRef: string }) {
    return this.inner.download(request);
  }

  cancel(request: MediaProviderEffectRequest & { taskRef: string }) {
    return this.inner.cancel(request);
  }

  reportHealth() {
    if (this.inner.reportHealth) return this.inner.reportHealth();
    return {
      state: 'unavailable' as const,
      reason: 'health_not_instrumented',
      source: 'adapter' as const,
      observedAt: new Date().toISOString(),
    };
  }

  setDrainMode(
    mode: Parameters<NonNullable<MediaProviderLifecyclePort['setDrainMode']>>[0],
  ) {
    return this.inner.setDrainMode?.(mode);
  }

  getDrainMode() {
    return this.inner.getDrainMode?.() ?? ('accepting' as const);
  }
}
