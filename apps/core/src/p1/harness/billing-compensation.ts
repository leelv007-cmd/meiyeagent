import type { PartialDeliveryBasis } from '../product-billing/partial-delivery-settlement.js';
import type { TrustedUsageEvidence } from '../product-billing/quote-service.js';

export interface HarnessBillingSettlementInput {
  workspaceId: string;
  /** Workflow/DBOS identity retained by observability and resume paths. */
  taskId: string;
  /** ProductQuote/ProductUsage identity when it differs from the workflow. */
  billingTaskId?: string;
  quoteId: string;
  quoteRevision: string;
  /** Exact credit reservation accepted by the confirmed authority. */
  creditUsageOperationId?: string;
  trustedUsage?: TrustedUsageEvidence;
  /**
   * Delivered vs frozen billable units when the executor lands only part of a
   * multi-unit run (V31-16). Credit-era partial refunds need this; without it
   * settlement stays a full charge.
   */
  partialDelivery?: PartialDeliveryBasis;
  /** Platform failures and expired holds always refund merchant credits. */
  forceCreditRefund?: boolean;
}

export interface HarnessBillingCompensationTask
  extends HarnessBillingSettlementInput {
  action: 'commit' | 'refund';
  attempts: number;
}

export class HarnessBillingCompensationConflictError extends Error {
  readonly code = 'HARNESS_BILLING_COMPENSATION_CONFLICT';

  constructor(readonly taskId: string) {
    super(`Billing settlement for task ${taskId} already has the opposite action.`);
    this.name = 'HarnessBillingCompensationConflictError';
  }
}

export function isHarnessBillingCompensationConflictError(
  error: unknown,
): error is HarnessBillingCompensationConflictError {
  if (error instanceof HarnessBillingCompensationConflictError) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    name?: unknown;
    taskId?: unknown;
  };
  return (
    candidate.code === 'HARNESS_BILLING_COMPENSATION_CONFLICT' ||
    (candidate.name === 'HarnessBillingCompensationConflictError' &&
      typeof candidate.taskId === 'string')
  );
}

export interface HarnessBillingCompensationStore {
  enqueue(input: HarnessBillingCompensationTask): Promise<void>;
  recoverOrphans?(limit: number): Promise<number>;
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
    const batchSize = this.options.batchSize ?? 20;
    await this.store.recoverOrphans?.(batchSize);
    const tasks = await this.store.claimBatch(batchSize);
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
