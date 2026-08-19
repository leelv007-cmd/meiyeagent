import { DashboardHeader } from '@/components/layout/dashboard-header';
import { buttonVariants } from '@heroui/react';
import { Routes } from '@/lib/routes';
import {
  product_navigation_identity,
  product_navigation_workspace,
} from '@/locale/paraglide/messages';
import { WorkspaceAssetsPage } from '@/product/workspace-assets-page';
import { createFileRoute, Link } from '@tanstack/react-router';

/**
 * Historical workspace shell (RET-04A). Not an active merchant entry.
 * Store / identity / palette no longer produce this path. Old URLs still render.
 */
export const Route = createFileRoute('/dashboard/workspace')({
  component: ContentWorkspaceRoute,
});

function ContentWorkspaceRoute() {
  return (
    <>
      <DashboardHeader
        actions={
          <Link
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
            to={Routes.MarketingIdentity}
          >
            {product_navigation_identity()}
          </Link>
        }
        breadcrumbs={[
          { label: product_navigation_workspace(), isCurrentPage: true },
        ]}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 lg:p-6">
        <div className="meiye-ambient-copy mb-6">
          <h1 className="meiye-type-title">{product_navigation_workspace()}</h1>
        </div>
        <WorkspaceAssetsPage />
      </main>
    </>
  );
}
