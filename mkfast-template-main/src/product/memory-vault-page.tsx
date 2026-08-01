/**
 * 记忆 — D-164④.
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
 * 门店偏好 reads the identity projection the identity workspace already
 * consumes — same query key, so one invalidation still covers both, and this
 * page adds no backend surface. It links there rather than editing in place:
 * a second long-stay workspace over one record is exactly what the dashboard
 * convergence work exists to remove.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type {
  MarketingIdentityProjection,
  MemoryEntriesPage,
  MemoryEntryProjection,
} from '@meiye/contracts';

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
  memory_page_description,
  memory_unbuilt_note,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { marketingIdentityProjectionQuery } from './marketing-identity-queries';

/** Pending first; within a status, newest proposedAt first. */
function sortMemoryEntries(
  items: MemoryEntryProjection[]
): MemoryEntryProjection[] {
  const rank = (status: MemoryEntryProjection['status']) =>
    status === 'pending' ? 0 : status === 'confirmed' ? 1 : 2;
  return [...items].sort((a, b) => {
    const byStatus = rank(a.status) - rank(b.status);
    if (byStatus !== 0) return byStatus;
    return b.proposedAt.localeCompare(a.proposedAt);
  });
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

export function MemoryVaultPage() {
  const queryClient = useQueryClient();
  const identityQuery = useQuery(marketingIdentityProjectionQuery);
  const entriesQuery = useQuery({
    queryKey: p1QueryKeys.request('memory', 'entries_page', { limit: 20 }),
    queryFn: ({ signal }) =>
      queryP1<MemoryEntriesPage>(
        'memory',
        { action: 'entries_page', payload: { limit: 20 } },
        signal
      ),
  });
  const decide = useMutation({
    mutationFn: (input: {
      action:
        | 'confirm_candidate'
        | 'reject_candidate'
        | 'delete_entry'
        | 'delete_source_conversation';
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
  const projection: MarketingIdentityProjection | undefined =
    identityQuery.data;
  const defaultIdentityId = projection?.defaultIdentity?.identityId;
  const defaultIdentity = defaultIdentityId
    ? projection?.identities.find(
        (identity) => identity.identityId === defaultIdentityId
      )
    : undefined;
  const entries = sortMemoryEntries(entriesQuery.data?.items ?? []);
  // Only claim coldness once both reads have actually answered — a pending or
  // failed query is not evidence that the shop has nothing sedimented.
  const settled = Boolean(entriesQuery.data) && Boolean(identityQuery.data);
  const cold = settled && entries.length === 0 && !defaultIdentity;

  return (
    <div className="flex flex-col gap-4">
      {cold ? (
        <ColdStartNote />
      ) : (
        <p className="meiye-type-aux">{memory_page_description()}</p>
      )}

      <MemorySection
        title={memory_domain_identity_title()}
        description={memory_domain_identity_description()}
        testId="memory-domain-identity"
      >
        <div className="space-y-3" data-testid="memory-entries">
          {entries.length > 0 ? (
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
              />
            ))
          ) : cold ? null : (
            // On a cold page the note above already says nothing was learned;
            // repeating it per section is the four-empty-blocks screen the
            // cold state exists to replace.
            <p className="meiye-type-aux" data-testid="memory-entry-empty">
              {memory_entry_empty()}
            </p>
          )}
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
      </MemorySection>

      <MemorySection
        title={memory_domain_campaigns_title()}
        description={memory_domain_campaigns_description()}
        testId="memory-domain-campaigns"
      >
        <UnbuiltNote />
      </MemorySection>

      <MemorySection
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
      </MemorySection>

      <MemorySection
        title={memory_domain_corrections_title()}
        description={memory_domain_corrections_description()}
        testId="memory-domain-corrections"
      >
        <UnbuiltNote />
      </MemorySection>
    </div>
  );
}

function MemoryEntryCard({
  entry,
  pending,
  onAction,
}: {
  entry: MemoryEntryProjection;
  pending: boolean;
  onAction: (
    action:
      | 'confirm_candidate'
      | 'reject_candidate'
      | 'delete_entry'
      | 'delete_source_conversation'
  ) => void;
}) {
  const source =
    entry.source?.status === 'available' &&
    entry.source.preview &&
    entry.source.observedAt
      ? memory_entry_source_available({
          date: formatLocaleDate(entry.source.observedAt),
          preview: entry.source.preview,
        })
      : entry.source?.status === 'deleted'
        ? memory_entry_source_deleted()
        : memory_entry_source_unavailable();
  const status =
    entry.status === 'confirmed'
      ? memory_entry_status_confirmed()
      : entry.status === 'rejected'
        ? memory_entry_status_rejected()
        : memory_entry_status_pending();
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
