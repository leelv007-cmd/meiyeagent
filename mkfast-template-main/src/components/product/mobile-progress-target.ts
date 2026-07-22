import type { AsyncTaskSummary } from '@/product/async-task-center-model';

export type MobileProgressTarget =
  | { kind: 'result'; workId: string }
  | { kind: 'task-center' };

const terminalStatuses = new Set<AsyncTaskSummary['status']>([
  'cancelled',
  'completed',
  'failed',
]);

/**
 * The mobile progress tab is a shortcut to one active merchant Work, never a
 * dashboard stage with no target. Tasks without a Work (for example Canvas)
 * fall back to the real task center.
 */
export function mobileProgressTarget(
  tasks: readonly AsyncTaskSummary[]
): MobileProgressTarget {
  const current = tasks
    .filter(
      (task) =>
        !terminalStatuses.has(task.status) &&
        typeof task.workId === 'string' &&
        task.workId.trim().length > 0
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  return current?.workId
    ? { kind: 'result', workId: current.workId }
    : { kind: 'task-center' };
}
