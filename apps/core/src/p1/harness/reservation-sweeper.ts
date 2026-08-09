import type { ProductUsageUnit } from '@meiye/contracts';

import type {
  HarnessBillingSettlementExecutor,
  HarnessBillingSettlementInput,
} from './billing-compensation.js';

export const DEFAULT_HOLD_RESERVATION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_RESERVATION_SWEEP_ATTEMPTS = 5;

export interface HarnessReservationSweep
  extends HarnessBillingSettlementInput {
  questionId: string;
  usageReservationId: string;
  reservedUnits: ProductUsageUnit[];
  heldSince: string;
  reason: 'hold_reservation_ttl_elapsed';
  attempts: number;
}

export interface HarnessReservationSweepStore {
  claimBatch(input: {
    expiresBefore: string;
    limit: number;
    taskId?: string;
    workspaceId?: string;
  }): Promise<HarnessReservationSweep[]>;
  markCompleted(input: HarnessReservationSweep): Promise<void>;
  markFailed(
    input: HarnessReservationSweep,
    error: string,
    phase: 'completion' | 'refund',
  ): Promise<void>;
}

export class HarnessReservationSweeper {
  constructor(
    private readonly store: HarnessReservationSweepStore,
    private readonly billing: HarnessBillingSettlementExecutor,
    private readonly options: {
      batchSize?: number;
      expireHold?: (input: HarnessReservationSweep) => Promise<void>;
      now?: () => Date;
      reservationTtlSeconds?: number | (() => number | Promise<number>);
    } = {},
  ) {}

  async runOnce(scope?: { taskId: string; workspaceId: string }) {
    const now = this.options.now?.() ?? new Date();
    const configuredTtl = this.options.reservationTtlSeconds;
    const ttlSeconds =
      typeof configuredTtl === 'function'
        ? await configuredTtl()
        : configuredTtl ?? DEFAULT_HOLD_RESERVATION_TTL_SECONDS;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
      throw new Error('Hold reservation TTL must be a positive integer.');
    }
    const expiresBefore = new Date(
      now.getTime() - ttlSeconds * 1_000,
    ).toISOString();
    const sweeps = await this.store.claimBatch({
      expiresBefore,
      limit: this.options.batchSize ?? 20,
      ...(scope ?? {}),
    });
    let completed = 0;
    let failed = 0;
    for (const sweep of sweeps) {
      try {
        await this.billing.refund({ ...sweep, forceCreditRefund: true });
      } catch (error) {
        await this.store.markFailed(
          sweep,
          error instanceof Error ? error.message : String(error),
          'refund',
        );
        failed += 1;
        continue;
      }
      try {
        await this.options.expireHold?.(sweep);
        await this.store.markCompleted(sweep);
        completed += 1;
      } catch (error) {
        await this.store.markFailed(
          sweep,
          error instanceof Error ? error.message : String(error),
          'completion',
        );
        failed += 1;
      }
    }
    return { claimed: sweeps.length, completed, failed };
  }
}
