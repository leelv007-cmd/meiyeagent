import { ObjectEvidence } from '@/components/uiux/object-evidence';
import { StatePanel } from '@/components/uiux/state-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { m } from '@/locale/paraglide/messages';
import { useProductState } from '@/product/client';
import type { Lead, LeadStatus } from '@meiye/contracts';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/leads_/$leadId')({
  component: LeadDetailRoute,
});

function leadStatusLabel(status: LeadStatus) {
  switch (status) {
    case 'new':
      return m.dashboard_lead_status_new();
    case 'contacted':
      return m.dashboard_lead_status_contacted();
    case 'booked':
      return m.dashboard_lead_status_booked();
    case 'redeemed':
      return m.dashboard_lead_status_redeemed();
    case 'lost':
      return m.dashboard_lead_status_lost();
    case 'invalid':
      return m.dashboard_lead_status_invalid();
  }
}

function leadSourceLabel(source: Lead['source']) {
  switch (source) {
    case 'direct_message':
      return m.dashboard_lead_source_direct_message();
    case 'comment':
      return m.dashboard_lead_source_comment();
    case 'wechat':
      return m.dashboard_lead_source_wechat();
    case 'booking':
      return m.dashboard_lead_source_booking();
    case 'coupon':
      return m.dashboard_lead_source_coupon();
    case 'redemption':
      return m.dashboard_lead_source_redemption();
    case 'visit':
      return m.dashboard_lead_source_visit();
  }
}

function LeadDetailRoute() {
  const { leadId } = Route.useParams();
  const product = useProductState();
  const lead = product.state?.leads.find((item) => item.id === leadId);
  const content = product.state?.contents.find(
    (item) => item.id === lead?.contentId
  );

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: m.product_navigation_leads(), isCurrentPage: false },
        { label: m.dashboard_lead_detail_title(), isCurrentPage: true },
      ]}
      description={m.dashboard_lead_detail_description()}
      title={m.dashboard_lead_detail_title()}
    >
      {product.loading ? (
        <StatePanel
          kind="loading"
          title={m.dashboard_lead_detail_loading_title()}
          description={m.dashboard_lead_detail_loading_description()}
        />
      ) : null}
      {!lead && !product.loading ? (
        <StatePanel
          kind="empty"
          title={m.dashboard_lead_detail_missing_title()}
          description={m.dashboard_lead_detail_missing_description()}
        />
      ) : null}
      {lead ? (
        <Card>
          <CardHeader>
            <ObjectEvidence
              id={lead.id}
              kind="Lead"
              source={m.dashboard_lead_detail_evidence_source()}
            />
            <CardTitle className="mt-3">
              {content?.variants[0]?.versions.find(
                (version) => version.id === lead.contentVersionId
              )?.title ?? m.dashboard_lead_detail_fallback_title()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {m.dashboard_lead_detail_status({
                status: leadStatusLabel(lead.status),
              })}
            </p>
            <p>
              {m.dashboard_lead_detail_linked_content({
                linked: content
                  ? m.common_table_bool_true()
                  : m.common_table_bool_false(),
              })}
            </p>
            <p>
              {m.dashboard_lead_detail_source({
                source: leadSourceLabel(lead.source),
              })}
            </p>
            <p>
              {m.dashboard_lead_detail_note({
                note: lead.note || m.dashboard_lead_no_note(),
              })}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </DashboardLayout>
  );
}
