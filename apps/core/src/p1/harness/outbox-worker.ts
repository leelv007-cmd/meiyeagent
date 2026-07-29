import {
  observabilityDropEventSchema,
  type ObservabilityDropEvent,
} from '@meiye/contracts';

import {
  DEFAULT_HARNESS_LANGFUSE_OUTBOX_CONFIG,
  HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY,
  harnessLangfuseOutboxConfigSchema,
  type AdminConfigRepository,
  type HarnessLangfuseOutboxConfig,
} from '../admin-config/foundation-module.js';

export class ObservabilityDeliveryFailure extends Error {
  readonly drops: ObservabilityDropEvent[];

  constructor(message: string, drops: ObservabilityDropEvent[]) {
    super(message);
    this.name = 'ObservabilityDeliveryFailure';
    this.drops = drops.map((drop) => observabilityDropEventSchema.parse(drop));
    if (
      this.drops.length === 0 ||
      new Set(this.drops.map(({ reason }) => reason)).size !== 1
    ) {
      throw new Error(
        'Observability delivery failure requires one non-empty drop reason.',
      );
    }
  }

  get reason() {
    return this.drops[0]!.reason;
  }
}

export interface HarnessLangfuseOutboxItem {
  auditId: string;
  workflowId: string;
  stage: string;
  eventType: string;
  occurredAt: string;
  payload: unknown;
  decisionTrace?: unknown;
  traceContractVersion?: 'observability/v1';
  attempts: number;
}

export interface HarnessLangfuseOutboxStore {
  claimLangfuseBatch(
    limit: number,
    leaseSeconds?: number,
    maxAttempts?: number,
  ): Promise<HarnessLangfuseOutboxItem[]>;
  markLangfuseSent(auditId: string): Promise<void>;
  markLangfuseFailed(
    auditId: string,
    error: string,
    retryAt: Date,
  ): Promise<void>;
  markLangfuseDeadLetter(
    auditId: string,
    error: string,
    drops: ObservabilityDropEvent[],
  ): Promise<void>;
  replayLangfuseDeadLetter?(auditId: string): Promise<boolean>;
  discardLangfuseDeadLetter?(auditId: string): Promise<boolean>;
}

export async function readHarnessLangfuseOutboxConfig(
  config?: Pick<AdminConfigRepository, 'get'>,
): Promise<HarnessLangfuseOutboxConfig> {
  const configured = (
    await config?.get('global', '__global__', HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY)
  )?.value;
  return harnessLangfuseOutboxConfigSchema.parse(
    configured ?? DEFAULT_HARNESS_LANGFUSE_OUTBOX_CONFIG,
  );
}

export interface HarnessLangfuseSender {
  send(item: HarnessLangfuseOutboxItem): Promise<void>;
  describeSignals?(
    item: HarnessLangfuseOutboxItem,
  ): Array<Pick<ObservabilityDropEvent, 'signal' | 'count'>>;
}

export class HarnessLangfuseOutboxWorker {
  constructor(
    private readonly store: HarnessLangfuseOutboxStore,
    private readonly sender: HarnessLangfuseSender,
    private readonly options: {
      batchSize?: number;
      maxAttempts?: number;
      now?: () => Date;
      retryDelayMs?: number;
      leaseSeconds?: number;
      config?: Pick<AdminConfigRepository, 'get'>;
    } = {},
  ) {}

  async runOnce() {
    const config = await readHarnessLangfuseOutboxConfig(this.options.config);
    const items = await this.store.claimLangfuseBatch(
      this.options.batchSize ?? config.batchSize,
      this.options.leaseSeconds ?? config.leaseSeconds,
      this.options.maxAttempts ?? config.maxAttempts,
    );
    let sent = 0;
    let failed = 0;
    let deadLettered = 0;
    for (const item of items) {
      if (
        item.attempts >
        (this.options.maxAttempts ?? config.maxAttempts)
      ) {
        failed += 1;
        const signals = this.sender.describeSignals?.(item) ?? [
          { signal: 'trace' as const, count: 1 },
        ];
        await this.store.markLangfuseDeadLetter(
          item.auditId,
          'Langfuse outbox attempt limit reached after an interrupted lease.',
          signals.map(({ signal, count }) => ({
            signal,
            reason: 'transient' as const,
            count,
            source: 'langfuse_outbox',
          })),
        );
        deadLettered += 1;
        continue;
      }
      try {
        await this.sender.send(item);
        await this.store.markLangfuseSent(item.auditId);
        sent += 1;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const deliveryFailure =
          error instanceof ObservabilityDeliveryFailure ? error : undefined;
        failed += 1;
        if (
          deliveryFailure?.reason === 'permanent-config' ||
          item.attempts >= (this.options.maxAttempts ?? config.maxAttempts)
        ) {
          await this.store.markLangfuseDeadLetter(
            item.auditId,
            errorMessage,
            deliveryFailure?.drops ?? [
              {
                signal: 'trace',
                reason: 'transient',
                count: 1,
                source: 'langfuse_outbox',
              },
            ],
          );
          deadLettered += 1;
          continue;
        }
        const now = this.options.now?.() ?? new Date();
        const retryAt = new Date(
          now.getTime() +
            (this.options.retryDelayMs ?? config.retryDelaySeconds * 1_000),
        );
        await this.store.markLangfuseFailed(
          item.auditId,
          errorMessage,
          retryAt,
        );
      }
    }
    return { sent, failed, deadLettered };
  }
}

export class HarnessLangfuseOutboxLoop {
  private interval: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly worker: Pick<HarnessLangfuseOutboxWorker, 'runOnce'>,
    private readonly options: {
      onError?: (error: unknown) => void;
      pollMs?: number;
    } = {},
  ) {}

  start() {
    if (this.interval) return;
    this.interval = setInterval(
      () => void this.runOnce(),
      this.options.pollMs ?? 1_000,
    );
    this.interval.unref();
    void this.runOnce();
  }

  stop() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }

  async runOnce() {
    if (this.running) return false;
    this.running = true;
    try {
      await this.worker.runOnce();
      return true;
    } catch (error) {
      this.options.onError?.(error);
      return false;
    } finally {
      this.running = false;
    }
  }
}
