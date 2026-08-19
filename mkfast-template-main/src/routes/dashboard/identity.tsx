import { DashboardHeader } from '@/components/layout/dashboard-header';
import { product_navigation_identity } from '@/locale/paraglide/messages';
import { MarketingIdentityPage } from '@/product/marketing-identity-page';
import { createFileRoute } from '@tanstack/react-router';

/**
 * Identity page — T33 / #227. Thin wrapper; the surface lives in product/.
 */
export const Route = createFileRoute('/dashboard/identity')({
  component: MarketingIdentityRoute,
});

function MarketingIdentityRoute() {
  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: product_navigation_identity(), isCurrentPage: true },
        ]}
      />
      <main className="mx-auto w-full max-w-4xl flex-1 p-4 lg:p-6">
        <div className="meiye-ambient-copy mb-6">
          <h1 className="meiye-type-title" data-testid="identity-ambient-title">
            {product_navigation_identity()}
          </h1>
        </div>
        <MarketingIdentityPage />
      </main>
    </>
  );
}
