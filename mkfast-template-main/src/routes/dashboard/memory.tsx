import { DashboardHeader } from '@/components/layout/dashboard-header';
import {
  memory_page_title,
  product_navigation_memory,
} from '@/locale/paraglide/messages';
import { MemoryVaultPage } from '@/product/memory-vault-page';
import { createFileRoute } from '@tanstack/react-router';

/**
 * 记忆 — D-164④. Thin wrapper; the surface lives in product/, same shape as
 * the identity route next door.
 */
export const Route = createFileRoute('/dashboard/memory')({
  component: MemoryVaultRoute,
});

function MemoryVaultRoute() {
  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: product_navigation_memory(), isCurrentPage: true },
        ]}
      />
      <main className="mx-auto w-full max-w-4xl flex-1 p-4 lg:p-6">
        <div className="meiye-ambient-copy mb-6">
          <h1 className="meiye-type-title" data-testid="memory-ambient-title">
            {memory_page_title()}
          </h1>
        </div>
        <MemoryVaultPage />
      </main>
    </>
  );
}
