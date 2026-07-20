/**
 * Fullscreen creation catalog route — `/dashboard/catalog` (C3 / #97, D-093).
 *
 * Dual tab: 模板 | 工具. Allowlisted search only (tab/category/q/surface/return).
 * Search UI gated at 12 published-visible items; match implementation deferred.
 *
 * Wiring note: path constant lives in `src/product/composer/composer-nav.ts`
 * (COMPOSER_CATALOG_PATH) so freeze-listed `lib/routes.ts` need not change.
 * After merge, regenerate routeTree via the app's route codegen if required.
 */

import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import {
  FullscreenCatalogPanel,
  catalogStateFromSearch,
  catalogStateToHref,
  type CatalogReturnRestoreSnapshot,
  type CatalogUiState,
} from '@/product/composer';
import { COMPOSER_HOME_PATH } from '@/product/composer/composer-nav';

export type CatalogSearch = {
  tab?: 'templates' | 'tools';
  category?: string;
  surfaceRevisionId?: string;
  returnKey?: string;
  q?: string;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Exported for unit tests — same search validation as the route. */
export function validateCatalogSearch(
  search: Record<string, unknown>
): CatalogSearch {
  const tabRaw = optionalString(search.tab);
  const tab =
    tabRaw === 'templates' || tabRaw === 'tools'
      ? tabRaw
      : tabRaw === 'recipe'
        ? 'templates'
        : tabRaw === 'tool'
          ? 'tools'
          : undefined;
  return {
    ...(tab ? { tab } : {}),
    ...(optionalString(search.category)
      ? { category: optionalString(search.category) }
      : {}),
    ...(optionalString(search.surfaceRevisionId)
      ? { surfaceRevisionId: optionalString(search.surfaceRevisionId) }
      : {}),
    ...(optionalString(search.returnKey)
      ? { returnKey: optionalString(search.returnKey) }
      : {}),
    ...(optionalString(search.q) ? { q: optionalString(search.q) } : {}),
  };
}

export const Route = createFileRoute('/dashboard/catalog')({
  validateSearch: (search: Record<string, unknown>): CatalogSearch =>
    validateCatalogSearch(search),
  component: CatalogPage,
});

function CatalogPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  const initial = useMemo(
    () =>
      catalogStateFromSearch({
        ...(search.tab ? { tab: search.tab } : {}),
        ...(search.category ? { category: search.category } : {}),
        ...(search.surfaceRevisionId
          ? { surfaceRevisionId: search.surfaceRevisionId }
          : {}),
        ...(search.returnKey ? { returnKey: search.returnKey } : {}),
        ...(search.q ? { q: search.q } : {}),
      }),
    // Only hydrate once from the entry URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [state, setState] = useState<CatalogUiState>(initial);

  const handleStateChange = (next: CatalogUiState) => {
    setState(next);
    // Keep URL in sync with allowlisted params only (no draft/prompt).
    const href = catalogStateToHref(next);
    const url = new URL(href, 'http://local.invalid');
    void navigate({
      to: '/dashboard/catalog',
      search: validateCatalogSearch(
        Object.fromEntries(url.searchParams.entries())
      ),
      replace: true,
    });
  };

  const handleBack = (_snapshot: CatalogReturnRestoreSnapshot) => {
    // Snapshot is available for the home host via history.state / returnKey.
    // Prefer browser back when history exists; otherwise go home.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: COMPOSER_HOME_PATH });
  };

  return (
    <main
      data-testid="dashboard-catalog-page"
      className="mx-auto flex h-[100dvh] max-w-3xl flex-col"
    >
      <FullscreenCatalogPanel
        state={state}
        onStateChange={handleStateChange}
        onBack={handleBack}
      />
    </main>
  );
}

// Re-export pure helpers for route tests without pulling the page.
export { catalogStateFromSearch, catalogStateToHref };
