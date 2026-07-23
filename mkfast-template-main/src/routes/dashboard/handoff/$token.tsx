/**
 * Mobile handoff page — `/dashboard/handoff/$token` (D-086 / #101).
 *
 * Four-section paradigm (share / download / copy / report) preserved.
 * Data source is canonical delivery only — legacy handoffPackages retired.
 */

import { DashboardHeader } from '@/components/layout/dashboard-header';
import { Skeleton } from '@/components/ui/skeleton';
import { dashboard_content_mobile_handoff } from '@/locale/paraglide/messages';
import { CanonicalHandoffPage } from '@/product/results/canonical-handoff-page';
import {
  loadCanonicalHandoff,
  reportCanonicalHandoff,
  shareCanonicalHandoff,
} from '@/product/results/delivery-handoff-live';
import { commandP1 } from '@/p1/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/handoff/$token')({
  component: MobileHandoffPage,
});

function MobileHandoffPage() {
  const { token } = Route.useParams();
  const queryClient = useQueryClient();
  const queryKey = ['result-delivery', 'canonical-handoff', token] as const;
  const handoff = useQuery({
    queryKey,
    queryFn: () =>
      loadCanonicalHandoff(
        token,
        (action, payload) => commandP1('result-delivery', { action, payload }),
        {
          nowIso: new Date().toISOString(),
          origin: window.location.origin,
          canShareFiles: typeof navigator.canShare === 'function',
        }
      ),
    retry: false,
  });

  if (handoff.isPending) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const resolve = handoff.data?.resolve ?? { kind: 'not_found' as const };

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          {
            label: dashboard_content_mobile_handoff(),
            isCurrentPage: true,
          },
        ]}
      />
      <CanonicalHandoffPage
        resolve={resolve}
        onUnavailableRecovery={() => {
          window.location.assign('/dashboard');
        }}
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
          const source = handoff.data?.serverRecord;
          if (!source) return 'failed';
          return shareCanonicalHandoff(source, {
            canShare: (payload) =>
              typeof navigator.canShare === 'function' &&
              navigator.canShare(payload),
            download: (href) => {
              const anchor = document.createElement('a');
              anchor.href = href;
              anchor.download = '';
              anchor.click();
            },
            fetchFile: async (media) => {
              const response = await fetch(media.downloadUrl, {
                credentials: 'same-origin',
              });
              if (!response.ok) throw new Error('Handoff media fetch failed.');
              return new File([await response.blob()], media.id, {
                type: media.contentType,
              });
            },
            origin: window.location.origin,
            share:
              typeof navigator.share === 'function'
                ? (payload) => navigator.share(payload)
                : undefined,
          });
        }}
        onReport={async (input) => {
          const receiptRevision = handoff.data?.receiptRevision;
          if (receiptRevision === undefined || resolve.kind !== 'ready') {
            throw new Error('Canonical handoff receipt is unavailable.');
          }
          await reportCanonicalHandoff(
            {
              ...input,
              receiptId: resolve.assistedReceiptId,
              receiptRevision,
              recordedAt: new Date().toISOString(),
            },
            (action, payload) =>
              commandP1('result-delivery', { action, payload })
          );
          await queryClient.invalidateQueries({ queryKey });
        }}
      />
    </>
  );
}
