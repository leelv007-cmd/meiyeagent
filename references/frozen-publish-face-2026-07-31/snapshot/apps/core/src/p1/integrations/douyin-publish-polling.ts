import type { JobRuntimeHandler, RecurringJobInput } from '../job-runtime/index.js';
import type { IntegrationContext } from './contracts.js';

export const DOUYIN_PUBLISH_POLLING_JOB_KIND =
  'integrations.douyin-publish-polling';
export const DOUYIN_PUBLISH_POLLING_SCHEDULE_ID =
  'integrations.douyin-publish-polling.v1';

export interface DouyinPublishPollingTargetPort {
  listDouyinPublishPollingTargets(
    at: string
  ): Promise<Array<{ workspaceId: string; jobId: string }>>;
}

export interface DouyinPublishPollingServicePort {
  pollDouyinPublishStatus(
    context: IntegrationContext,
    jobId: string,
    at: string
  ): Promise<unknown>;
}

export class DouyinPublishPollingBatchRunner {
  constructor(
    private readonly targets: DouyinPublishPollingTargetPort,
    private readonly service: DouyinPublishPollingServicePort
  ) {}

  async run(at = new Date().toISOString()) {
    const targets = await this.targets.listDouyinPublishPollingTargets(at);
    const summary = {
      failedCount: 0,
      processedCount: 0,
      targetCount: targets.length,
    };
    for (const target of targets) {
      try {
        await this.service.pollDouyinPublishStatus(
          {
            correlationId: `douyin-publish-poll:${target.jobId}`,
            role: 'worker',
            userId: 'douyin-publish-polling-worker',
            workspaceId: target.workspaceId,
          },
          target.jobId,
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

export function createDouyinPublishPollingJobHandler(
  runner: Pick<DouyinPublishPollingBatchRunner, 'run'>
): JobRuntimeHandler {
  return async (envelope) => {
    if (envelope.kind !== DOUYIN_PUBLISH_POLLING_JOB_KIND) {
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
          code: 'DOUYIN_PUBLISH_POLLING_FAILED',
          message:
            error instanceof Error ? error.message : 'Unknown polling error.',
        },
        status: 'retry',
      };
    }
  };
}

export function registerDouyinPublishPollingSchedule(
  runtime: { scheduleRecurring(input: RecurringJobInput): Promise<void> },
  options: { cron?: string; timezone?: string } = {}
) {
  return runtime.scheduleRecurring({
    cron: options.cron ?? '* * * * *',
    kind: DOUYIN_PUBLISH_POLLING_JOB_KIND,
    payload: {},
    scheduleId: DOUYIN_PUBLISH_POLLING_SCHEDULE_ID,
    timezone: options.timezone ?? 'Asia/Shanghai',
    workspaceId: '__system__',
  });
}
