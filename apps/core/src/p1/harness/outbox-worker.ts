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
    for (const item of items) {
      try {
        await this.sender.send(item);
        await this.store.markLangfuseSent(item.auditId);
        sent += 1;
      } catch (error) {
        const now = this.options.now?.() ?? new Date();
        const retryAt = new Date(
          now.getTime() + (this.options.retryDelayMs ?? 30_000),
        );
        await this.store.markLangfuseFailed(
          item.auditId,
          error instanceof Error ? error.message : String(error),
          retryAt,
        );
        failed += 1;
      }
    }
    return { sent, failed };
  }
}
