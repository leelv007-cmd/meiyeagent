export function normalizeHarnessTerminalFailure(
  error: unknown,
): Record<string, unknown> {
  if (typeof error !== 'object' || error === null) {
    return { code: 'HARNESS_WORKFLOW_FAILED' };
  }
  const value = error as Record<string, unknown>;
  const code =
    typeof value.code === 'string'
      ? value.code
      : value.name === 'StructuredNodeRunError'
        ? 'STRUCTURED_NODE_RUN_FAILED'
        : 'HARNESS_WORKFLOW_FAILED';
  const acceptance = terminalFailureAcceptance(error);
  return {
    code,
    ...(typeof value.status === 'number' ? { status: value.status } : {}),
    ...(typeof value.currentRevision === 'number'
      ? { currentRevision: value.currentRevision }
      : {}),
    ...(typeof value.expectedRevision === 'number'
      ? { expectedRevision: value.expectedRevision }
      : {}),
    ...(typeof value.packageId === 'string'
      ? { packageId: value.packageId }
      : {}),
    ...(acceptance ? { acceptance } : {}),
    ...(Array.isArray(value.gateIds) ? { gateIds: value.gateIds } : {}),
    ...(typeof value.merchantMessage === 'string'
      ? { merchantMessage: value.merchantMessage }
      : {}),
    ...(Array.isArray(value.violations) && value.violations.length > 0
      ? { violations: structuredClone(value.violations) }
      : {}),
  };
}

/** 失败档 wraps StructuredNodeRunError in AgentPrimitiveExecutionError. */
function terminalFailureAcceptance(error: unknown): string | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    if (typeof value.acceptance === 'string' && value.acceptance) {
      return value.acceptance;
    }
    current = 'cause' in value ? value.cause : undefined;
  }
  return undefined;
}
