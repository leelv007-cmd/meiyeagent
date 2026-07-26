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

/**
 * 商家语言统一为「内容」(T34 / #228): this surface is where 一级导航「内容」lands,
 * and the product's own word root is 内容 (ContentPackage / 内容编译器, D-118).
 * The route, the directory and the test ids stay `works` — only what a merchant
 * reads changes.
 */
export const WORKS_TITLE = '内容';
export const WORKS_DESCRIPTION = '你做过的文案、图片、图文和视频都在这里。';

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
