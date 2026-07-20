/**
 * Mobile handoff page — `/dashboard/handoff/$token` (D-086 / #101).
 *
 * Four-section paradigm (share / download / copy / report) preserved.
 * Data source is canonical delivery only — legacy handoffPackages retired.
 */

import { DashboardHeader } from '@/components/layout/dashboard-header';
import { Skeleton } from '@/components/ui/skeleton';
import { CanonicalHandoffPage } from '@/product/results/canonical-handoff-page';
import {
  resolveCanonicalHandoffByToken,
  type CanonicalDeliveryHandoff,
} from '@/product/results/delivery-handoff-canonical';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';

export const Route = createFileRoute('/dashboard/handoff/$token')({
  component: MobileHandoffPage,
});

/**
 * Canonical delivery handoff index for this page.
 * Production wiring supplies assisted-receipt-backed records.
 * Legacy ProductState.handoffPackages is intentionally NOT read.
 */
function useCanonicalHandoffIndex(): readonly CanonicalDeliveryHandoff[] {
  // Integration port: empty until product state exposes canonical delivery.
  // Page fails closed (unavailable) rather than falling back to legacy.
  return useMemo(() => [], []);
}

function MobileHandoffPage() {
  const { token } = Route.useParams();
  const index = useCanonicalHandoffIndex();
  // Loading skeleton kept for future async index fetch.
  const loading = false;

  const resolve = useMemo(
    () =>
      resolveCanonicalHandoffByToken(token, index, {
        nowIso: new Date().toISOString(),
        canShareFiles: false,
      }),
    [token, index],
  );

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          {
            label: '交接包',
            isCurrentPage: true,
          },
        ]}
      />
      <CanonicalHandoffPage
        resolve={resolve}
        onCopy={async (_fieldId, value) => {
          try {
            await navigator.clipboard.writeText(value);
          } catch {
            // Clipboard may be unavailable outside secure context.
          }
        }}
        onDownload={() => {
          // Browser download via anchor href; outcome recorded in page state.
        }}
        onShare={async () => {
          if (!navigator.share) return 'unsupported';
          if (resolve.kind !== 'ready') return 'failed';
          try {
            await navigator.share({
              title: resolve.heading,
              url: resolve.sections.share.shareUrl,
            });
            return 'shared';
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              return 'cancelled';
            }
            return 'failed';
          }
        }}
      />
    </>
  );
}
