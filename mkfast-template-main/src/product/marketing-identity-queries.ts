import type { QueryClient } from '@tanstack/react-query';

import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import type {
  MarketingIdentityAsset,
  MarketingIdentityProjection,
} from '@meiye/contracts';

/**
 * Shared identity reads for the T33 surfaces — #227.
 *
 * The identity list and the default-identity projection are two views of one
 * decision record: registering, transitioning or re-pointing the default moves
 * both. Keeping them on the module-scoped p1QueryKeys namespace means a single
 * invalidation covers both, which is what a stale default badge on a withdrawn
 * identity was missing.
 *
 * Composer and the identity workspace consume this shared projection key.
 */
export const marketingIdentitiesQuery = {
  queryKey: p1QueryKeys.request('marketing-identity', 'marketing_identities', {
    includeInactive: true,
  }),
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    queryP1<MarketingIdentityAsset[]>(
      'marketing-identity',
      { action: 'marketing_identities', payload: { includeInactive: true } },
      signal
    ),
};

export const marketingIdentityProjectionQuery = {
  queryKey: p1QueryKeys.request(
    'marketing-identity',
    'marketing_identity_projection'
  ),
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    queryP1<MarketingIdentityProjection>(
      'marketing-identity',
      { action: 'marketing_identity_projection', payload: {} },
      signal
    ),
};

/** Every identity write moves the list and the projection together. */
export function invalidateMarketingIdentity(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: p1QueryKeys.module('marketing-identity'),
  });
}
