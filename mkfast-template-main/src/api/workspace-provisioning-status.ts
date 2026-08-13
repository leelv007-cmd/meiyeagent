import { getDb } from '@/db';
import { resolveDefaultWorkspace } from '@/db/workspaces';
import {
  PostgresWorkspaceProvisioningOutbox,
  isWorkspaceProvisioningDegraded,
} from '@/lib/auth/workspace-provisioning';
import { authApiMiddleware } from '@/middlewares/auth-middleware';
import { createServerFn } from '@tanstack/react-start';

export const getWorkspaceProvisioningStatus = createServerFn({ method: 'GET' })
  .middleware([authApiMiddleware])
  .handler(async ({ context }) => {
    const workspace = await resolveDefaultWorkspace(context.userId);
    if (!workspace || workspace.role !== 'owner') {
      return { degraded: false };
    }
    const record = await new PostgresWorkspaceProvisioningOutbox(getDb()).get(
      workspace.id,
      context.userId
    );
    return { degraded: isWorkspaceProvisioningDegraded(record) };
  });
