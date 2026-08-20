/**
 * ARCH-02 / SUBMIT-01B: legacy Composer UI is a read-only adapter of the
 * unique AgentEventStore Thread projection.
 *
 * This module never accepts setSession / dispatch. Overlay is a pure view:
 * local ComposerSession (merchant draft, submit handle) is not mutated.
 */

import {
  boundWorkbenchTaskId,
  type AgentWorkbenchClientState,
  type InterruptProjection,
  type ThreadTurnPhase,
} from '@/product/agent-workbench/agent-event-reducer';

import {
  applyComposerPendingInterrupts,
  applyComposerWorkflowState,
  type ComposerSession,
  type ComposerSessionPhase,
} from './composer-session';

export type { ThreadTurnPhase };

export type ComposerThreadProjection = {
  turnPhase: ThreadTurnPhase | null;
  composerPhase: ComposerSessionPhase | null;
  taskId: string | null;
  runId: string | null;
  threadId: string | null;
  workId: string | null;
  interrupts: readonly InterruptProjection[];
};

export function projectComposerThread(
  workbench: AgentWorkbenchClientState
): ComposerThreadProjection {
  return {
    turnPhase: workbench.turnPhase,
    composerPhase: composerPhaseFromThread(workbench),
    taskId: boundWorkbenchTaskId(workbench),
    runId: workbench.turnRunId ?? workbench.session?.activeRunId ?? null,
    threadId:
      workbench.session?.threadId ?? workbench.identity.threadId ?? null,
    workId:
      workbench.session?.current?.workId ??
      workbench.session?.recent?.workId ??
      null,
    interrupts: workbench.pendingInterrupts,
  };
}

export function composerPhaseFromThread(
  workbench: AgentWorkbenchClientState
): ComposerSessionPhase | null {
  const phase = workbench.turnPhase;
  if (phase === 'failure') return 'failed';
  if (phase === 'ready') return 'delivered';
  if (workbench.pendingInterrupts.length > 0) {
    return 'awaiting_answer';
  }
  if (phase === 'accepted' || phase === 'planning') return 'running';
  return null;
}

/**
 * Read-only view of local ComposerSession with Thread facts from the store.
 * Does not mutate `local`. Callers must not write the result back via setSession.
 */
export function projectComposerSessionFromThread(
  local: ComposerSession,
  workbench: AgentWorkbenchClientState
): ComposerSession {
  if (!local.task || !workbench.session) return local;
  const localThread = local.task.agentThreadId ?? local.continuedAgentThreadId;
  if (
    localThread &&
    workbench.session.threadId &&
    localThread !== workbench.session.threadId
  ) {
    return local;
  }

  const thread = projectComposerThread(workbench);
  let next = overlayTask(local, thread);
  next = overlayInterrupts(next, workbench.pendingInterrupts);
  next = overlayTurnPhase(next, thread);
  return next;
}

function overlayTask(
  local: ComposerSession,
  thread: ComposerThreadProjection
): ComposerSession {
  const task = local.task;
  if (!task || !thread.taskId) return local;
  const agentThreadId = thread.threadId ?? task.agentThreadId;
  const agentRunId = thread.runId ?? task.agentRunId;
  const workId = thread.workId ?? task.workId;
  if (
    task.taskId === thread.taskId &&
    task.workId === workId &&
    task.agentThreadId === agentThreadId &&
    task.agentRunId === agentRunId
  ) {
    return local;
  }
  return {
    ...local,
    task: {
      ...task,
      taskId: thread.taskId,
      workId,
      ...(agentThreadId ? { agentThreadId } : {}),
      ...(agentRunId ? { agentRunId } : {}),
    },
  };
}

function overlayInterrupts(
  session: ComposerSession,
  interrupts: readonly InterruptProjection[]
): ComposerSession {
  if (interrupts.length === 0) return session;
  let questionId: string | null = null;
  let executionConfirmId: string | null = null;
  for (const interrupt of interrupts) {
    if (isQuestionInterrupt(interrupt) && !questionId) {
      questionId = interrupt.interruptId;
    }
    if (isExecutionConfirmInterrupt(interrupt) && !executionConfirmId) {
      executionConfirmId = interrupt.interruptId;
    }
  }
  const existingConfirm = session.turns.find(
    (
      turn
    ): turn is Extract<
      ComposerSession['turns'][number],
      { kind: 'execution_confirm' }
    > => turn.kind === 'execution_confirm'
  );
  return applyComposerPendingInterrupts(session, {
    questionId,
    executionConfirmId:
      executionConfirmId ?? existingConfirm?.confirmId ?? null,
  });
}

function overlayTurnPhase(
  session: ComposerSession,
  thread: ComposerThreadProjection
): ComposerSession {
  if (thread.turnPhase === 'failure') {
    return session.phase === 'failed'
      ? session
      : applyComposerWorkflowState(session, 'failed');
  }
  if (thread.turnPhase === 'ready') {
    return applyComposerWorkflowState(session, 'success');
  }
  const phase = thread.composerPhase;
  if (!phase || phase === session.phase) return session;
  return { ...session, phase };
}

function isQuestionInterrupt(interrupt: InterruptProjection): boolean {
  return (
    interrupt.interruptType === 'answer_question' ||
    interrupt.interruptType === 'ask_merchant'
  );
}

function isExecutionConfirmInterrupt(interrupt: InterruptProjection): boolean {
  return (
    interrupt.interruptType === 'execution_confirm' ||
    interrupt.interruptType === 'execution_confirmation'
  );
}
