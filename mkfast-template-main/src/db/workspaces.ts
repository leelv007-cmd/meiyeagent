import { and, asc, eq } from 'drizzle-orm';
import type { getDb as getDatabase } from './index';
import {
  workspaceMemberships,
  workspaces,
  type WorkspaceRole,
} from './app.schema';

type WorkspaceDatabase = ReturnType<typeof getDatabase>;

/**
 * Compatibility default for single-workspace product surfaces.
 *
 * This is not user-selected active-workspace state. Internal and admin callers
 * that already have a workspace id must use `resolveWorkspaceMembership`.
 */
export async function resolveDefaultWorkspace(
  userId: string,
  database?: WorkspaceDatabase
): Promise<{ id: string; role: WorkspaceRole } | undefined> {
  const db = database ?? (await import('./index')).getDb();
  const [workspace] = await db
    .select({ id: workspaces.id, role: workspaceMemberships.role })
    .from(workspaces)
    .innerJoin(
      workspaceMemberships,
      eq(workspaceMemberships.workspaceId, workspaces.id)
    )
    .where(eq(workspaceMemberships.userId, userId))
    .orderBy(
      asc(workspaceMemberships.createdAt),
      asc(workspaceMemberships.workspaceId)
    )
    .limit(1);

  return workspace;
}

export async function resolveWorkspaceMembership(
  userId: string,
  workspaceId: string,
  database?: WorkspaceDatabase
): Promise<{ id: string; role: WorkspaceRole } | undefined> {
  const db = database ?? (await import('./index')).getDb();
  const [workspace] = await db
    .select({ id: workspaces.id, role: workspaceMemberships.role })
    .from(workspaces)
    .innerJoin(
      workspaceMemberships,
      eq(workspaceMemberships.workspaceId, workspaces.id)
    )
    .where(
      and(
        eq(workspaceMemberships.userId, userId),
        eq(workspaceMemberships.workspaceId, workspaceId)
      )
    )
    .limit(1);

  return workspace;
}

/** @deprecated Use resolveDefaultWorkspace or resolveWorkspaceMembership. */
export const resolveActiveWorkspace = resolveDefaultWorkspace;
