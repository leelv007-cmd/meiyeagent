import { getCurrentPlan } from '@/api/payment';
import { useQuery } from '@tanstack/react-query';

export function useCurrentPlan(enabled = true) {
  return useQuery({
    queryKey: ['currentPlan'],
    queryFn: async () => {
      return getCurrentPlan();
    },
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
}
