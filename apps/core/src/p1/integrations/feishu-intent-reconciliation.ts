import type { JobRuntimeHandler, RecurringJobInput } from '../job-runtime/index.js';
import type { IntegrationContext } from './contracts.js';

export const FEISHU_INTENT_RECONCILIATION_JOB_KIND =
  'integrations.feishu-intent-reconciliation';
export const FEISHU_INTENT_RECONCILIATION_SCHEDULE_ID =
  'integrations.feishu-intent-reconciliation.v1';

export interface FeishuIntentReconciliationTargetPort {
  listFeishuReconciliationTargets(
    at: string
  ): Promise<Array<{ workspaceId: string; intentId: string }>>;
}

export interface FeishuIntentReconciliationServicePort {
  reconcileFeishuIntent(
    context: IntegrationContext,
    intentId: string,
    at: string
  ): Promise<unknown>;
}

export class FeishuIntentReconciliationBatchRunner {
  constructor(
    private readonly targets: FeishuIntentReconciliationTargetPort,
    private readonly service: FeishuIntentReconciliationServicePort
  ) {}

  async run(at = new Date().toISOString()) {
    const targets = await this.targets.listFeishuReconciliationTargets(at);
    const summary = {
      failedCount: 0,
      processedCount: 0,
      targetCount: targets.length,
    };
    for (const target of targets) {
      try {
        await this.service.reconcileFeishuIntent(
          {
            correlationId: `feishu-intent-reconcile:${target.intentId}`,
            role: 'worker',
            userId: 'feishu-intent-reconciliation-worker',
            workspaceId: target.workspaceId,
          },
          target.intentId,
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

export function createFeishuIntentReconciliationJobHandler(
  runner: Pick<FeishuIntentReconciliationBatchRunner, 'run'>
): JobRuntimeHandler {
  return async (envelope) => {
    if (envelope.kind !== FEISHU_INTENT_RECONCILIATION_JOB_KIND) {
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
          code: 'FEISHU_INTENT_RECONCILIATION_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Unknown reconciliation error.',
        },
        status: 'retry',
      };
    }
  };
}

export function registerFeishuIntentReconciliationSchedule(
  runtime: { scheduleRecurring(input: RecurringJobInput): Promise<void> },
  options: { cron?: string; timezone?: string } = {}
) {
  return runtime.scheduleRecurring({
    cron: options.cron ?? '*/5 * * * *',
    kind: FEISHU_INTENT_RECONCILIATION_JOB_KIND,
    payload: {},
    scheduleId: FEISHU_INTENT_RECONCILIATION_SCHEDULE_ID,
    timezone: options.timezone ?? 'Asia/Shanghai',
    workspaceId: '__system__',
  });
}
