import {
  DEFAULT_HARNESS_LANGFUSE_OUTBOX_CONFIG,
  HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY,
  harnessLangfuseOutboxConfigSchema,
  type AdminConfigRepository,
  type HarnessLangfuseOutboxConfig,
} from '../admin-config/foundation-module.js';

export interface HarnessLangfuseOutboxItem {
  auditId: string;
  workflowId: string;
  stage: string;
  eventType: string;
  occurredAt: string;
  payload: unknown;
  decisionTrace?: unknown;
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
  markLangfuseDeadLetter(auditId: string, error: string): Promise<void>;
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
      try {
        await this.sender.send(item);
        await this.store.markLangfuseSent(item.auditId);
        sent += 1;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        failed += 1;
        if (item.attempts >= (this.options.maxAttempts ?? config.maxAttempts)) {
          await this.store.markLangfuseDeadLetter(item.auditId, errorMessage);
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
