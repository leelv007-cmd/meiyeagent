import { ObjectEvidence } from '@/components/uiux/object-evidence';
import { StatePanel } from '@/components/uiux/state-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import type { Lead, LeadStatus } from '@meiye/contracts';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/leads_/$leadId')({
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
      {product.loading ? (
        <StatePanel
          kind="loading"
          title={dashboard_lead_detail_loading_title()}
          description={dashboard_lead_detail_loading_description()}
        />
      ) : null}
      {!lead && !product.loading ? (
        <StatePanel
          kind="empty"
          title={dashboard_lead_detail_missing_title()}
          description={dashboard_lead_detail_missing_description()}
        />
      ) : null}
      {lead ? (
        <Card>
          <CardHeader>
            <ObjectEvidence
              id={lead.id}
              kind="Lead"
              source={dashboard_lead_detail_evidence_source()}
            />
            <CardTitle className="mt-3">
              {content?.variants[0]?.versions.find(
                (version) => version.id === lead.contentVersionId
              )?.title ?? dashboard_lead_detail_fallback_title()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {dashboard_lead_detail_status({
                status: leadStatusLabel(lead.status),
              })}
            </p>
            <p>
              {dashboard_lead_detail_linked_content({
                linked: content
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
          </CardContent>
        </Card>
      ) : null}
    </DashboardLayout>
  );
}
