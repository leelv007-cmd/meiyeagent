import type {
  JobRuntimeHandler,
  RecurringJobInput,
} from '../job-runtime/index.js';
import type { DueDeliveryWorker, DueDeliveryWorkerSummary } from './worker.js';

export const DUE_DELIVERY_SCANNER_JOB_KIND = 'due-delivery.scan';
export const DUE_DELIVERY_SCANNER_SCHEDULE_ID = 'due-delivery.scan.v1';

interface DueDeliveryPurge {
  purgeExpired(
    now: Date,
    limit: number,
  ): Promise<{ deletedItems: number; deletedRuns: number }>;
}

export interface DueDeliveryScannerSummary extends DueDeliveryWorkerSummary {
  deletedItems: number;
  deletedRuns: number;
}

export class DueDeliveryScannerRunner {
  private readonly purgeLimit: number;

  constructor(
    private readonly worker: Pick<DueDeliveryWorker, 'runOnce'>,
    private readonly purge: DueDeliveryPurge,
    options: { purgeLimit?: number } = {},
  ) {
    this.purgeLimit = options.purgeLimit ?? 100;
  }

  async run(workerId: string, claimedAt: string): Promise<DueDeliveryScannerSummary> {
    const now = new Date(claimedAt);
    if (Number.isNaN(now.getTime())) {
      throw new Error('Due delivery scanner claimedAt is invalid.');
    }
    const delivery = await this.worker.runOnce(workerId);
    const purged = await this.purge.purgeExpired(now, this.purgeLimit);
    return { ...delivery, ...purged };
  }
}

export function createDueDeliveryScannerJobHandler(
  runner: Pick<DueDeliveryScannerRunner, 'run'>,
  workerId: string,
): JobRuntimeHandler {
  return async (envelope, context) => {
    if (
      envelope.kind !== DUE_DELIVERY_SCANNER_JOB_KIND ||
      envelope.workspaceId !== '__system__'
    ) {
      return {
        output: { code: 'UNSUPPORTED_JOB_KIND' },
        status: 'dead_letter',
      };
    }
    try {
      const summary = await runner.run(workerId, context.claimedAt);
      return {
        output: { ...summary },
        status: 'completed',
      };
    } catch (error) {
      return {
        output: {
          code: 'DUE_DELIVERY_SCAN_FAILED',
          message:
            error instanceof Error ? error.message : 'Unknown scanner error.',
        },
        status: 'retry',
      };
    }
  };
}

export function registerDueDeliveryScannerSchedule(
  runtime: { scheduleRecurring(input: RecurringJobInput): Promise<void> },
  options: { cron?: string; timezone?: string } = {},
) {
  return runtime.scheduleRecurring({
    cron: options.cron ?? '* * * * *',
    kind: DUE_DELIVERY_SCANNER_JOB_KIND,
    payload: {},
    scheduleId: DUE_DELIVERY_SCANNER_SCHEDULE_ID,
    timezone: options.timezone ?? 'Asia/Shanghai',
    workspaceId: '__system__',
  });
}
