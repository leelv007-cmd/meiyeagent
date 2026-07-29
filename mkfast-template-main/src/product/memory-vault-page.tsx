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
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { MarketingIdentityProjection } from '@meiye/contracts';

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
  memory_page_description,
  memory_unbuilt_note,
} from '@/locale/paraglide/messages';
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
  const identityQuery = useQuery(marketingIdentityProjectionQuery);
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
