import { getWorkspaceAccess } from '@/api/workspace-access';
import { hasProductCapability, type ProductCapability } from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';

export function useWorkspaceAccess() {
  const query = useQuery({
    queryKey: ['workspace', 'access'],
    queryFn: () => getWorkspaceAccess(),
  });
  const role = query.data?.role;
  const can = (capability: ProductCapability) =>
    role ? hasProductCapability(role, capability) : false;
  return { ...query, can, role };
}
