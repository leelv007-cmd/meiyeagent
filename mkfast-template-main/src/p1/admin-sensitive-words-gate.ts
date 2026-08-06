/**
 * Shared enabled-lexicon gate status for admin exception home + audit (Spec F / D9 / #384).
 *
 * Cold-start semantics of the gate itself (empty enabled lexicon → skip scan) are
 * unchanged. This module only surfaces whether that soft-open state is active so
 * operators know content redlines are not currently enforcing.
 */
import { useQuery } from '@tanstack/react-query';

import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import type { SensitiveWordRecord } from '@meiye/contracts';

/** Shared query key: list enabled words only. Home + audit must both use this. */
export const adminEnabledSensitiveWordsQueryKey = p1QueryKeys.request(
  'sensitive-words',
  'list',
  { status: 'enabled' }
);

const ADMIN_SENSITIVE_WORDS_GATE_STALE_TIME_MS = 15_000;

export type EnabledSensitiveWordsListPayload = {
  items: SensitiveWordRecord[];
  total: number;
};

/**
 * Three-state (+ active) projection of the sensitive-words gate surface.
 * Loading and error must never collapse into the empty-lexicon inactive alert.
 */
export type SensitiveWordsGateStatus =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'inactive'; total: 0 }
  | { kind: 'active'; total: number };

export function projectSensitiveWordsGateStatus(input: {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  total?: number;
}): SensitiveWordsGateStatus {
  // Pending without a settled outcome: never treat as empty lexicon.
  if (input.isPending) {
    return { kind: 'loading' };
  }
  // Failed verification: never treat as empty lexicon or "green active".
  if (input.isError) {
    return { kind: 'error' };
  }
  if (input.isSuccess) {
    const total = input.total ?? 0;
    if (total === 0) {
      return { kind: 'inactive', total: 0 };
    }
    return { kind: 'active', total };
  }
  // Unsettled fallback — still not empty, not green.
  return { kind: 'loading' };
}

export async function readEnabledSensitiveWordsList(signal?: AbortSignal) {
  return queryP1<EnabledSensitiveWordsListPayload>(
    'sensitive-words',
    {
      action: 'list',
      payload: { status: 'enabled' },
    },
    signal
  );
}

/**
 * Shared live query for enabled lexicon total.
 * Exception home and audit page both call this hook (same key → one network fetch).
 */
export function useAdminEnabledSensitiveWordsGate() {
  const query = useQuery({
    queryKey: adminEnabledSensitiveWordsQueryKey,
    queryFn: ({ signal }) => readEnabledSensitiveWordsList(signal),
    refetchOnWindowFocus: true,
    staleTime: ADMIN_SENSITIVE_WORDS_GATE_STALE_TIME_MS,
  });

  const status = projectSensitiveWordsGateStatus({
    isPending: query.isPending,
    isError: query.isError,
    isSuccess: query.isSuccess,
    total: query.data?.total,
  });

  return {
    status,
    query,
    total: query.data?.total,
  };
}
