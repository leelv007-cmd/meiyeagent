/** Fullscreen live creation catalog route (C3 / #97). */

import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { CatalogLivePage } from '@/product/composer/catalog-live-page';
import {
  type CatalogSearch,
  validateCatalogSearch,
} from '@/product/composer/catalog-route-model';
import { catalogStateToHref } from '@/product/composer/fullscreen-catalog';
import { COMPOSER_HOME_PATH } from '@/product/composer/composer-nav';

export const Route = createFileRoute('/dashboard/catalog')({
  validateSearch: (search: Record<string, unknown>): CatalogSearch =>
    validateCatalogSearch(search),
  component: CatalogPage,
});

function CatalogPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  return (
    <main
      data-testid="dashboard-catalog-page"
      className="mx-auto flex h-[100dvh] max-w-3xl flex-col"
    >
      <CatalogLivePage
        search={search}
        onReplaceState={(state) => {
          const url = new URL(
            catalogStateToHref(state),
            'http://local.invalid'
          );
          void navigate({
            to: '/dashboard/catalog',
            search: validateCatalogSearch(
              Object.fromEntries(url.searchParams.entries())
            ),
            replace: true,
          });
        }}
        onSelectRecipe={(selection) => {
          void navigate({
            to: '/dashboard',
            search: {
              catalogRecipeRevisionId: selection.recipeRevisionId,
              catalogSurfaceRevisionId: selection.surfaceRevisionId,
            },
          });
        }}
        onNavigateHref={(href) => window.location.assign(href)}
        onBack={() => {
          if (window.history.length > 1) {
            window.history.back();
            return;
          }
          void navigate({ to: COMPOSER_HOME_PATH });
        }}
      />
    </main>
  );
}

export { validateCatalogSearch } from '@/product/composer/catalog-route-model';
