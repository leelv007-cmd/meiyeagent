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
