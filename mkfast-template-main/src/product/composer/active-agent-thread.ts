import type { ComposerSessionPhase } from './composer-session';
import { isWorkbenchEngaged } from './workbench-state';

export type ActiveAgentThreadInput = {
  explicitThreadId?: string | null;
  taskAgentThreadId?: string | null;
  continuedAgentThreadId?: string | null;
  agentBindingThreadId?: string | null;
  phase?: string | null;
};

export function selectActiveAgentThreadId(
  input: ActiveAgentThreadInput
): string | null {
  return (
    input.explicitThreadId ??
    input.taskAgentThreadId ??
    (input.phase === 'delivered' ? input.continuedAgentThreadId : undefined) ??
    input.agentBindingThreadId ??
    null
  );
}

/**
 * The Thread a *new* submission may ask to continue.
 *
 * A Thread admits one active write turn (`assertWriteTurnAdmissible`, U6). So
 * naming the Thread of a run that is still in flight makes Core accept the
 * submission — 202, with a fresh runId — and then fail its planning turn with
 * AGENT_ACTIVE_TURN_CONFLICT: a promised Run that never exists, and therefore
 * no release pin for it either. A creation started while another run is in
 * flight opens its own Thread instead; a delivered Thread is still continued,
 * which is what keeps Delivered ≠ Thread complete (§2.3 / EXEC-04).
 *
 * The phase passed here must be the one captured when the merchant pressed
 * send: `openComposerTurn` moves the session to `submitting` as the press is
 * handled, and reading the phase after that would answer about this press
 * instead of about the run it has to make room for.
 */
export function selectSubmissionAgentThreadId(input: {
  activeAgentThreadId: string | null;
  phase: ComposerSessionPhase;
}): string | null {
  return isWorkbenchEngaged(input.phase) ? null : input.activeAgentThreadId;
}

export function pickComposerRestoreTask<
  T extends { taskId: string; agentThreadId?: string },
>(input: {
  tasks: readonly T[];
  initialTaskId?: string | null;
  initialThreadId?: string | null;
}): T | null {
  if (input.initialTaskId) {
    return (
      input.tasks.find((task) => task.taskId === input.initialTaskId) ?? null
    );
  }
  const threadId = input.initialThreadId?.trim();
  if (threadId) {
    return input.tasks.find((task) => task.agentThreadId === threadId) ?? null;
  }
  return input.tasks[0] ?? null;
}

export function isPublishHandoffThreadCurrent(input: {
  activeThreadId?: string | null;
  deliveredThreadId?: string | null;
}): boolean {
  return Boolean(
    input.activeThreadId && input.activeThreadId === input.deliveredThreadId
  );
}
