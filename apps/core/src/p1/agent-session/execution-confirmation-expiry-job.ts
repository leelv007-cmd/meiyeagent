import type {
  JobRuntimeHandler,
  RecurringJobInput,
} from '../job-runtime/index.js';
import type { ExecutionConfirmationService } from './execution-confirmation-service.js';

export const CONFIRMATION_EXPIRY_JOB_KIND = 'confirmation.expire-due';
export const CONFIRMATION_EXPIRY_SCHEDULE_ID = 'confirmation.expire-due.v1';

export function createConfirmationExpiryJobHandler(
  confirmations: Pick<ExecutionConfirmationService, 'expireDueHolds'>,
): JobRuntimeHandler {
  return async (envelope, context) => {
    if (
      envelope.kind !== CONFIRMATION_EXPIRY_JOB_KIND ||
      envelope.workspaceId !== '__system__'
    ) {
      return {
        output: { code: 'UNSUPPORTED_JOB_KIND' },
        status: 'dead_letter',
      };
    }
    try {
      const result = await confirmations.expireDueHolds({
        now: context.claimedAt,
      });
      return { output: result, status: 'completed' };
    } catch (error) {
      return {
        output: {
          code: 'CONFIRMATION_EXPIRY_FAILED',
          message:
            error instanceof Error ? error.message : 'Unknown expiry error.',
        },
        status: 'retry',
      };
    }
  };
}

export function registerConfirmationExpirySchedule(
  runtime: { scheduleRecurring(input: RecurringJobInput): Promise<void> },
  options: { cron?: string; timezone?: string } = {},
) {
  return runtime.scheduleRecurring({
    cron: options.cron ?? '* * * * *',
    kind: CONFIRMATION_EXPIRY_JOB_KIND,
    payload: {},
    scheduleId: CONFIRMATION_EXPIRY_SCHEDULE_ID,
    timezone: options.timezone ?? 'Asia/Shanghai',
    workspaceId: '__system__',
  });
}
