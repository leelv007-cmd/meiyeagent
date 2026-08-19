import { getWorkspaceAccess } from '@/api/workspace-access';
import { authClient } from '@/auth/client';
import { hasProductCapability, type ProductCapability } from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';

export function useWorkspaceAccess(userId?: string) {
  const { data: session } = authClient.useSession();
  const sessionUserId = session?.user.id;
  const resolvedUserId = userId ?? sessionUserId ?? 'anonymous';
  const query = useQuery({
    enabled: Boolean(userId ?? sessionUserId),
    queryKey: ['workspace', 'access', resolvedUserId],
    queryFn: () => getWorkspaceAccess(),
    refetchOnMount: 'always',
    retry: false,
  });
  const role = query.data?.role;
  const can = (capability: ProductCapability) =>
    role ? hasProductCapability(role, capability) : false;
  return { ...query, can, role };
}
