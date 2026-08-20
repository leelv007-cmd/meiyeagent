/**
 * Paid Living Plan start binding (image_text / video).
 *
 * Campaign U7 waits for accepted planning and reads
 * `executionConfirmationRequestId` off the paid-work projection.
 * SUBMIT-01A `accept()` returns 202 before that row exists, so a non-Campaign
 * paid run must keep polling harness active-tasks until the same id lands.
 * Overlay phase (awaiting_answer) and a false "task left the list" cancel must
 * not freeze 开始制作 on a priced plan that is still preparing confirmation.
 */

import { matchingActiveHarnessTask } from './canonical-work-state';
import type { ComposerSession, ComposerSessionTask } from './composer-session';

export function shouldPollPaidConfirmationRequestId(input: {
  requiresMerchantConfirmation: boolean;
  task: Pick<ComposerSessionTask, 'executionConfirmationRequestId'> | null;
  phase: ComposerSession['phase'];
}): boolean {
  if (!input.requiresMerchantConfirmation || !input.task) return false;
  if (input.task.executionConfirmationRequestId?.trim()) return false;
  return (
    input.phase !== 'failed' &&
    input.phase !== 'delivered' &&
    input.phase !== 'cancelled'
  );
}

export function paidConfirmationRequestIdFromActiveTasks(input: {
  sessionTaskId: string;
  activeTasks: readonly {
    taskId: string;
    executionConfirmationRequestId?: string;
  }[];
}): string | null {
  const requestId =
    matchingActiveHarnessTask(input)?.executionConfirmationRequestId?.trim();
  return requestId ? requestId : null;
}

/**
 * SUBMIT-01A parks the paid run until preparePendingConfirmation writes the
 * harness row. The first listActiveTasks reads are empty planning, not a
 * swept session — Campaign never hits this because it waits for accept.
 */
export function shouldReconcileMissingPaidActiveTask(input: {
  waitingForPaidConfirmation: boolean;
}): boolean {
  return !input.waitingForPaidConfirmation;
}
