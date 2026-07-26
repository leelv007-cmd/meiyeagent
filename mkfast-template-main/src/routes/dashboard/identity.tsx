import heroUiGlassCss from '@/components/heroui-pro/heroui-glass.css?url';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { buttonVariants } from '@heroui/react';
import { Routes } from '@/lib/routes';
import {
  product_navigation_identity,
  product_navigation_workspace,
} from '@/locale/paraglide/messages';
import { MarketingIdentityPage } from '@/product/marketing-identity-page';
import { createFileRoute, Link } from '@tanstack/react-router';

/**
 * Identity page — T33 / #227. Thin wrapper; the surface lives in product/.
 */
export const Route = createFileRoute('/dashboard/identity')({
  head: () => ({ links: [{ rel: 'stylesheet', href: heroUiGlassCss }] }),
  component: MarketingIdentityRoute,
});

function MarketingIdentityRoute() {
  return (
    <>
      <DashboardHeader
        actions={
          <Link
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
            to={Routes.ContentWorkspace}
          >
            {product_navigation_workspace()}
          </Link>
        }
        breadcrumbs={[
          { label: product_navigation_identity(), isCurrentPage: true },
        ]}
      />
      <main className="meiye-heroui-glass mx-auto w-full max-w-4xl flex-1 p-4 lg:p-6">
        <div className="meiye-ambient-copy mb-6">
          <h1 className="meiye-type-title">{product_navigation_identity()}</h1>
        </div>
        <MarketingIdentityPage />
      </main>
    </>
  );
}
