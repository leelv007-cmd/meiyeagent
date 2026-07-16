import type { JobRuntimeHandler, RecurringJobInput } from '../job-runtime/index.js';
import type { IntegrationContext } from './contracts.js';

export const DOUYIN_OBSERVE_SYNC_JOB_KIND = 'integrations.douyin-observe-sync';
export const DOUYIN_OBSERVE_SYNC_SCHEDULE_ID =
  'integrations.douyin-observe-sync.v1';

export interface DouyinObserveSyncTargetPort {
  listDouyinObserveSyncTargets(
    at: string
  ): Promise<Array<{ workspaceId: string; connectionId: string }>>;
}

export interface DouyinObserveSyncServicePort {
  syncDouyinObserve(
    context: IntegrationContext,
    connectionId: string,
    at: string
  ): Promise<unknown>;
}

export class DouyinObserveSyncBatchRunner {
  constructor(
    private readonly targets: DouyinObserveSyncTargetPort,
    private readonly service: DouyinObserveSyncServicePort
  ) {}

  async run(at = new Date().toISOString()) {
    const targets = await this.targets.listDouyinObserveSyncTargets(at);
    const summary = {
      failedCount: 0,
      processedCount: 0,
      targetCount: targets.length,
    };
    for (const target of targets) {
      try {
        await this.service.syncDouyinObserve(
          {
            correlationId: `douyin-observe-sync:${target.connectionId}`,
            role: 'worker',
            userId: 'douyin-observe-sync-worker',
            workspaceId: target.workspaceId,
          },
          target.connectionId,
          at
        );
        summary.processedCount += 1;
      } catch {
        summary.failedCount += 1;
      }
    }
    return summary;
  }
}

export function createDouyinObserveSyncJobHandler(
  runner: Pick<DouyinObserveSyncBatchRunner, 'run'>
): JobRuntimeHandler {
  return async (envelope) => {
    if (envelope.kind !== DOUYIN_OBSERVE_SYNC_JOB_KIND) {
      return {
        output: { code: 'UNSUPPORTED_JOB_KIND' },
        status: 'dead_letter',
      };
    }
    try {
      const result = await runner.run(
        typeof envelope.payload.at === 'string'
          ? envelope.payload.at
          : new Date().toISOString()
      );
      return { output: result, status: 'completed' };
    } catch (error) {
      return {
        output: {
          code: 'DOUYIN_OBSERVE_SYNC_FAILED',
          message:
            error instanceof Error ? error.message : 'Unknown Observe error.',
        },
        status: 'retry',
      };
    }
  };
}

export function registerDouyinObserveSyncSchedule(
  runtime: { scheduleRecurring(input: RecurringJobInput): Promise<void> },
  options: { cron?: string; timezone?: string } = {}
) {
  return runtime.scheduleRecurring({
    cron: options.cron ?? '*/5 * * * *',
    kind: DOUYIN_OBSERVE_SYNC_JOB_KIND,
    payload: {},
    scheduleId: DOUYIN_OBSERVE_SYNC_SCHEDULE_ID,
    timezone: options.timezone ?? 'Asia/Shanghai',
    workspaceId: '__system__',
  });
}
