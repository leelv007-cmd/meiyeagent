/**
 * R-08 / #211 — read the canonical Pro Studio entitlement projection.
 *
 * All three consumers share one contract module (`lib/pro-studio-entitlement`),
 * so they cannot drift apart. This hook is the shared *read* for the two that
 * live inside the query client — the workbench entry and the fullscreen catalog
 * — which therefore also share one query key. The `/pro-studio` route gate does
 * not use the hook: it owns its own fetch so it can poll while a checkout
 * settles, but it parses the same payload through the same module.
 *
 * A failed or pending read resolves to `unknown`; it never falls back to a
 * seeded verdict.
 */
import { useQuery } from '@tanstack/react-query';

import {
  fetchProStudioEntitlement,
  proStudioEntitlementReason,
  projectProStudioEntitlement,
  type ProStudioEntitlementProjection,
} from '@/lib/pro-studio-entitlement';

export const PRO_STUDIO_ENTITLEMENT_QUERY_KEY = [
  'pro-studio',
  'entitlement',
] as const;

export function useProStudioEntitlement(): {
  projection: ProStudioEntitlementProjection;
  /** Merchant-language reason for a non-active state. */
  reason: string | undefined;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: PRO_STUDIO_ENTITLEMENT_QUERY_KEY,
    queryFn: ({ signal }) => fetchProStudioEntitlement(signal),
    // An unreachable projection is an answer (`unknown`), not a spinner.
    retry: false,
    staleTime: 30_000,
  });
  const projection = projectProStudioEntitlement(query);
  return {
    projection,
    reason: proStudioEntitlementReason(projection),
    refetch: () => void query.refetch(),
  };
}
