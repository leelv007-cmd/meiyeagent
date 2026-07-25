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
    ...(typeof value.acceptance === 'string'
      ? { acceptance: value.acceptance }
      : {}),
    ...(Array.isArray(value.gateIds) ? { gateIds: value.gateIds } : {}),
    ...(typeof value.merchantMessage === 'string'
      ? { merchantMessage: value.merchantMessage }
      : {}),
  };
}
