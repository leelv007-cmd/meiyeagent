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
