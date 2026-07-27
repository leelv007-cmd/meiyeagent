import { useQuery } from '@tanstack/react-query';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { EmptyState, Widget } from '@/components/heroui-pro';
import {
  Alert,
  Button,
  buttonVariants,
  Input,
  Label,
  ListBox,
  Select,
  Skeleton,
  TextArea,
  TextField,
} from '@heroui/react';
import {
  account_usage_retry,
  dashboard_lead_amount_label,
  dashboard_lead_content_label,
  dashboard_lead_description,
  dashboard_lead_empty,
  dashboard_lead_insight_placeholder,
  dashboard_lead_insights_title,
  dashboard_lead_intent_amount,
  dashboard_lead_linked_content,
  dashboard_lead_manual_record,
  dashboard_lead_new_title,
  dashboard_lead_no_note,
  dashboard_lead_note_label,
  dashboard_lead_progress_title,
  dashboard_lead_record,
  dashboard_lead_save_insight,
  dashboard_lead_source_summary,
  dashboard_lead_status_booked,
  dashboard_lead_status_contacted,
  dashboard_lead_status_invalid,
  dashboard_lead_status_lost,
  dashboard_lead_status_new,
  dashboard_lead_status_redeemed,
  dashboard_lead_untitled_content,
  dashboard_lead_update_status_aria,
  dashboard_lead_view_details,
  lead_ledger_attribution_notice,
  lead_ledger_empty_create_action,
  lead_ledger_empty_description,
  lead_ledger_empty_record_action,
  leads_operation_failed_description,
  product_client_command_failed,
  product_navigation_leads,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import { operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { useProductState } from '@/product/client';
import { leadStatusToneClassName } from '@/product/lead-status-tone';
import type {
  LeadStatus,
  ProductCommand,
  PublicContentPackage,
} from '@meiye/contracts';
import {
  IconAlertTriangle,
  IconBulb,
  IconCheck,
  IconMessages,
  IconPlus,
  IconRefresh,
} from '@tabler/icons-react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Lead ledger — T33 / #227 reshell along the Composer trunk.
 *
 * Story 60 scope: the ledger keeps exactly the capabilities it had (view,
 * manual record, status follow-up, insight notes). Nothing is added — this
 * ticket only swaps the self-built shadcn old-IA shell for HeroUI Pro V3 on
 * the Glass sheet, which rides a route-level <link> the way /dashboard does.
 */
export const Route = createFileRoute('/dashboard/leads')({
  component: LeadLedgerPage,
});

const statusOrder: LeadStatus[] = [
  'new',
  'contacted',
  'booked',
  'redeemed',
  'lost',
  'invalid',
];

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

function publishedContentPackage(contentPackage: PublicContentPackage) {
  return (
    contentPackage.status === 'accepted' &&
    Boolean(contentPackage.currentVersionId) &&
    (contentPackage.deliveryEvents ?? []).some(
      (event) =>
        (event.type === 'automatic_publish_result' &&
          event.status === 'published') ||
        (event.type === 'manual_publish_result' &&
          event.status === 'published') ||
        (event.type === 'legacy_handoff_event' &&
          event.operation === 'published')
    )
  );
}

function contentPackageTitle(contentPackage: PublicContentPackage) {
  return (
    contentPackage.versions.find(
      (version) => version.id === contentPackage.currentVersionId
    )?.title ?? dashboard_lead_untitled_content()
  );
}

function LeadLedgerPage() {
  const { state, error, loading, pending, execute, refresh } =
    useProductState();
  const contentPackages = useQuery({
    queryKey: p1QueryKeys.request('operations', 'content_packages'),
    queryFn: ({ signal }) =>
      operationsQuery<PublicContentPackage[]>('content_packages', {}, signal),
    retry: false,
  });
  const [contentId, setContentId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [insight, setInsight] = useState('');

  useEffect(() => {
    const firstPublished = contentPackages.data?.find(publishedContentPackage);
    if (!contentId && firstPublished) setContentId(firstPublished.id);
  }, [contentId, contentPackages.data]);

  async function run(command: ProductCommand) {
    try {
      await execute(command);
    } catch {
      // Shared error surface renders the server response.
    }
  }

  async function createLead() {
    const contentPackage = contentPackages.data?.find(
      (item) => item.id === contentId && publishedContentPackage(item)
    );
    if (!contentPackage) return;
    await run({
      type: 'create_lead',
      packageId: contentPackage.id,
      lead: {
        source: 'direct_message',
        amountCents: amount ? Math.round(Number(amount) * 100) : undefined,
        note: note || undefined,
      },
    });
    setAmount('');
    setNote('');
  }

  if (loading || !state) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const publishedContents = (contentPackages.data ?? []).filter(
    publishedContentPackage
  );

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: product_navigation_leads(), isCurrentPage: true },
        ]}
        actions={
          <span className="meiye-glass-piece text-muted rounded-full px-3 py-1 text-xs">
            {dashboard_lead_manual_record()}
          </span>
        }
      />
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">
        <div className="meiye-ambient-copy mb-6">
          <h1 className="meiye-type-title" data-testid="leads-ambient-title">
            {product_navigation_leads()}
          </h1>
          <p className="meiye-type-aux mt-1" data-testid="leads-ambient-aux">
            {dashboard_lead_description()}
          </p>
        </div>

        {error && (
          <Alert className="mb-4" status="danger">
            <Alert.Indicator>
              <IconAlertTriangle className="size-4" />
            </Alert.Indicator>
            <Alert.Content>
              <Alert.Title>{product_client_command_failed()}</Alert.Title>
              <Alert.Description className="flex flex-wrap items-center justify-between gap-3">
                {leads_operation_failed_description()}
                <Button
                  onPress={() => void refresh()}
                  size="sm"
                  variant="outline"
                >
                  <IconRefresh className="size-4" />
                  {account_usage_retry()}
                </Button>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Widget className="meiye-porcelain min-w-0">
            <Widget.Header>
              <Widget.Title>{dashboard_lead_progress_title()}</Widget.Title>
              <span className="meiye-glass-trace text-muted rounded-full px-2.5 py-0.5 text-xs">
                {state.leads.length}
              </span>
            </Widget.Header>
            <Widget.Content>
              {state.leads.length === 0 ? (
                /* HeroUI's vendored empty-state.css paints the description with
                    `color: var(--muted)`, but inside .meiye-product-shell that
                    token is the muted *background* (--tint-hover, 4% ink / 6%
                    white) — measured 1.06:1, i.e. the line is invisible. Same
                    trap as OI-73 on the works surface; mapped back onto the ink
                    gradient here. Per-site on purpose: the shared-layer fix is
                    OI-48. */
                <EmptyState
                  style={{ '--muted': 'var(--ink-60)' } as CSSProperties}
                >
                  <EmptyState.Header>
                    <EmptyState.Media variant="icon">
                      <IconMessages className="size-6" />
                    </EmptyState.Media>
                    <EmptyState.Title data-testid="leads-empty-title">
                      {dashboard_lead_empty()}
                    </EmptyState.Title>
                    <EmptyState.Description data-testid="leads-empty-description">
                      {lead_ledger_empty_description()}
                    </EmptyState.Description>
                  </EmptyState.Header>
                  <EmptyState.Content>
                    {publishedContents.length > 0 ? (
                      <Button
                        onPress={() =>
                          document.getElementById('lead-note')?.focus()
                        }
                        variant="outline"
                      >
                        {lead_ledger_empty_record_action()}
                      </Button>
                    ) : (
                      <Link
                        className={buttonVariants({ variant: 'primary' })}
                        to={Routes.Dashboard}
                      >
                        {lead_ledger_empty_create_action()}
                      </Link>
                    )}
                  </EmptyState.Content>
                </EmptyState>
              ) : (
                <ul className="divide-divider divide-y">
                  {state.leads.map((lead) => {
                    const canonicalContent = contentPackages.data?.find(
                      (item) =>
                        item.id === lead.canonicalContentPackage?.packageId
                    );
                    const content = state.contents.find(
                      (item) => item.id === lead.contentId
                    );
                    const version = content?.variants[0]?.versions.find(
                      (item) => item.id === lead.contentVersionId
                    );
                    return (
                      <li className="py-4 first:pt-0 last:pb-0" key={lead.id}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-foreground truncate font-medium">
                              {(canonicalContent
                                ? contentPackageTitle(canonicalContent)
                                : version?.title) ??
                                dashboard_lead_linked_content()}
                            </p>
                            <p className="text-muted mt-1 text-xs">
                              {dashboard_lead_source_summary({
                                date: formatLocaleDateTime(lead.createdAt),
                              })}
                            </p>
                          </div>
                          <span
                            className={leadStatusToneClassName(lead.status)}
                          >
                            {leadStatusLabel(lead.status)}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                          <div className="min-w-0 flex-1 text-sm">
                            <p className="text-foreground">
                              {lead.note || dashboard_lead_no_note()}
                            </p>
                            {lead.amountCents ? (
                              <p className="text-muted mt-1">
                                {dashboard_lead_intent_amount({
                                  amount: (lead.amountCents / 100).toFixed(0),
                                })}
                              </p>
                            ) : null}
                          </div>
                          <Link
                            className={buttonVariants({
                              size: 'sm',
                              variant: 'outline',
                            })}
                            params={{ leadId: lead.id }}
                            to="/dashboard/leads/$leadId"
                          >
                            {dashboard_lead_view_details()}
                          </Link>
                          <Select
                            isDisabled={pending}
                            onSelectionChange={(key) =>
                              void run({
                                type: 'update_lead',
                                leadId: lead.id,
                                status: key as LeadStatus,
                              })
                            }
                            selectedKey={lead.status}
                          >
                            {/* A real label, not aria-label: React Aria points
                                the trigger's aria-labelledby at the label and
                                the current value, which would otherwise leave
                                the control named after its own value. */}
                            <Label className="sr-only">
                              {dashboard_lead_update_status_aria()}
                            </Label>
                            <Select.Trigger className="sm:w-36">
                              <Select.Value />
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                {statusOrder.map((status) => (
                                  <ListBox.Item id={status} key={status}>
                                    {leadStatusLabel(status)}
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Widget.Content>
          </Widget>

          <aside className="space-y-6">
            <Widget className="meiye-porcelain">
              <Widget.Header>
                <Widget.Title>{dashboard_lead_new_title()}</Widget.Title>
              </Widget.Header>
              <Widget.Content className="space-y-4">
                <Select
                  onSelectionChange={(key) => setContentId(String(key))}
                  selectedKey={contentId || null}
                >
                  <Label>{dashboard_lead_content_label()}</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {publishedContents.map((content) => (
                        <ListBox.Item id={content.id} key={content.id}>
                          {contentPackageTitle(content)}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <p
                  className="text-muted text-xs leading-5"
                  data-testid="lead-ledger-attribution-notice"
                >
                  {lead_ledger_attribution_notice()}
                </p>
                <TextField onChange={setAmount} value={amount}>
                  <Label>{dashboard_lead_amount_label()}</Label>
                  <Input inputMode="decimal" />
                </TextField>
                <TextField onChange={setNote} value={note}>
                  <Label>{dashboard_lead_note_label()}</Label>
                  <TextArea id="lead-note" rows={3} />
                </TextField>
                <Button
                  className="w-full"
                  isDisabled={pending || !contentId}
                  onPress={() => void createLead()}
                  variant={contentId ? 'primary' : 'outline'}
                >
                  <IconPlus className="size-4" />
                  {dashboard_lead_record()}
                </Button>
              </Widget.Content>
            </Widget>

            <Widget className="meiye-porcelain">
              <Widget.Header>
                <Widget.Title className="flex items-center gap-2">
                  <IconBulb className="size-4" />
                  {dashboard_lead_insights_title()}
                </Widget.Title>
              </Widget.Header>
              <Widget.Content className="space-y-4">
                <TextField
                  aria-label={dashboard_lead_insights_title()}
                  onChange={setInsight}
                  value={insight}
                >
                  <TextArea
                    placeholder={dashboard_lead_insight_placeholder()}
                    rows={3}
                  />
                </TextField>
                <Button
                  className="w-full"
                  isDisabled={pending || !insight.trim()}
                  onPress={() => {
                    void run({
                      type: 'record_insight',
                      kind: 'next_action',
                      note: insight,
                    });
                    setInsight('');
                  }}
                  variant="outline"
                >
                  <IconCheck className="size-4" />
                  {dashboard_lead_save_insight()}
                </Button>
                {state.insights
                  .slice(-3)
                  .reverse()
                  .map((item) => (
                    <p
                      className="border-divider text-muted border-l-2 pl-3 text-sm leading-6"
                      key={item.id}
                    >
                      {item.note}
                    </p>
                  ))}
              </Widget.Content>
            </Widget>
          </aside>
        </div>
      </main>
    </>
  );
}
