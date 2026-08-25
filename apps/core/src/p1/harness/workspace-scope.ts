const RUNTIME_ID_PREFIX = 'harness.v1';

export function harnessRuntimeId(workspaceId: string, logicalId: string) {
  return [
    RUNTIME_ID_PREFIX,
    Buffer.from(workspaceId, 'utf8').toString('base64url'),
    Buffer.from(logicalId, 'utf8').toString('base64url'),
  ].join(':');
}

/**
 * End Harness DBOS workflows after terminateRunningWork. Composer SSE only
 * leaves the progress stream once the workflow is no longer PENDING, then
 * readState lifts workflow_failed into the 申报卡.
 */
export async function cancelHarnessRuntimeWorkflows(input: {
  workspaceId: string;
  workflowIds: readonly string[];
  cancel: (runtimeId: string) => Promise<void>;
}): Promise<void> {
  for (const logicalId of input.workflowIds) {
    await input.cancel(harnessRuntimeId(input.workspaceId, logicalId)).catch(
      () => undefined,
    );
    await input.cancel(logicalId).catch(() => undefined);
  }
}

export function harnessLogicalId(runtimeId: string) {
  const [prefix, _workspace, logical, ...rest] = runtimeId.split(':');
  if (prefix !== RUNTIME_ID_PREFIX || !logical || rest.length > 0) {
    return runtimeId;
  }
  try {
    return Buffer.from(logical, 'base64url').toString('utf8');
  } catch {
    return runtimeId;
  }
}
