/**
 * 记忆 — D-164④ + P1-04 three-layer IA (#316).
 *
 * What the product has learned about this shop is the reason it gets better
 * with use. A moat the merchant cannot see gives her no reason to stay, so it
 * gets a first-class destination rather than living inside a maintenance
 * screen.
 *
 * Four domains, per the decision: 门店偏好 / 营销活动 / 常用做法 / 你的纠正.
 *
 * Three of them have no producer yet — the sedimentation pipeline belongs to
 * #251 and the campaign entity has no owner at all. They still render, and
 * they say they are unfinished rather than showing the empty state a shop with
 * no history would see. Those are different facts and the merchant is owed the
 * true one: "we haven't built this" must never be dressed up as "you haven't
 * done anything yet" (the cold-state discipline from D-126, applied here).
 *
 * P0-B (#287): display honesty only — no raw JSON as merchant copy, pending
 * entries first by default, cold-start empty copy that does not pretend the
 * product has learned anything. Does not build producers or rename「经验」.
 *
 * P1-04 (#316 / D5): three-layer page IA —
 *   1. 待你确认 (default on top) — pending candidates only
 *   2. 已记住 — confirmed entries grouped by domain
 *   3. 证据抽屉 — per-entry basis drawer (source / status / when noticed)
 *
 * 门店偏好 reads the identity projection the identity workspace already
 * consumes — same query key, so one invalidation still covers both, and this
 * page adds no backend surface. It links there rather than editing in place:
 * a second long-stay workspace over one record is exactly what the dashboard
 * convergence work exists to remove.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import type {
  MarketingIdentityProjection,
  MemoryEntriesPage,
  MemoryEntryProjection,
} from '@meiye/contracts';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatLocaleDate } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import {
  memory_cold_start_disclaimer,
  memory_cold_start_item_campaigns,
  memory_cold_start_item_corrections,
  memory_cold_start_item_expression,
  memory_cold_start_item_workflows,
  memory_cold_start_lead,
  memory_domain_campaigns_description,
  memory_domain_campaigns_title,
  memory_domain_corrections_description,
  memory_domain_corrections_title,
  memory_domain_identity_action,
  memory_domain_identity_description,
  memory_domain_identity_empty,
  memory_domain_identity_title,
  memory_domain_workflows_action,
  memory_domain_workflows_description,
  memory_domain_workflows_title,
  memory_entry_confirm,
  memory_entry_delete,
  memory_entry_delete_source,
  memory_entry_empty,
  memory_entry_reject,
  memory_entry_reject_reason,
  memory_entry_source_available,
  memory_entry_source_deleted,
  memory_entry_source_unavailable,
  memory_entry_status_confirmed,
  memory_entry_status_pending,
  memory_entry_status_rejected,
  memory_entry_view_evidence,
  memory_entry_window_incomplete,
  memory_evidence_proposed_label,
  memory_evidence_source_label,
  memory_evidence_status_label,
  memory_evidence_title,
  memory_layer_pending_count,
  memory_layer_pending_description,
  memory_layer_pending_title,
  memory_layer_remembered_description,
  memory_layer_remembered_title,
  memory_page_description,
  memory_rejected_only_note,
  memory_remembered_identity_empty,
  memory_unbuilt_note,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { marketingIdentityProjectionQuery } from './marketing-identity-queries';

/**
 * Merchant vault list window. Contract max is 50; no status filter on the
 * seam, so we take the largest legal page and avoid claiming empty queues
 * when nextCursor means rejected rows may have crowded out real work.
 */
const MEMORY_ENTRIES_PAGE_LIMIT = 50;

/** Newest proposedAt first within a fixed status group. */
function sortByProposedAtDesc(
  items: MemoryEntryProjection[]
): MemoryEntryProjection[] {
  return [...items].sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function humanizeKey(key: string): string {
  return key.replace(/[._]/g, ' ');
}

/**
 * Merchant-facing value body. Non-string JSON must never appear as a raw
 * stringify blob — use key/value rows, lists, or short primitive text.
 *
 * Only the outermost node carries the testid: a nested structure would
 * otherwise hand the same handle to several elements, and an assertion that
 * silently matches the wrong depth is worse than no assertion.
 */
function MemoryValueView({
  value,
  root = true,
}: {
  value: unknown;
  root?: boolean;
}) {
  const testId = root ? 'memory-entry-value' : undefined;
  const blank = (
    <p className="meiye-type-aux" data-testid={testId}>
      —
    </p>
  );
  if (typeof value === 'string') {
    return <p data-testid={testId}>{value}</p>;
  }
  if (isPrimitive(value)) {
    return <p data-testid={testId}>{String(value)}</p>;
  }
  if (value === null || value === undefined) {
    return blank;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return blank;
    return (
      <ul className="list-disc space-y-1 pl-4" data-testid={testId}>
        {value.map((item, index) => (
          <li key={index}>
            {isPrimitive(item) ? (
              String(item)
            ) : (
              <MemoryValueView root={false} value={item} />
            )}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return blank;
    return (
      <dl className="grid gap-2 text-sm" data-testid={testId}>
        {entries.map(([key, nested]) => (
          <div key={key}>
            <dt className="meiye-type-aux">{humanizeKey(key)}</dt>
            <dd className="mt-0.5">
              {isPrimitive(nested) ? (
                String(nested)
              ) : (
                <MemoryValueView root={false} value={nested} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return blank;
}

function formatEntrySource(entry: MemoryEntryProjection): string {
  return entry.source?.status === 'available' &&
    entry.source.preview &&
    entry.source.observedAt
    ? memory_entry_source_available({
        date: formatLocaleDate(entry.source.observedAt),
        preview: entry.source.preview,
      })
    : entry.source?.status === 'deleted'
      ? memory_entry_source_deleted()
      : memory_entry_source_unavailable();
}

function formatEntryStatus(status: MemoryEntryProjection['status']): string {
  return status === 'confirmed'
    ? memory_entry_status_confirmed()
    : status === 'rejected'
      ? memory_entry_status_rejected()
      : memory_entry_status_pending();
}

/**
 * Cold start. The page's standing description promises the product knows this
 * shop better the longer she uses it — true eventually, a lie on day one. With
 * nothing sedimented at all, say so plainly and name what will show up here
 * later, framed as future rather than as something already learned.
 */
function ColdStartNote() {
  return (
    <div
      className="meiye-porcelain rounded-2xl p-5 sm:p-6"
      data-testid="memory-cold-start"
    >
      <p>{memory_cold_start_lead()}</p>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
        <li>{memory_cold_start_item_expression()}</li>
        <li>{memory_cold_start_item_campaigns()}</li>
        <li>{memory_cold_start_item_corrections()}</li>
        <li>{memory_cold_start_item_workflows()}</li>
      </ul>
      <p className="meiye-type-aux mt-3">{memory_cold_start_disclaimer()}</p>
    </div>
  );
}

function MemorySection({
  title,
  description,
  testId,
  children,
}: {
  title: string;
  description: string;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <section
      className="meiye-porcelain rounded-2xl p-5 sm:p-6"
      data-testid={testId}
    >
      <h2 className="text-base font-semibold leading-7">{title}</h2>
      <p className="meiye-type-aux mt-1">{description}</p>
      {children ? <div className="mt-3 text-sm">{children}</div> : null}
    </section>
  );
}

/**
 * Says the domain is unfinished. Deliberately not the empty state: a shop with
 * no history and a feature with no backend look identical on screen unless one
 * of them says which it is.
 */
function UnbuiltNote() {
  return (
    <p className="meiye-type-aux" data-testid="memory-unbuilt-note">
      {memory_unbuilt_note()}
    </p>
  );
}

type MemoryAction =
  | 'confirm_candidate'
  | 'reject_candidate'
  | 'delete_entry'
  | 'delete_source_conversation';

export function MemoryVaultPage() {
  const queryClient = useQueryClient();
  const identityQuery = useQuery(marketingIdentityProjectionQuery);
  const entriesQuery = useQuery({
    queryKey: p1QueryKeys.request('memory', 'entries_page', {
      limit: MEMORY_ENTRIES_PAGE_LIMIT,
    }),
    queryFn: ({ signal }) =>
      queryP1<MemoryEntriesPage>(
        'memory',
        {
          action: 'entries_page',
          payload: { limit: MEMORY_ENTRIES_PAGE_LIMIT },
        },
        signal
      ),
  });
  const decide = useMutation({
    mutationFn: (input: {
      action: MemoryAction;
      entryId: string;
      conversationId?: string;
    }) =>
      commandP1(
        'memory',
        {
          action: input.action,
          payload:
            input.action === 'reject_candidate'
              ? {
                  entryId: input.entryId,
                  reason: memory_entry_reject_reason(),
                }
              : input.action === 'delete_source_conversation'
                ? { conversationId: input.conversationId }
                : { entryId: input.entryId },
        },
        `memory:${input.action}:${input.entryId}`
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('memory'),
      }),
  });
  const [evidenceEntryId, setEvidenceEntryId] = useState<string | null>(null);

  const projection: MarketingIdentityProjection | undefined =
    identityQuery.data;
  const defaultIdentityId = projection?.defaultIdentity?.identityId;
  const defaultIdentity = defaultIdentityId
    ? projection?.identities.find(
        (identity) => identity.identityId === defaultIdentityId
      )
    : undefined;
  const allEntries = entriesQuery.data?.items ?? [];
  // Layer 1: only pending. Layer 2: confirmed only (rejected leave the page).
  const pendingEntries = sortByProposedAtDesc(
    allEntries.filter((entry) => entry.status === 'pending')
  );
  const confirmedEntries = sortByProposedAtDesc(
    allEntries.filter((entry) => entry.status === 'confirmed')
  );
  const hasVisibleSediment =
    pendingEntries.length > 0 || confirmedEntries.length > 0;
  const hasRejectedHistory = allEntries.some(
    (entry) => entry.status === 'rejected'
  );
  // Only claim coldness once both reads have actually answered — a pending or
  // failed query is not evidence that the shop has nothing sedimented.
  const entriesReady = entriesQuery.isSuccess;
  const settled = entriesReady && Boolean(identityQuery.data);
  // Seam has no status filter; nextCursor means this window is incomplete —
  // do not assert empty queues after client-side reject filtering.
  const windowMayHaveMore = Boolean(entriesQuery.data?.nextCursor);
  // True greenfield only: no raw rows at all (incl. rejected) and no persona.
  const cold = settled && allEntries.length === 0 && !defaultIdentity;
  // Rejected-only history is not cold and not "越用越懂你" — nothing rememberable.
  // Only claim this when the page window is complete (no nextCursor).
  const rejectedOnlyNoIdentity =
    settled &&
    !defaultIdentity &&
    !hasVisibleSediment &&
    hasRejectedHistory &&
    !windowMayHaveMore;
  // Standing 「越懂你的店」 only with identity / visible sediment, or while the
  // memory read is still unanswered (must not look cold on error/loading).
  const showStandingDescription =
    !cold &&
    !rejectedOnlyNoIdentity &&
    (Boolean(defaultIdentity) || hasVisibleSediment || !entriesReady);
  const canClaimEmptyQueues = entriesReady && !cold && !windowMayHaveMore;
  const evidenceEntry =
    evidenceEntryId == null
      ? null
      : (allEntries.find((entry) => entry.entryId === evidenceEntryId) ?? null);

  return (
    <div className="flex flex-col gap-4">
      {cold ? (
        <ColdStartNote />
      ) : rejectedOnlyNoIdentity ? (
        <p className="meiye-type-aux" data-testid="memory-rejected-only-note">
          {memory_rejected_only_note()}
        </p>
      ) : showStandingDescription ? (
        <p className="meiye-type-aux">{memory_page_description()}</p>
      ) : null}

      {/* Layer 1 — 待你确认 (default on top, P1-4 / D5) */}
      <MemorySection
        title={memory_layer_pending_title()}
        description={memory_layer_pending_description()}
        testId="memory-layer-pending"
      >
        {pendingEntries.length > 0 ? (
          <>
            <p
              className="meiye-type-aux mb-3"
              data-testid="memory-layer-pending-count"
            >
              {memory_layer_pending_count({
                count: pendingEntries.length,
              })}
            </p>
            <div className="space-y-3" data-testid="memory-entries-pending">
              {pendingEntries.map((entry) => (
                <MemoryEntryCard
                  entry={entry}
                  key={entry.entryId}
                  pending={decide.isPending}
                  onAction={(action) =>
                    decide.mutate({
                      action,
                      entryId: entry.entryId,
                      conversationId: entry.source?.conversationId,
                    })
                  }
                  onOpenEvidence={() => setEvidenceEntryId(entry.entryId)}
                />
              ))}
            </div>
          </>
        ) : canClaimEmptyQueues ? (
          // Authoritative empty only after a successful full-window read.
          <p className="meiye-type-aux" data-testid="memory-entry-empty">
            {memory_entry_empty()}
          </p>
        ) : entriesReady && windowMayHaveMore ? (
          <p
            className="meiye-type-aux"
            data-testid="memory-pending-window-incomplete"
          >
            {memory_entry_window_incomplete()}
          </p>
        ) : null}
      </MemorySection>

      {/* Layer 2 — 已记住, grouped by domain */}
      <MemorySection
        title={memory_layer_remembered_title()}
        description={memory_layer_remembered_description()}
        testId="memory-layer-remembered"
      >
        <div className="space-y-4">
          <DomainGroup
            title={memory_domain_identity_title()}
            description={memory_domain_identity_description()}
            testId="memory-domain-identity"
          >
            <div className="space-y-3" data-testid="memory-entries-confirmed">
              {confirmedEntries.length > 0 ? (
                confirmedEntries.map((entry) => (
                  <MemoryEntryCard
                    entry={entry}
                    key={entry.entryId}
                    pending={decide.isPending}
                    onAction={(action) =>
                      decide.mutate({
                        action,
                        entryId: entry.entryId,
                        conversationId: entry.source?.conversationId,
                      })
                    }
                    onOpenEvidence={() => setEvidenceEntryId(entry.entryId)}
                  />
                ))
              ) : canClaimEmptyQueues ? (
                <p
                  className="meiye-type-aux"
                  data-testid="memory-remembered-identity-empty"
                >
                  {memory_remembered_identity_empty()}
                </p>
              ) : entriesReady && windowMayHaveMore ? (
                <p
                  className="meiye-type-aux"
                  data-testid="memory-confirmed-window-incomplete"
                >
                  {memory_entry_window_incomplete()}
                </p>
              ) : null}
            </div>
            {defaultIdentity ? (
              <p data-testid="memory-identity-name">
                {defaultIdentity.displayName}
              </p>
            ) : (
              <p className="meiye-type-aux">{memory_domain_identity_empty()}</p>
            )}
            <Link
              className="mt-2 inline-block underline underline-offset-4"
              to={Routes.MarketingIdentity}
            >
              {memory_domain_identity_action()}
            </Link>
          </DomainGroup>

          <DomainGroup
            title={memory_domain_campaigns_title()}
            description={memory_domain_campaigns_description()}
            testId="memory-domain-campaigns"
          >
            <UnbuiltNote />
          </DomainGroup>

          <DomainGroup
            title={memory_domain_workflows_title()}
            description={memory_domain_workflows_description()}
            testId="memory-domain-workflows"
          >
            <UnbuiltNote />
            <Link
              className="mt-2 inline-block underline underline-offset-4"
              to="/dashboard/catalog"
            >
              {memory_domain_workflows_action()}
            </Link>
          </DomainGroup>

          <DomainGroup
            title={memory_domain_corrections_title()}
            description={memory_domain_corrections_description()}
            testId="memory-domain-corrections"
          >
            <UnbuiltNote />
          </DomainGroup>
        </div>
      </MemorySection>

      {/* Layer 3 — 证据抽屉 (per-entry basis; not a third vertical stack) */}
      <MemoryEvidenceDrawer
        entry={evidenceEntry}
        open={evidenceEntry != null}
        onOpenChange={(open) => {
          if (!open) setEvidenceEntryId(null);
        }}
      />
    </div>
  );
}

function DomainGroup({
  title,
  description,
  testId,
  children,
}: {
  title: string;
  description: string;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <div
      className="rounded-xl border border-foreground/10 p-4"
      data-testid={testId}
    >
      <h3 className="text-sm font-semibold leading-6">{title}</h3>
      <p className="meiye-type-aux mt-0.5">{description}</p>
      {children ? (
        <div className="mt-3 space-y-2 text-sm">{children}</div>
      ) : null}
    </div>
  );
}

function MemoryEntryCard({
  entry,
  pending,
  onAction,
  onOpenEvidence,
}: {
  entry: MemoryEntryProjection;
  pending: boolean;
  onAction: (action: MemoryAction) => void;
  onOpenEvidence: () => void;
}) {
  const source = formatEntrySource(entry);
  const status = formatEntryStatus(entry.status);
  return (
    <article
      className="rounded-xl border border-foreground/10 p-3"
      data-testid={`memory-entry-${entry.entryId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <MemoryValueView value={entry.value} />
        </div>
        <span className="meiye-type-aux shrink-0">{status}</span>
      </div>
      <p className="meiye-type-aux mt-1" data-testid="memory-entry-provenance">
        {source}
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        {entry.status === 'pending' ? (
          <>
            <button
              disabled={pending}
              onClick={() => onAction('confirm_candidate')}
              type="button"
            >
              {memory_entry_confirm()}
            </button>
            <button
              disabled={pending}
              onClick={() => onAction('reject_candidate')}
              type="button"
            >
              {memory_entry_reject()}
            </button>
          </>
        ) : null}
        <button
          data-testid={`memory-entry-evidence-open-${entry.entryId}`}
          onClick={onOpenEvidence}
          type="button"
        >
          {memory_entry_view_evidence()}
        </button>
        <button
          disabled={pending}
          onClick={() => onAction('delete_entry')}
          type="button"
        >
          {memory_entry_delete()}
        </button>
        {entry.source?.status === 'available' ? (
          <button
            disabled={pending}
            onClick={() => onAction('delete_source_conversation')}
            type="button"
          >
            {memory_entry_delete_source()}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function MemoryEvidenceDrawer({
  entry,
  open,
  onOpenChange,
}: {
  entry: MemoryEntryProjection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-md"
        data-testid="memory-evidence-drawer"
        side="right"
      >
        <SheetHeader>
          <SheetTitle>{memory_evidence_title()}</SheetTitle>
          <SheetDescription className="sr-only">
            {memory_evidence_title()}
          </SheetDescription>
        </SheetHeader>
        {entry ? (
          <div className="flex flex-col gap-4 px-4 pb-6 text-sm">
            <div data-testid="memory-evidence-value">
              <MemoryValueView root={false} value={entry.value} />
            </div>
            <dl className="grid gap-3">
              <div>
                <dt className="meiye-type-aux">
                  {memory_evidence_status_label()}
                </dt>
                <dd className="mt-0.5" data-testid="memory-evidence-status">
                  {formatEntryStatus(entry.status)}
                </dd>
              </div>
              <div>
                <dt className="meiye-type-aux">
                  {memory_evidence_proposed_label()}
                </dt>
                <dd className="mt-0.5" data-testid="memory-evidence-proposed">
                  {formatLocaleDate(entry.proposedAt)}
                </dd>
              </div>
              <div>
                <dt className="meiye-type-aux">
                  {memory_evidence_source_label()}
                </dt>
                <dd className="mt-0.5" data-testid="memory-evidence-source">
                  {formatEntrySource(entry)}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
