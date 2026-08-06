/**
 * Scheduled materialization of past-due redemption codes.
 *
 * List reads used to call expireDue lazily, which bumped CAS revision and made
 * concurrent admin void operations fail with revision conflict (#391).
 */

import type { JobRuntimeHandler, RecurringJobInput } from '../job-runtime/index.js';
import type { RedemptionStore } from './redemption.js';

export const REDEMPTION_EXPIRY_JOB_KIND = 'redemption.expire-due';
export const REDEMPTION_EXPIRY_SCHEDULE_ID = 'redemption.expire-due.v1';

export interface RedemptionExpirySummary {
  expiredCount: number;
}

export class RedemptionExpiryRunner {
  constructor(private readonly store: Pick<RedemptionStore, 'expireDue'>) {}

  async run(asOf = new Date().toISOString()): Promise<RedemptionExpirySummary> {
    return this.store.expireDue(asOf);
  }
}

export function createRedemptionExpiryJobHandler(
  runner: Pick<RedemptionExpiryRunner, 'run'>,
): JobRuntimeHandler {
  return async (envelope, context) => {
    if (
      envelope.kind !== REDEMPTION_EXPIRY_JOB_KIND ||
      envelope.workspaceId !== '__system__'
    ) {
      return {
        output: { code: 'UNSUPPORTED_JOB_KIND' },
        status: 'dead_letter',
      };
    }
    try {
      const summary = await runner.run(context.claimedAt);
      return {
        output: { expiredCount: summary.expiredCount },
        status: 'completed',
      };
    } catch (error) {
      return {
        output: {
          code: 'REDEMPTION_EXPIRY_FAILED',
          message:
            error instanceof Error ? error.message : 'Unknown redemption expiry error.',
        },
        status: 'retry',
      };
    }
  };
}

export function registerRedemptionExpirySchedule(
  runtime: { scheduleRecurring(input: RecurringJobInput): Promise<void> },
  options: { cron?: string; timezone?: string } = {},
) {
  return runtime.scheduleRecurring({
    cron: options.cron ?? '*/1 * * * *',
    kind: REDEMPTION_EXPIRY_JOB_KIND,
    payload: {},
    scheduleId: REDEMPTION_EXPIRY_SCHEDULE_ID,
    timezone: options.timezone ?? 'UTC',
    workspaceId: '__system__',
  });
}
