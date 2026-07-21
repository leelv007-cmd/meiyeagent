import { resolveDefaultWorkspace } from '@/db/workspaces';
import { authApiMiddleware } from '@/middlewares/auth-middleware';
import { createServerFn } from '@tanstack/react-start';

export const getWorkspaceAccess = createServerFn({ method: 'GET' })
  .middleware([authApiMiddleware])
  .handler(async ({ context }) => {
    const workspace = await resolveDefaultWorkspace(context.userId);
    if (!workspace) throw new Error('Workspace not found');
    return { id: workspace.id, role: workspace.role };
  });
