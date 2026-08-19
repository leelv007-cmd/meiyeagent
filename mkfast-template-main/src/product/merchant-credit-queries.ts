import type { QueryClient } from '@tanstack/react-query';

import { p1QueryKeys } from '@/p1/query-keys';

/** Merchant-facing credit reads that a ledger write must refresh together. */
export const merchantCreditQueryKeys = {
  balance: p1QueryKeys.request('entitlements', 'balance'),
  creditDetail: p1QueryKeys.request('entitlements', 'credit_detail'),
  projection: p1QueryKeys.request('entitlements', 'projection'),
} as const;

/**
 * Redeem (and other ledger writes) must not leave the settings detail or
 * composer balance on a stale cache while the other view refreshes.
 */
export function invalidateMerchantCreditQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: merchantCreditQueryKeys.projection,
    }),
    queryClient.invalidateQueries({
      queryKey: merchantCreditQueryKeys.creditDetail,
    }),
    queryClient.invalidateQueries({
      queryKey: merchantCreditQueryKeys.balance,
    }),
  ]);
}
