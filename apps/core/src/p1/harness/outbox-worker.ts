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
  claimLangfuseBatch(limit: number): Promise<HarnessLangfuseOutboxItem[]>;
  markLangfuseSent(auditId: string): Promise<void>;
  markLangfuseFailed(
    auditId: string,
    error: string,
    retryAt: Date,
  ): Promise<void>;
  markLangfuseDeadLetter(auditId: string, error: string): Promise<void>;
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
    } = {},
  ) {}

  async runOnce() {
    const items = await this.store.claimLangfuseBatch(
      this.options.batchSize ?? 20,
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
        if (item.attempts >= (this.options.maxAttempts ?? 8)) {
          await this.store.markLangfuseDeadLetter(item.auditId, errorMessage);
          deadLettered += 1;
          continue;
        }
        const now = this.options.now?.() ?? new Date();
        const retryAt = new Date(
          now.getTime() + (this.options.retryDelayMs ?? 30_000),
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
