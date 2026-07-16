import type { JobRuntimeHandler } from '../job-runtime/job-contracts.js';
import {
  OperationsError,
  type OperationsApplicationService,
} from './application-service.js';
import type { BuiltInTriggerKind } from './types.js';

export const OPERATIONS_TRIGGER_JOB_KIND = 'operations.trigger';

const triggerKinds = new Set<BuiltInTriggerKind>([
  'weekly_batch_ready',
  'asset_gap_detected',
  'stale_draft_detected',
  'weekly_review_ready',
]);

export function createOperationsTriggerJobHandler(
  operations: OperationsApplicationService
): JobRuntimeHandler {
  return async (envelope, worker) => {
    if (envelope.kind !== OPERATIONS_TRIGGER_JOB_KIND) {
      return {
        status: 'dead_letter',
        output: { code: 'UNSUPPORTED_JOB_KIND' },
      };
    }
    const triggerKind = envelope.payload.triggerKind;
    if (
      typeof triggerKind !== 'string' ||
      !triggerKinds.has(triggerKind as BuiltInTriggerKind)
    ) {
      return {
        status: 'dead_letter',
        output: { code: 'INVALID_TRIGGER_KIND' },
      };
    }
    const kind = triggerKind as BuiltInTriggerKind;
    try {
      const result = await operations.runTrigger(
        {
          actor: 'worker',
          correlationId: `${envelope.jobId}:${worker.transportId}`,
          userId: 'operations-trigger-worker',
          workspaceId: envelope.workspaceId,
        },
        {
          kind,
          sourceId: envelope.jobId,
          timeWindow: triggerTimeWindow(kind, worker.claimedAt),
        }
      );
      return {
        status: 'completed',
        output: {
          triggerRunId: result.run.id,
          triggerStatus: result.run.status,
          ...(result.run.taskId ? { taskId: result.run.taskId } : {}),
        },
      };
    } catch (error) {
      if (
        error instanceof OperationsError &&
        error.code === 'TRIGGER_DISABLED'
      ) {
        return {
          status: 'completed',
          output: { triggerStatus: 'disabled' },
        };
      }
      return {
        status: 'retry',
        output: {
          code:
            error instanceof OperationsError ? error.code : 'TRIGGER_FAILED',
        },
      };
    }
  };
}

function triggerTimeWindow(kind: BuiltInTriggerKind, claimedAt: string) {
  const localDate = shanghaiDate(claimedAt);
  return kind === 'weekly_batch_ready' || kind === 'weekly_review_ready'
    ? isoWeek(localDate)
    : localDate;
}

function shanghaiDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()))
    throw new Error('claimedAt must be an ISO date.');
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(date);
}

function isoWeek(localDate: string) {
  const [year, month, day] = localDate.split('-').map(Number);
  const target = new Date(Date.UTC(year!, month! - 1, day!));
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const first = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((target.getTime() - first.getTime()) / 86_400_000 + 1) / 7
  );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
