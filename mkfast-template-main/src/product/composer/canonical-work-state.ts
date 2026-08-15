/**
 * V31-82: semantic stream vs canonical work status.
 *
 * A first-version delivery card can appear while `p1_creative_works` is still
 * running. The inspector must follow the work, not the premature semantic
 * card, and callers record the correction.
 */

import type { ComposerSessionPhase } from './composer-session';
import { workbenchInspectorPhaseOf } from './workbench-state';

export type CanonicalWorkStatus =
  | 'running'
  | 'failed'
  | 'completed'
  | 'cancelled'
  | null;

export type CanonicalCorrection = {
  kind: 'semantic_delivery_without_terminal_work';
};

export function reconcileComposerCanonicalState(input: {
  workStatus: CanonicalWorkStatus;
  semanticDelivered: boolean;
  sessionPhase: ComposerSessionPhase;
}): {
  inspectorPhase: 'idle' | 'running' | 'delivered' | 'failed';
  sessionPhase: ComposerSessionPhase;
  correction: CanonicalCorrection | null;
} {
  if (input.workStatus === 'failed') {
    return {
      inspectorPhase: 'failed',
      sessionPhase: 'failed',
      correction:
        input.semanticDelivered || input.sessionPhase === 'delivered'
          ? { kind: 'semantic_delivery_without_terminal_work' }
          : null,
    };
  }
  if (input.workStatus === 'cancelled') {
    return {
      inspectorPhase: 'idle',
      sessionPhase: 'cancelled',
      correction: null,
    };
  }
  if (input.workStatus === 'completed') {
    return {
      inspectorPhase: 'delivered',
      sessionPhase: 'delivered',
      correction: null,
    };
  }
  if (input.workStatus === 'running' && input.semanticDelivered) {
    return {
      inspectorPhase: 'running',
      sessionPhase:
        input.sessionPhase === 'delivered' ? 'running' : input.sessionPhase,
      correction: { kind: 'semantic_delivery_without_terminal_work' },
    };
  }
  return {
    inspectorPhase: workbenchInspectorPhaseOf(input.sessionPhase),
    sessionPhase: input.sessionPhase,
    correction: null,
  };
}

/**
 * A session restored from sessionStorage can outlive its run: the stalled-work
 * sweeper ends the work server-side, and the rehydrated session keeps claiming
 * 创作进行中 with the composer shut — reloading does not free the merchant,
 * only clearing browser storage does. Absence from the active-task list is the
 * signal the run is over. A conversation that already carries a delivery
 * settles as delivered; anything else becomes startable again.
 */
export function reconcileRestoredSessionPhase(input: {
  sessionPhase: ComposerSessionPhase;
  taskPresentInActiveList: boolean;
  semanticDelivered: boolean;
  /** Persist records the finished work even when the transcript is replayed. */
  hasLastDelivered?: boolean;
}): ComposerSessionPhase | null {
  if (input.taskPresentInActiveList) return null;
  if (input.sessionPhase !== 'running' && input.sessionPhase !== 'submitting') {
    return null;
  }
  return input.semanticDelivered || input.hasLastDelivered
    ? 'delivered'
    : 'cancelled';
}

/**
 * listActiveTasks names the prepared attempt (`${taskId}:plan-rN`), while the
 * Composer session keeps the bare merchant task id from the 202. Those are
 * the same run — not a reprice successor — and must keep polling the bare id
 * so V31-63 can project the successor confirmation into this thread.
 */
export function isPreparedAttemptTaskId(
  taskId: string,
  sessionTaskId: string
): boolean {
  const marker = `${sessionTaskId}:plan-r`;
  if (!taskId.startsWith(marker)) return false;
  return /^[1-9]\d*$/.test(taskId.slice(marker.length));
}

export function sessionTaskPresentInActiveList<
  T extends { taskId: string },
>(input: { sessionTaskId: string; activeTasks: readonly T[] }): boolean {
  return input.activeTasks.some(
    (task) =>
      task.taskId === input.sessionTaskId ||
      isPreparedAttemptTaskId(task.taskId, input.sessionTaskId)
  );
}

/**
 * V31-63: a price-drift successor is a *new* task on the same Thread. The
 * predecessor's prepared-attempt id is the same run, not a successor — the
 * browser must keep polling the original task id so the server can project
 * the successor card. This helper only detects a different-task continuation
 * so restore does not cancel the conversation.
 */
export function adoptSameThreadSuccessor<
  T extends { taskId: string; agentThreadId?: string },
>(input: {
  sessionTaskId: string;
  sessionThreadId?: string;
  activeTasks: readonly T[];
}): T | null {
  const threadId = input.sessionThreadId?.trim();
  if (!threadId) return null;
  return (
    input.activeTasks.find(
      (task) =>
        task.taskId !== input.sessionTaskId &&
        task.agentThreadId === threadId &&
        !isPreparedAttemptTaskId(task.taskId, input.sessionTaskId)
    ) ?? null
  );
}
