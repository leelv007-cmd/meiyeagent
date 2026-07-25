import type { TrustedUsageEvidenceKind } from '@meiye/contracts';

export interface HarnessBillingSettlementInput {
  workspaceId: string;
  taskId: string;
  quoteId: string;
  quoteRevision: string;
  trustedUsage?: {
    kind: TrustedUsageEvidenceKind;
    actualSeconds: number;
    evidenceRef?: string;
  };
}

export interface HarnessBillingCompensationTask
  extends HarnessBillingSettlementInput {
  action: 'commit' | 'refund';
  attempts: number;
}

export interface HarnessBillingCompensationStore {
  enqueue(input: HarnessBillingCompensationTask): Promise<void>;
  claimBatch(limit: number): Promise<HarnessBillingCompensationTask[]>;
  markCompleted(input: HarnessBillingCompensationTask): Promise<void>;
  markFailed(
    input: HarnessBillingCompensationTask,
    error: string,
    retryAt: Date,
  ): Promise<void>;
}

export interface HarnessBillingSettlementExecutor {
  commit(input: HarnessBillingSettlementInput): Promise<void>;
  refund(input: HarnessBillingSettlementInput): Promise<void>;
}

export class HarnessBillingCompensationWorker {
  constructor(
    private readonly store: HarnessBillingCompensationStore,
    private readonly billing: HarnessBillingSettlementExecutor,
    private readonly options: {
      batchSize?: number;
      now?: () => Date;
      retryDelayMs?: number;
    } = {},
  ) {}

  async runOnce() {
    const tasks = await this.store.claimBatch(this.options.batchSize ?? 20);
    let completed = 0;
    let failed = 0;
    for (const task of tasks) {
      try {
        await this.billing[task.action](task);
        await this.store.markCompleted(task);
        completed += 1;
      } catch (error) {
        const now = this.options.now?.() ?? new Date();
        const retryAt = new Date(
          now.getTime() + (this.options.retryDelayMs ?? 30_000),
        );
        await this.store.markFailed(
          task,
          error instanceof Error ? error.message : String(error),
          retryAt,
        );
        failed += 1;
      }
    }
    return { completed, failed };
  }
}
