const RUNTIME_ID_PREFIX = 'harness.v1';

export function harnessRuntimeId(workspaceId: string, logicalId: string) {
  return [
    RUNTIME_ID_PREFIX,
    Buffer.from(workspaceId, 'utf8').toString('base64url'),
    Buffer.from(logicalId, 'utf8').toString('base64url'),
  ].join(':');
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
