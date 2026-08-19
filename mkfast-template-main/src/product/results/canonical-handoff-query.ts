import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  loadCanonicalHandoff,
  type CanonicalHandoffSubmit,
} from './delivery-handoff-live';

function canonicalHandoffQueryKey(input: {
  token: string;
  userId: string;
  workspaceId: string;
}) {
  return [
    'result-delivery',
    'canonical-handoff',
    input.userId,
    input.workspaceId,
    input.token,
  ] as const;
}

export type CanonicalHandoffQueryInput = {
  canShareFiles: boolean;
  nowIso: () => string;
  origin: string;
  submit: CanonicalHandoffSubmit;
  token: string;
  userId: string;
  workspaceId: string;
};

/**
 * A one-shot token is consumed by the first successful query. Keep that result
 * stable for the current QueryClient/page session; automatic lifecycle refetch
 * would be a second consumer and must fail closed on the server.
 */
function canonicalHandoffQueryOptions(input: CanonicalHandoffQueryInput) {
  return queryOptions({
    queryKey: canonicalHandoffQueryKey(input),
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
    select: (result) => {
      const receipt = result.serverRecord?.assistedReceipt;
      if (
        receipt &&
        (receipt.workspaceId !== input.workspaceId ||
          receipt.binding?.workspaceId !== input.workspaceId)
      ) {
        return { resolve: { kind: 'not_found' as const } };
      }
      return result;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

function isForeignCanonicalHandoffQuery(
  queryKey: readonly unknown[],
  identity: Pick<CanonicalHandoffQueryInput, 'userId' | 'workspaceId'>
) {
  return (
    queryKey[0] === 'result-delivery' &&
    queryKey[1] === 'canonical-handoff' &&
    (queryKey[2] !== identity.userId || queryKey[3] !== identity.workspaceId)
  );
}

export function useCanonicalHandoffQuery(input: CanonicalHandoffQueryInput) {
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.removeQueries({
      predicate: (query) =>
        isForeignCanonicalHandoffQuery(query.queryKey, input),
    });
  }, [input.userId, input.workspaceId, queryClient]);
  return useQuery(canonicalHandoffQueryOptions(input));
}
