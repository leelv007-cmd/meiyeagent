import type {
  JobRuntimeHandler,
  RecurringJobInput,
} from '../job-runtime/index.js';
import { IntegrationError, type IntegrationContext } from './contracts.js';
import type { IntegrationRepository } from './repository.js';

export const DOUYIN_OAUTH_LIFECYCLE_JOB_KIND =
  'integrations.douyin-oauth-lifecycle';
export const DOUYIN_OAUTH_LIFECYCLE_SCHEDULE_ID =
  'integrations.douyin-oauth-lifecycle.v1';

export interface DouyinOAuthLifecycleResult {
  connectionId: string;
  credentialVersion: number;
  expiresAt?: string;
  status: 'not_due' | 'refreshed' | 'reauthorization_required';
}

export interface DouyinOAuthLifecycleApplicationPort {
  runDouyinOAuthLifecycle(
    context: IntegrationContext,
    connectionId: string,
    at?: string
  ): Promise<DouyinOAuthLifecycleResult>;
}

export interface DouyinOAuthLifecycleSummary {
  failedConnectionCount: number;
  notDueCount: number;
  reauthorizationRequiredCount: number;
  refreshedCount: number;
  targetCount: number;
}

export class DouyinOAuthLifecycleBatchRunner {
  constructor(
    private readonly repository: IntegrationRepository,
    private readonly application: DouyinOAuthLifecycleApplicationPort
  ) {}

  async run(
    context: IntegrationContext,
    at = new Date().toISOString()
  ): Promise<DouyinOAuthLifecycleSummary> {
    const targets =
      await this.repository.listDouyinOAuthLifecycleTargets();
    const summary: DouyinOAuthLifecycleSummary = {
      failedConnectionCount: 0,
      notDueCount: 0,
      reauthorizationRequiredCount: 0,
      refreshedCount: 0,
      targetCount: targets.length,
    };
    for (const target of targets) {
      const targetContext: IntegrationContext = {
        ...context,
        correlationId: `${context.correlationId}:${target.connectionId}`,
        workspaceId: target.workspaceId,
      };
      try {
        const result = await this.application.runDouyinOAuthLifecycle(
          targetContext,
          target.connectionId,
          at
        );
        if (result.status === 'refreshed') summary.refreshedCount += 1;
        else if (result.status === 'reauthorization_required') {
          summary.reauthorizationRequiredCount += 1;
        } else summary.notDueCount += 1;
      } catch (error) {
        summary.failedConnectionCount += 1;
        await this.repository
          .appendAudit({
            action: 'douyin.oauth_lifecycle_failed',
            actorId: context.userId,
            connectionId: target.connectionId,
            correlationId: targetContext.correlationId,
            createdAt: at,
            details: {
              code:
                error instanceof IntegrationError
                  ? error.code
                  : 'DOUYIN_OAUTH_LIFECYCLE_FAILED',
              credentialVersion: target.credentialVersion,
            },
            id: `${targetContext.correlationId}:failed`,
            workspaceId: target.workspaceId,
          })
          .catch(() => undefined);
      }
    }
    return summary;
  }
}

export function createDouyinOAuthLifecycleJobHandler(
  lifecycle: DouyinOAuthLifecycleBatchRunner
): JobRuntimeHandler {
  return async (envelope, worker) => {
    if (envelope.kind !== DOUYIN_OAUTH_LIFECYCLE_JOB_KIND) {
      return {
        output: { code: 'UNSUPPORTED_JOB_KIND' },
        status: 'dead_letter',
      };
    }
    try {
      const result = await lifecycle.run(
        {
          correlationId: `${envelope.jobId}:${worker.transportId}`,
          role: 'worker',
          userId: 'douyin-oauth-lifecycle-worker',
          workspaceId: '__system__',
        },
        worker.claimedAt
      );
      return {
        output: { ...result },
        status: result.failedConnectionCount > 0 ? 'retry' : 'completed',
      };
    } catch (error) {
      return {
        output: {
          code: 'DOUYIN_OAUTH_LIFECYCLE_SCAN_FAILED',
          message:
            error instanceof Error ? error.message : 'Unknown lifecycle error.',
        },
        status: 'retry',
      };
    }
  };
}

export interface DouyinOAuthLifecycleSchedulePort {
  scheduleRecurring(input: RecurringJobInput): Promise<void>;
}

export function registerDouyinOAuthLifecycleSchedule(
  runtime: DouyinOAuthLifecycleSchedulePort,
  options: { cron?: string; timezone?: string } = {}
) {
  return runtime.scheduleRecurring({
    cron: options.cron ?? '*/2 * * * *',
    kind: DOUYIN_OAUTH_LIFECYCLE_JOB_KIND,
    payload: {},
    scheduleId: DOUYIN_OAUTH_LIFECYCLE_SCHEDULE_ID,
    timezone: options.timezone ?? 'Asia/Shanghai',
    workspaceId: '__system__',
  });
}
