import type {
  HarnessCarrierSettlementRecoveryStore,
  ReadyWorkSettlement,
} from './carrier-settlement-coordinator.js';

/**
 * Executes a frozen Work aggregate after the coordinator has atomically
 * collected every carrier receipt. Implementations must settle the supplied
 * aggregate directly; they must not record another per-carrier receipt.
 */
export interface ReadyWorkSettlementExecutor {
  settleReadyWork(input: ReadyWorkSettlement): Promise<void>;
}

/**
 * Recovery consumer for the coordinator-owned ready outbox. It intentionally
 * knows nothing about ProductUsage so a later runtime adapter can reuse the
 * existing aggregate billing invariants rather than duplicate them here.
 */
export class HarnessCarrierSettlementWorker {
  constructor(
    private readonly store: HarnessCarrierSettlementRecoveryStore,
    private readonly executor: ReadyWorkSettlementExecutor,
    private readonly options: {
      batchSize?: number;
      leaseMs?: number;
      now?: () => Date;
      retryDelayMs?: number;
    } = {},
  ) {}

  async runOnce() {
    const batchSize = this.options.batchSize ?? 20;
    const claimed = await this.store.claimReadyWorkSettlements({
      limit: batchSize,
      ...(this.options.leaseMs === undefined
        ? {}
        : { leaseMs: this.options.leaseMs }),
    });
    let completed = 0;
    let failed = 0;
    for (const ready of claimed) {
      try {
        await this.executor.settleReadyWork(ready);
        await this.store.markWorkSettled({
          workspaceId: ready.settlement.workspaceId,
          aggregateKey: ready.aggregateKey,
          claimToken: ready.claimToken,
        });
        completed += 1;
      } catch (error) {
        const now = this.options.now?.() ?? new Date();
        await this.store.markWorkSettlementFailed({
          workspaceId: ready.settlement.workspaceId,
          aggregateKey: ready.aggregateKey,
          claimToken: ready.claimToken,
          error: error instanceof Error ? error.message : String(error),
          retryAt: new Date(
            now.getTime() + (this.options.retryDelayMs ?? 30_000),
          ),
        });
        failed += 1;
      }
    }
    return { claimed: claimed.length, completed, failed };
  }
}
