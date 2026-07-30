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

  return (
    <div className="flex flex-col gap-4">
      <p className="meiye-type-aux">{memory_page_description()}</p>

      <MemorySection
        title={memory_domain_identity_title()}
        description={memory_domain_identity_description()}
        testId="memory-domain-identity"
      >
        <div className="space-y-3" data-testid="memory-entries">
          {entriesQuery.data?.items?.length ? (
            entriesQuery.data.items.map((entry) => (
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
          ) : (
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
        <p>
          {typeof entry.value === 'string'
            ? entry.value
            : JSON.stringify(entry.value)}
        </p>
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
