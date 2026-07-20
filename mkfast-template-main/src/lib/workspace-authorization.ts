import type { WorkspaceRole } from '@/db/app.schema';
import { hasProductCapability, type ProductCapability } from '@meiye/contracts';

export class WorkspaceCapabilityError extends Error {
  readonly code = 'FORBIDDEN';
  readonly status = 403;
}

export function workspaceCan(
  role: WorkspaceRole,
  capability: ProductCapability
) {
  return hasProductCapability(role, capability);
}

export function requireWorkspaceCapability(
  role: WorkspaceRole,
  capability: ProductCapability
) {
  if (!workspaceCan(role, capability)) {
    throw new WorkspaceCapabilityError('Forbidden');
  }
}
