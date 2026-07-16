import { DashboardHeader } from '@/components/layout/dashboard-header';
import { WarmEmptyState } from '@/components/uiux/warm-empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { m } from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';
import { useProductState } from '@/product/client';
import type { LeadStatus, ProductCommand } from '@meiye/contracts';
import {
  IconAlertTriangle,
  IconBulb,
  IconCheck,
  IconMessages,
  IconPlus,
  IconRefresh,
} from '@tabler/icons-react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

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

function LeadLedgerPage() {
  const { state, error, loading, pending, execute, refresh } =
    useProductState();
  const [contentId, setContentId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [insight, setInsight] = useState('');

  useEffect(() => {
    const firstPublished = state?.contents.find(
      (item) => item.status === 'published'
    );
    if (!contentId && firstPublished) setContentId(firstPublished.id);
  }, [contentId, state?.contents]);

  async function run(command: ProductCommand) {
    try {
      await execute(command);
    } catch {
      // Shared error surface renders the server response.
    }
  }

  async function createLead() {
    const content = state?.contents.find((item) => item.id === contentId);
    if (!content) return;
    await run({
      type: 'create_lead',
      contentId,
      lead: {
        source: 'direct_message',
        projectId: content.projectId,
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
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const hasPublishedContent = state.contents.some(
    (item) => item.status === 'published'
  );

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: m.product_navigation_leads(), isCurrentPage: true },
        ]}
        actions={
          <Badge variant="outline">{m.dashboard_lead_manual_record()}</Badge>
        }
      />
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">
        <div className="mb-6">
          <h1 className="meiye-type-title">{m.product_navigation_leads()}</h1>
          <p className="meiye-type-aux mt-1">
            {m.dashboard_lead_description()}
          </p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <IconAlertTriangle />
            <AlertTitle>{m.product_client_command_failed()}</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3">
              {m.leads_operation_failed_description()}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
              >
                <IconRefresh />
                {m.account_usage_retry()}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="meiye-type-body font-semibold">
                {m.dashboard_lead_progress_title()}
              </h2>
              <Badge variant="secondary">{state.leads.length}</Badge>
            </div>
            {state.leads.length === 0 ? (
              <WarmEmptyState
                action={
                  hasPublishedContent ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        document.getElementById('lead-content')?.focus()
                      }
                    >
                      {m.lead_ledger_empty_record_action()}
                    </Button>
                  ) : (
                    <a
                      className={buttonVariants({
                        variant: !contentId ? 'default' : 'outline',
                      })}
                      href={getPathWithLocale(Routes.Dashboard)}
                    >
                      {m.lead_ledger_empty_create_action()}
                    </a>
                  )
                }
                description={m.lead_ledger_empty_description()}
                media={<IconMessages />}
                title={m.dashboard_lead_empty()}
              />
            ) : (
              <div className="divide-y divide-divider overflow-hidden rounded-xl bg-surface-1">
                {state.leads.map((lead) => {
                  const content = state.contents.find(
                    (item) => item.id === lead.contentId
                  );
                  const variant = content?.variants[0];
                  const version = variant?.versions.find(
                    (item) => item.id === lead.contentVersionId
                  );
                  return (
                    <Card
                      key={lead.id}
                      className="rounded-none bg-transparent shadow-none"
                    >
                      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <CardTitle className="truncate text-base">
                            {version?.title ??
                              m.dashboard_lead_linked_content()}
                          </CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {m.dashboard_lead_source_summary({
                              date: formatLocaleDateTime(lead.createdAt),
                            })}
                          </p>
                        </div>
                        <Badge>{leadStatusLabel(lead.status)}</Badge>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        <div className="meiye-type-body min-w-0 flex-1">
                          <p>{lead.note || m.dashboard_lead_no_note()}</p>
                          {lead.amountCents ? (
                            <p className="mt-1 text-muted-foreground">
                              {m.dashboard_lead_intent_amount({
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
                          to="/dashboard/leads/$leadId"
                          params={{ leadId: lead.id }}
                        >
                          {m.dashboard_lead_view_details()}
                        </Link>
                        <select
                          aria-label={m.dashboard_lead_update_status_aria()}
                          className="h-touch-target rounded-md border border-divider bg-surface-1 px-3 text-sm outline-none transition-colors enabled:hover:bg-surface-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
                          disabled={pending}
                          value={lead.status}
                          onChange={(event) =>
                            void run({
                              type: 'update_lead',
                              leadId: lead.id,
                              status: event.target.value as LeadStatus,
                            })
                          }
                        >
                          {statusOrder.map((status) => (
                            <option key={status} value={status}>
                              {leadStatusLabel(status)}
                            </option>
                          ))}
                        </select>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <section className="space-y-4 rounded-xl bg-surface-1 p-4">
              <h2 className="meiye-type-body font-semibold">
                {m.dashboard_lead_new_title()}
              </h2>
              <div>
                <Label htmlFor="lead-content">
                  {m.dashboard_lead_content_label()}
                </Label>
                <select
                  id="lead-content"
                  className="mt-2 h-touch-target w-full rounded-lg border border-divider bg-surface-1 px-2.5 text-sm outline-none transition-colors enabled:hover:bg-surface-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
                  value={contentId}
                  onChange={(event) => setContentId(event.target.value)}
                >
                  {state.contents
                    .filter((item) => item.status === 'published')
                    .map((content) => (
                      <option key={content.id} value={content.id}>
                        {content.variants[0]?.versions[0]?.title ??
                          m.dashboard_lead_untitled_content()}
                      </option>
                    ))}
                </select>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {m.lead_ledger_attribution_notice()}
                </p>
              </div>
              <div>
                <Label htmlFor="lead-amount">
                  {m.dashboard_lead_amount_label()}
                </Label>
                <Input
                  id="lead-amount"
                  className="mt-2"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lead-note">
                  {m.dashboard_lead_note_label()}
                </Label>
                <Textarea
                  id="lead-note"
                  className="mt-2"
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              <Button
                className="w-full disabled:bg-surface-0 disabled:text-muted-foreground disabled:opacity-60"
                disabled={pending || !contentId}
                onClick={() => void createLead()}
                variant={!contentId ? 'outline' : 'default'}
              >
                <IconPlus />
                {m.dashboard_lead_record()}
              </Button>
            </section>

            <section className="space-y-4 rounded-xl bg-surface-1 p-4">
              <h2 className="meiye-type-body flex items-center gap-2 font-semibold">
                <IconBulb className="size-4" />
                {m.dashboard_lead_insights_title()}
              </h2>
              <Textarea
                rows={3}
                value={insight}
                onChange={(event) => setInsight(event.target.value)}
                placeholder={m.dashboard_lead_insight_placeholder()}
              />
              <Button
                className="w-full"
                variant="outline"
                disabled={pending || !insight.trim()}
                onClick={() => {
                  void run({
                    type: 'record_insight',
                    contentId: contentId || undefined,
                    kind: 'next_action',
                    note: insight,
                  });
                  setInsight('');
                }}
              >
                <IconCheck />
                {m.dashboard_lead_save_insight()}
              </Button>
              {state.insights
                .slice(-3)
                .reverse()
                .map((item) => (
                  <p
                    key={item.id}
                    className="border-l-2 border-divider pl-3 text-sm leading-6 text-muted-foreground"
                  >
                    {item.note}
                  </p>
                ))}
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
