import { getWorkspaceProvisioningStatus } from '@/api/workspace-provisioning-status';
import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';

export function useWorkspaceProvisioningNotice() {
  const isAdmin = useRouterState({
    select: (state) => state.location.pathname.startsWith('/admin'),
  });
  const query = useQuery({
    enabled: !isAdmin,
    queryFn: () => getWorkspaceProvisioningStatus(),
    queryKey: ['workspace', 'provisioning-status'],
    staleTime: 15_000,
  });
  return Boolean(query.data?.degraded);
}
