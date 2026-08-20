import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';

import {
  workbench_credit_balance,
  workbench_credit_expiring,
} from '@/locale/paraglide/messages';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  projectWorkbenchCreditBalance,
  type WorkbenchCreditBalanceView,
} from '@/product/composer/workbench-credit';

export function formatCreditsSummary(
  view: WorkbenchCreditBalanceView
): string | undefined {
  if (!view.visible) return undefined;
  if (view.expiringLot) {
    return `${workbench_credit_balance({
      count: view.availableCredits,
    })} · ${workbench_credit_expiring({
      count: view.expiringLot.remainingCredits,
      days: view.expiringLot.daysUntilExpiry,
    })}`;
  }
  return workbench_credit_balance({
    count: view.availableCredits,
  });
}

/**
 * Topbar credits pill text. Dashboard already computes a summary; other
 * merchant pages omit it, so this hook reads the same entitlements projection.
 */
export function useShellCreditsSummary(override?: string) {
  const isAdmin = useRouterState({
    select: (state) => state.location.pathname.startsWith('/admin'),
  });
  const query = useQuery({
    enabled: !isAdmin && override === undefined,
    queryKey: p1QueryKeys.request('entitlements', 'projection'),
    queryFn: ({ signal }) =>
      queryP1('entitlements', { action: 'projection', payload: {} }, signal),
    staleTime: 30_000,
  });
  if (override !== undefined) return override;
  return formatCreditsSummary(
    projectWorkbenchCreditBalance(query.data?.credits, new Date())
  );
}
