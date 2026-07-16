import { asc, eq } from 'drizzle-orm';
import type { getDb as getDatabase } from './index';
import {
  workspaceMemberships,
  workspaces,
  type WorkspaceRole,
} from './app.schema';

type WorkspaceDatabase = ReturnType<typeof getDatabase>;

export async function resolveActiveWorkspace(
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
