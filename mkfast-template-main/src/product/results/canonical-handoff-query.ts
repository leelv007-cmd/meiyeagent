import { queryOptions } from '@tanstack/react-query';

import {
  loadCanonicalHandoff,
  type CanonicalHandoffSubmit,
} from './delivery-handoff-live';

function canonicalHandoffQueryKey(token: string) {
  return ['result-delivery', 'canonical-handoff', token] as const;
}

/**
 * A one-shot token is consumed by the first successful query. Keep that result
 * stable for the current QueryClient/page session; automatic lifecycle refetch
 * would be a second consumer and must fail closed on the server.
 */
export function canonicalHandoffQueryOptions(input: {
  canShareFiles: boolean;
  nowIso: () => string;
  origin: string;
  submit: CanonicalHandoffSubmit;
  token: string;
}) {
  return queryOptions({
    queryKey: canonicalHandoffQueryKey(input.token),
    queryFn: () =>
      loadCanonicalHandoff(input.token, input.submit, {
        canShareFiles: input.canShareFiles,
        nowIso: input.nowIso(),
        origin: input.origin,
      }),
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
