export type AgentWorkbenchIdentity = {
  accountId: string | null;
  workspaceId: string | null;
  threadId: string | null;
};

export function createAgentWorkbenchIdentity(input?: {
  accountId?: string | null;
  workspaceId?: string | null;
  threadId?: string | null;
}): AgentWorkbenchIdentity {
  return {
    accountId: normalizedIdentityPart(input?.accountId),
    workspaceId: normalizedIdentityPart(input?.workspaceId),
    threadId: normalizedIdentityPart(input?.threadId),
  };
}

export function isSameAgentWorkbenchIdentity(
  left: AgentWorkbenchIdentity,
  right: AgentWorkbenchIdentity
): boolean {
  return (
    left.accountId === right.accountId &&
    left.workspaceId === right.workspaceId &&
    left.threadId === right.threadId
  );
}

function normalizedIdentityPart(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}
