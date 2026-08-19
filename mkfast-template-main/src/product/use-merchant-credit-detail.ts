import { useQuery } from '@tanstack/react-query';

import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';

/** Merchant-safe ledger facts shared by the settings detail and billing views. */
export function useMerchantCreditDetail() {
  return useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'credit_detail'),
    queryFn: ({ signal }) =>
      queryP1(
        'entitlements',
        { action: 'credit_detail', payload: {} },
        signal
      ),
  });
}
