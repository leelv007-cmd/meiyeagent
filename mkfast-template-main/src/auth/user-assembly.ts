import type { User } from 'better-auth';

type AssemblyUser = Pick<User, 'id' | 'email' | 'emailVerified' | 'name'>;

type AssemblyDependencies = {
  ensureWorkspace: (user: AssemblyUser) => Promise<{
    workspace: { id: string };
  }>;
  provisionWorkspace: (input: {
    workspaceId: string;
    ownerUserId: string;
  }) => Promise<unknown>;
};

export async function assembleVerifiedUser(
  user: AssemblyUser,
  dependencies: AssemblyDependencies
) {
  if (!user.emailVerified) return null;

  const workspace = await dependencies.ensureWorkspace(user);
  return dependencies.provisionWorkspace({
    ownerUserId: user.id,
    workspaceId: workspace.workspace.id,
  });
}
