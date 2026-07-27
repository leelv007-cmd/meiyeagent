/**
 * The two canonical reads behind 作品 (T32 / #226).
 *
 * Both pages share these query keys with the rest of the app, so a command
 * issued anywhere invalidates the works surface too — one projection, one
 * cache entry, no second history ledger (ADR-0011).
 */

import { useQuery } from '@tanstack/react-query';
import type { PublicContentPackage } from '@meiye/contracts';

import { operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import type { RawCanonicalHistory } from '@/product/canonical-history-model';

export function useWorksProjection() {
  const contentPackages = useQuery({
    queryKey: p1QueryKeys.request('operations', 'content_packages'),
    queryFn: ({ signal }) =>
      operationsQuery<PublicContentPackage[]>('content_packages', {}, signal),
    retry: false,
  });
  const history = useQuery({
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
  });
  return {
    contentPackages,
    /** A failed read is stated as a failure — an empty 作品 面 must mean empty. */
    failed: contentPackages.isError || history.isError,
    history,
    loading: contentPackages.isLoading || history.isLoading,
    source: {
      canvasWorks: history.data?.canvasWorks ?? [],
      contentPackages: contentPackages.data ?? [],
    },
  };
}
