import heroUiGlassCss from '@/components/heroui-pro/heroui-glass.css?url';
import { useQuery } from '@tanstack/react-query';
import { ObjectEvidence } from '@/components/uiux/object-evidence';
import { EmptyState, Widget } from '@/components/heroui-pro';
import { Skeleton } from '@heroui/react';
import type { CSSProperties } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import {
  common_table_bool_false,
  common_table_bool_true,
  dashboard_lead_detail_description,
  dashboard_lead_detail_evidence_source,
  dashboard_lead_detail_fallback_title,
  dashboard_lead_detail_linked_content,
  dashboard_lead_detail_loading_description,
  dashboard_lead_detail_loading_title,
  dashboard_lead_detail_missing_description,
  dashboard_lead_detail_missing_title,
  dashboard_lead_detail_note,
  dashboard_lead_detail_source,
  dashboard_lead_detail_status,
  dashboard_lead_detail_title,
  dashboard_lead_no_note,
  dashboard_lead_source_booking,
  dashboard_lead_source_comment,
  dashboard_lead_source_coupon,
  dashboard_lead_source_direct_message,
  dashboard_lead_source_redemption,
  dashboard_lead_source_visit,
  dashboard_lead_source_wechat,
  dashboard_lead_status_booked,
  dashboard_lead_status_contacted,
  dashboard_lead_status_invalid,
  dashboard_lead_status_lost,
  dashboard_lead_status_new,
  dashboard_lead_status_redeemed,
  product_navigation_leads,
} from '@/locale/paraglide/messages';
import { useProductState } from '@/product/client';
import { operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import type { Lead, LeadStatus, PublicContentPackage } from '@meiye/contracts';
import { IconFolderOff } from '@tabler/icons-react';
import { createFileRoute } from '@tanstack/react-router';

/**
 * Lead detail — T33 / #227 reshell along the Composer trunk.
 *
 * Same facts as before the reshell (evidence, status, linked content, source,
 * note); only the shell moves to HeroUI Pro V3 on the Glass sheet.
 */
export const Route = createFileRoute('/dashboard/leads_/$leadId')({
  head: () => ({ links: [{ rel: 'stylesheet', href: heroUiGlassCss }] }),
  component: LeadDetailRoute,
});

function leadStatusLabel(status: LeadStatus) {
  switch (status) {
    case 'new':
      return dashboard_lead_status_new();
    case 'contacted':
      return dashboard_lead_status_contacted();
    case 'booked':
      return dashboard_lead_status_booked();
    case 'redeemed':
      return dashboard_lead_status_redeemed();
    case 'lost':
      return dashboard_lead_status_lost();
    case 'invalid':
      return dashboard_lead_status_invalid();
  }
}

function leadSourceLabel(source: Lead['source']) {
  switch (source) {
    case 'direct_message':
      return dashboard_lead_source_direct_message();
    case 'comment':
      return dashboard_lead_source_comment();
    case 'wechat':
      return dashboard_lead_source_wechat();
    case 'booking':
      return dashboard_lead_source_booking();
    case 'coupon':
      return dashboard_lead_source_coupon();
    case 'redemption':
      return dashboard_lead_source_redemption();
    case 'visit':
      return dashboard_lead_source_visit();
  }
}

function LeadDetailRoute() {
  const { leadId } = Route.useParams();
  const product = useProductState();
  const lead = product.state?.leads.find((item) => item.id === leadId);
  const contentPackages = useQuery({
    queryKey: p1QueryKeys.request('operations', 'content_packages'),
    queryFn: ({ signal }) =>
      operationsQuery<PublicContentPackage[]>('content_packages', {}, signal),
    retry: false,
  });
  const canonicalContent = contentPackages.data?.find(
    (item) => item.id === lead?.canonicalContentPackage?.packageId
  );
  const canonicalVersion = canonicalContent?.versions.find(
    (version) => version.id === lead?.canonicalContentPackage?.versionId
  );
  const content = product.state?.contents.find(
    (item) => item.id === lead?.contentId
  );

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: product_navigation_leads(), isCurrentPage: false },
        { label: dashboard_lead_detail_title(), isCurrentPage: true },
      ]}
      description={dashboard_lead_detail_description()}
      title={dashboard_lead_detail_title()}
    >
      <div className="meiye-heroui-glass">
        {product.loading ? (
          <section
            aria-busy="true"
            aria-live="polite"
            className="meiye-porcelain space-y-3 rounded-2xl p-6"
          >
            <p className="text-foreground font-medium">
              {dashboard_lead_detail_loading_title()}
            </p>
            <p className="text-muted text-sm">
              {dashboard_lead_detail_loading_description()}
            </p>
            <Skeleton className="h-24 rounded-xl" />
          </section>
        ) : null}
        {!lead && !product.loading ? (
          /* The porcelain base is already here, but the description still
              takes `color: var(--muted)` from the vendored empty-state.css,
              and inside .meiye-product-shell that token is the muted
              *background* (4% ink / 6% white) — measured 1.06:1 even on
              porcelain. Same trap as OI-73; mapped back onto the ink gradient.
              Per-site on purpose: the shared-layer fix is OI-48. */
          <EmptyState
            className="meiye-porcelain rounded-2xl"
            style={{ '--muted': 'var(--ink-60)' } as CSSProperties}
          >
            <EmptyState.Header>
              <EmptyState.Media variant="icon">
                <IconFolderOff className="size-6" />
              </EmptyState.Media>
              <EmptyState.Title data-testid="lead-detail-missing-title">
                {dashboard_lead_detail_missing_title()}
              </EmptyState.Title>
              <EmptyState.Description data-testid="lead-detail-missing-description">
                {dashboard_lead_detail_missing_description()}
              </EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        ) : null}
        {lead ? (
          <Widget className="meiye-porcelain">
            <Widget.Header className="flex-col items-start gap-3">
              <ObjectEvidence
                id={lead.id}
                kind="Lead"
                source={dashboard_lead_detail_evidence_source()}
              />
              <Widget.Title className="text-base">
                {canonicalVersion?.title ??
                  content?.variants[0]?.versions.find(
                    (version) => version.id === lead.contentVersionId
                  )?.title ??
                  dashboard_lead_detail_fallback_title()}
              </Widget.Title>
            </Widget.Header>
            <Widget.Content className="space-y-2 text-sm">
              <p>
                {dashboard_lead_detail_status({
                  status: leadStatusLabel(lead.status),
                })}
              </p>
              <p>
                {dashboard_lead_detail_linked_content({
                  linked:
                    content || canonicalContent
                      ? common_table_bool_true()
                      : common_table_bool_false(),
                })}
              </p>
              <p>
                {dashboard_lead_detail_source({
                  source: leadSourceLabel(lead.source),
                })}
              </p>
              <p>
                {dashboard_lead_detail_note({
                  note: lead.note || dashboard_lead_no_note(),
                })}
              </p>
            </Widget.Content>
          </Widget>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
