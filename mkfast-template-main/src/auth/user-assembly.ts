import type { User } from 'better-auth';

type AssemblyUser = Pick<User, 'id' | 'email' | 'emailVerified' | 'name'>;

type AssemblyDependencies = {
  ensureWorkspace: (user: AssemblyUser) => Promise<{
    workspace: { id: string; name: string };
  }>;
  provisionWorkspace: (input: {
    ownerEmail: string;
    workspaceId: string;
    ownerUserId: string;
    ownerName: string;
    workspaceName: string;
  }) => Promise<unknown>;
};

export async function assembleVerifiedUser(
  user: AssemblyUser,
  dependencies: AssemblyDependencies
) {
  if (!user.emailVerified) return null;

  const workspace = await dependencies.ensureWorkspace(user);
  return dependencies.provisionWorkspace({
    ownerEmail: user.email,
    ownerUserId: user.id,
    ownerName: user.name.trim() || workspace.workspace.name,
    workspaceId: workspace.workspace.id,
    workspaceName: workspace.workspace.name,
  });
}
