import type { getDb as getDatabase } from '@/db';
import {
  workspaceMemberships,
  workspaceProvisioningOutbox,
  workspaces,
} from '@/db/app.schema';

type WorkspaceDatabase = ReturnType<typeof getDatabase>;

export type WorkspaceBootstrapUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
};

export type PersonalWorkspaceBootstrap = {
  workspace: {
    id: string;
    name: string;
  };
  membership: {
    workspaceId: string;
    userId: string;
    role: 'owner';
  };
};

export function getPersonalWorkspaceId(userId: string) {
  return `ws_${userId}`;
}

export function buildPersonalWorkspaceBootstrap(
  user: WorkspaceBootstrapUser
): PersonalWorkspaceBootstrap {
  if (!user.emailVerified) {
    throw new Error('Workspace bootstrap requires a verified user.');
  }

  const workspaceId = getPersonalWorkspaceId(user.id);
  const workspaceName =
    user.name.trim() || user.email.toLowerCase().split('@')[0] || user.id;

  return {
    workspace: {
      id: workspaceId,
      name: workspaceName,
    },
    membership: {
      workspaceId,
      userId: user.id,
      role: 'owner',
    },
  };
}

export async function ensurePersonalWorkspace(
  user: WorkspaceBootstrapUser,
  database?: WorkspaceDatabase
) {
  const bootstrap = buildPersonalWorkspaceBootstrap(user);
  const db = database ?? (await import('@/db')).getDb();

  const result = await db.transaction(async (transaction) => {
    await transaction
      .insert(workspaces)
      .values(bootstrap.workspace)
      .onConflictDoNothing({ target: workspaces.id });
    await transaction
      .insert(workspaceMemberships)
      .values(bootstrap.membership)
      .onConflictDoNothing({
        target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      });
    await transaction
      .insert(workspaceProvisioningOutbox)
      .values({
        workspaceId: bootstrap.workspace.id,
        ownerUserId: user.id,
      })
      .onConflictDoNothing({ target: workspaceProvisioningOutbox.workspaceId });

    return bootstrap;
  });

  return result;
}
