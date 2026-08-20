/**
 * 记忆 — D-164④ + P1-04 three-layer IA (#316).
 *
 * What the product has learned about this shop is the reason it gets better
 * with use. A moat the merchant cannot see gives her no reason to stay, so it
 * gets a first-class destination rather than living inside a maintenance
 * screen.
 *
 * Four domains, per the decision: 门店偏好 / 营销活动 / 常用做法 / 你的纠正.
 * They map onto V3.1 vault kinds preference / episode / procedure / correction.
 * Correction is first among remembered domains.
 *
 * P0-B (#287): display honesty only — no raw JSON as merchant copy, pending
 * entries first by default, cold-start empty copy that does not pretend the
 * product has learned anything. Nav rename「经验」is P2-13 (route stays memory).
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
  MemoryEntryKind,
  MemoryEntryProjection,
} from '@meiye/contracts';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { StatePanel } from '@/components/uiux/state-panel';
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
  memory_entries_error_description,
  memory_entries_error_title,
  memory_entries_loading_description,
  memory_entries_loading_title,
  memory_entries_retry,
  memory_entry_authority_confirmed,
  memory_entry_authority_observation,
  memory_entry_authority_session,
  memory_entry_authority_strong,
  memory_entry_confirm,
  memory_entry_delete,
  memory_entry_delete_source,
  memory_entry_empty,
  memory_entry_reject,
  memory_entry_reject_reason,
  memory_entry_state_active,
  memory_entry_state_expired,
  memory_entry_state_proposed,
  memory_entry_state_revoked,
  memory_entry_state_superseded,
  memory_entry_status_confirmed,
  memory_entry_status_pending,
  memory_entry_status_rejected,
  memory_entry_status_revoked,
  memory_entry_view_evidence,
  memory_entry_window_incomplete,
  memory_evidence_authority_label,
  memory_evidence_kind_label,
  memory_evidence_proposed_label,
  memory_evidence_revision_label,
  memory_evidence_source_label,
  memory_evidence_state_label,
  memory_evidence_status_label,
  memory_evidence_title,
  memory_layer_pending_count,
  memory_layer_pending_description,
  memory_layer_pending_title,
  memory_layer_remembered_description,
  memory_layer_remembered_title,
  memory_page_description,
  memory_rejected_only_note,
  memory_remembered_campaigns_empty,
  memory_remembered_corrections_empty,
  memory_remembered_identity_empty,
  memory_remembered_workflows_empty,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { formatMemorySource } from '@/product/memory-source-format';
import { projectMerchantMemoryFieldLabel } from '@/product/merchant-vocabulary';
import { marketingIdentityProjectionQuery } from './marketing-identity-queries';

/**
 * Merchant vault list window. Contract max is 50; no status filter on the
 * seam, so we take the largest legal page and avoid claiming empty queues
 * when nextCursor means rejected rows may have crowded out real work.
 */
const MEMORY_ENTRIES_PAGE_LIMIT = 50;

function vaultKind(entry: MemoryEntryProjection): MemoryEntryKind {
  return entry.kind ?? 'preference';
}

/** Correction first, then newest proposedAt within the remaining kinds. */
function sortVaultEntries(
  items: MemoryEntryProjection[]
): MemoryEntryProjection[] {
  return [...items].sort((left, right) => {
    const rank =
      (vaultKind(left) === 'correction' ? 0 : 1) -
      (vaultKind(right) === 'correction' ? 0 : 1);
    if (rank !== 0) return rank;
    return (
      right.proposedAt.localeCompare(left.proposedAt) ||
      right.entryId.localeCompare(left.entryId)
    );
  });
}

function confirmedOfKind(
  items: MemoryEntryProjection[],
  kind: MemoryEntryKind
): MemoryEntryProjection[] {
  return sortVaultEntries(
    items.filter(
      (entry) => vaultKind(entry) === kind && entry.status === 'confirmed'
    )
  );
}

function formatEntryKind(kind: MemoryEntryKind): string {
  if (kind === 'correction') return memory_domain_corrections_title();
  if (kind === 'procedure') return memory_domain_workflows_title();
  if (kind === 'episode') return memory_domain_campaigns_title();
  return memory_domain_identity_title();
}

function formatEntryAuthority(
  authority: MemoryEntryProjection['authority'] | undefined
): string {
  if (authority === 'session') return memory_entry_authority_session();
  if (authority === 'strong') return memory_entry_authority_strong();
  if (authority === 'confirmed') return memory_entry_authority_confirmed();
  return memory_entry_authority_observation();
}

function formatEntryState(
  state: MemoryEntryProjection['state'] | undefined
): string {
  if (state === 'active') return memory_entry_state_active();
  if (state === 'superseded') return memory_entry_state_superseded();
  if (state === 'revoked') return memory_entry_state_revoked();
  if (state === 'expired') return memory_entry_state_expired();
  return memory_entry_state_proposed();
}

function entryStatement(entry: MemoryEntryProjection): string {
  if (entry.statement?.trim()) return entry.statement.trim();
  if (typeof entry.value === 'string' && entry.value.trim()) {
    return entry.value.trim();
  }
  return entry.semanticKey;
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function humanizeKey(key: string): string | null {
  return projectMerchantMemoryFieldLabel(key);
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
        {entries.map(([key, nested]) => {
          const label = humanizeKey(key);
          return (
            <div key={key}>
              {label ? <dt className="meiye-type-aux">{label}</dt> : null}
              <dd className="mt-0.5">
                {isPrimitive(nested) ? (
                  String(nested)
                ) : (
                  <MemoryValueView root={false} value={nested} />
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }
  return blank;
}

function formatEntrySource(entry: MemoryEntryProjection): string {
  return formatMemorySource(entry.source);
}

function formatEntryStatus(status: MemoryEntryProjection['status']): string {
  if (status === 'confirmed') return memory_entry_status_confirmed();
  if (status === 'rejected') return memory_entry_status_rejected();
  if (status === 'revoked') return memory_entry_status_revoked();
  return memory_entry_status_pending();
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
      queryP1(
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
  const entriesLoading = entriesQuery.isFetching && !entriesQuery.isSuccess;
  const entriesFailed = entriesQuery.isError && !entriesQuery.isFetching;
  // Layer 1: only pending. Layer 2: confirmed only (rejected leave the page).
  const pendingEntries = sortVaultEntries(
    allEntries.filter((entry) => entry.status === 'pending')
  );
  const confirmedPreferences = confirmedOfKind(allEntries, 'preference');
  const confirmedCorrections = confirmedOfKind(allEntries, 'correction');
  const confirmedProcedures = confirmedOfKind(allEntries, 'procedure');
  const confirmedEpisodes = confirmedOfKind(allEntries, 'episode');
  const hasVisibleSediment =
    pendingEntries.length > 0 ||
    confirmedPreferences.length > 0 ||
    confirmedCorrections.length > 0 ||
    confirmedProcedures.length > 0 ||
    confirmedEpisodes.length > 0;
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
  // Rejected-only history is not cold, but it is not rememberable sediment.
  // Only claim this when the page window is complete (no nextCursor).
  const rejectedOnlyNoIdentity =
    settled &&
    !defaultIdentity &&
    !hasVisibleSediment &&
    hasRejectedHistory &&
    !windowMayHaveMore;
  // Show the neutral standing description with identity / visible sediment, or
  // while the memory read is unanswered (must not look cold on error/loading).
  const showStandingDescription =
    !cold &&
    !rejectedOnlyNoIdentity &&
    (Boolean(defaultIdentity) || hasVisibleSediment || !entriesReady);
  const canClaimEmptyQueues = entriesReady && !cold && !windowMayHaveMore;
  const evidenceEntry =
    evidenceEntryId == null
      ? null
      : (allEntries.find((entry) => entry.entryId === evidenceEntryId) ?? null);

  const renderCards = (entries: MemoryEntryProjection[]) =>
    entries.map((entry) => (
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
    ));

  return (
    <div className="flex flex-col gap-4">
      {entriesLoading ? (
        <div data-testid="memory-entries-loading">
          <StatePanel
            description={memory_entries_loading_description()}
            kind="loading"
            title={memory_entries_loading_title()}
          />
        </div>
      ) : null}
      {entriesFailed ? (
        <div data-testid="memory-entries-error">
          <StatePanel
            actionLabel={memory_entries_retry()}
            description={memory_entries_error_description()}
            kind="error"
            onAction={() => void entriesQuery.refetch()}
            title={memory_entries_error_title()}
          />
        </div>
      ) : null}
      {cold ? (
        <ColdStartNote />
      ) : rejectedOnlyNoIdentity ? (
        <p className="meiye-type-aux" data-testid="memory-rejected-only-note">
          {memory_rejected_only_note()}
        </p>
      ) : showStandingDescription && !entriesFailed ? (
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
              {renderCards(pendingEntries)}
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
            title={memory_domain_corrections_title()}
            description={memory_domain_corrections_description()}
            testId="memory-domain-corrections"
          >
            <DomainEntries
              canClaimEmpty={canClaimEmptyQueues}
              emptyCopy={memory_remembered_corrections_empty()}
              emptyTestId="memory-remembered-corrections-empty"
              entries={confirmedCorrections}
              listTestId="memory-entries-corrections"
              windowIncomplete={entriesReady && windowMayHaveMore}
              windowTestId="memory-corrections-window-incomplete"
            >
              {renderCards(confirmedCorrections)}
            </DomainEntries>
          </DomainGroup>

          <DomainGroup
            title={memory_domain_identity_title()}
            description={memory_domain_identity_description()}
            testId="memory-domain-identity"
          >
            <DomainEntries
              canClaimEmpty={canClaimEmptyQueues}
              emptyCopy={memory_remembered_identity_empty()}
              emptyTestId="memory-remembered-identity-empty"
              entries={confirmedPreferences}
              listTestId="memory-entries-confirmed"
              windowIncomplete={entriesReady && windowMayHaveMore}
              windowTestId="memory-confirmed-window-incomplete"
            >
              {renderCards(confirmedPreferences)}
            </DomainEntries>
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
            title={memory_domain_workflows_title()}
            description={memory_domain_workflows_description()}
            testId="memory-domain-workflows"
          >
            <DomainEntries
              canClaimEmpty={canClaimEmptyQueues}
              emptyCopy={memory_remembered_workflows_empty()}
              emptyTestId="memory-remembered-workflows-empty"
              entries={confirmedProcedures}
              listTestId="memory-entries-procedures"
              windowIncomplete={entriesReady && windowMayHaveMore}
              windowTestId="memory-workflows-window-incomplete"
            >
              {renderCards(confirmedProcedures)}
            </DomainEntries>
            <Link
              className="mt-2 inline-block underline underline-offset-4"
              to="/dashboard/catalog"
            >
              {memory_domain_workflows_action()}
            </Link>
          </DomainGroup>

          <DomainGroup
            title={memory_domain_campaigns_title()}
            description={memory_domain_campaigns_description()}
            testId="memory-domain-campaigns"
          >
            <DomainEntries
              canClaimEmpty={canClaimEmptyQueues}
              emptyCopy={memory_remembered_campaigns_empty()}
              emptyTestId="memory-remembered-campaigns-empty"
              entries={confirmedEpisodes}
              listTestId="memory-entries-episodes"
              windowIncomplete={entriesReady && windowMayHaveMore}
              windowTestId="memory-campaigns-window-incomplete"
            >
              {renderCards(confirmedEpisodes)}
            </DomainEntries>
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

function DomainEntries({
  canClaimEmpty,
  emptyCopy,
  emptyTestId,
  entries,
  listTestId,
  windowIncomplete,
  windowTestId = 'memory-confirmed-window-incomplete',
  children,
}: {
  canClaimEmpty: boolean;
  emptyCopy: string;
  emptyTestId: string;
  entries: MemoryEntryProjection[];
  listTestId: string;
  windowIncomplete: boolean;
  windowTestId?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3" data-testid={listTestId}>
      {entries.length > 0 ? (
        children
      ) : canClaimEmpty ? (
        <p className="meiye-type-aux" data-testid={emptyTestId}>
          {emptyCopy}
        </p>
      ) : windowIncomplete ? (
        <p className="meiye-type-aux" data-testid={windowTestId}>
          {memory_entry_window_incomplete()}
        </p>
      ) : null}
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
  const kind = vaultKind(entry);
  return (
    <article
      className="rounded-xl border border-foreground/10 p-3"
      data-memory-authority={entry.authority ?? 'observation'}
      data-memory-kind={kind}
      data-memory-revision={String(entry.revision ?? 0)}
      data-memory-state={entry.state ?? 'proposed'}
      data-testid={`memory-entry-${entry.entryId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p data-testid="memory-entry-statement">{entryStatement(entry)}</p>
          <MemoryValueView value={entry.value} />
        </div>
        <span className="meiye-type-aux shrink-0">{status}</span>
      </div>
      <p className="meiye-type-aux mt-1" data-testid="memory-entry-kind">
        {formatEntryKind(kind)}
      </p>
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
                  {memory_evidence_kind_label()}
                </dt>
                <dd className="mt-0.5" data-testid="memory-evidence-kind">
                  {formatEntryKind(vaultKind(entry))}
                </dd>
              </div>
              <div>
                <dt className="meiye-type-aux">
                  {memory_evidence_authority_label()}
                </dt>
                <dd className="mt-0.5" data-testid="memory-evidence-authority">
                  {formatEntryAuthority(entry.authority)}
                </dd>
              </div>
              <div>
                <dt className="meiye-type-aux">
                  {memory_evidence_state_label()}
                </dt>
                <dd className="mt-0.5" data-testid="memory-evidence-state">
                  {formatEntryState(entry.state)}
                </dd>
              </div>
              <div>
                <dt className="meiye-type-aux">
                  {memory_evidence_revision_label()}
                </dt>
                <dd className="mt-0.5" data-testid="memory-evidence-revision">
                  {entry.revision ?? 0}
                </dd>
              </div>
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
