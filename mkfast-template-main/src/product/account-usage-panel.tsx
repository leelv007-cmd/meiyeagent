import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  account_usage_allowance,
  account_usage_audio,
  account_usage_available,
  account_usage_copy,
  account_usage_description,
  account_usage_details_hide,
  account_usage_details_show,
  account_usage_expiry,
  account_usage_expiry_unavailable,
  account_usage_image,
  account_usage_load_error,
  account_usage_load_error_title,
  account_usage_loading,
  account_usage_no_plan,
  account_usage_plan_growth,
  account_usage_plan_pro,
  account_usage_plan_starter,
  account_usage_plan_trial,
  account_usage_plan_upgrade,
  account_usage_released,
  account_usage_reserved,
  account_usage_retry,
  account_usage_settled,
  account_usage_terms_explanation,
  account_usage_title,
  account_usage_video,
} from '@/locale/paraglide/messages';
import { formatLocaleDate } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  IconChevronDown,
  IconChevronUp,
  IconRefresh,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  projectAccountUsage,
  type AccountUsageProjection,
  type AccountUsageResource,
} from './account-usage';

/**
 * One label per bucket. Every resource the projection carries needs an entry:
 * the retired ternary fell through to 「视频条数」 for `audio`, so the page
 * showed the same resource name twice with two different balances and the
 * merchant could not tell which one was their video quota.
 */
const RESOURCE_LABELS: Record<AccountUsageResource, () => string> = {
  copy: account_usage_copy,
  image: account_usage_image,
  video: account_usage_video,
  audio: account_usage_audio,
};

/**
 * 规范化状态标签 for the subscription tier (DESIGN.md §5): a Chinese semantic
 * label + tone dot + explanation + next action. The raw tier code (`trial`)
 * never reaches the merchant — PRODUCT.md 反面参照「后台代码与技术术语暴露给商家」.
 */
const PLAN_LABELS: Record<
  NonNullable<AccountUsageProjection['plan']>['tier'],
  { label: () => string; tone: 'progress' | 'success' }
> = {
  trial: { label: account_usage_plan_trial, tone: 'progress' },
  starter: { label: account_usage_plan_starter, tone: 'success' },
  growth: { label: account_usage_plan_growth, tone: 'success' },
  pro: { label: account_usage_plan_pro, tone: 'success' },
};

const PLAN_TONE_STYLE = {
  neutral:
    'bg-[oklch(0.42_0_0/0.06)] text-[oklch(0_0_0/0.7)] dark:bg-[oklch(1_0_0/0.08)] dark:text-[oklch(1_0_0/0.78)]',
  progress:
    'bg-[oklch(0.5_0.19_262/0.1)] text-[oklch(0.4_0.16_262)] dark:bg-[oklch(0.5_0.19_262/0.18)] dark:text-[oklch(0.82_0.08_262)]',
  success:
    'bg-[oklch(0.53_0.14_150/0.1)] text-[oklch(0.4_0.12_150)] dark:bg-[oklch(0.53_0.14_150/0.18)] dark:text-[oklch(0.82_0.08_150)]',
} as const;

const PLAN_TONE_DOT = {
  neutral: 'bg-[oklch(0.55_0_0)]',
  progress: 'bg-[oklch(0.5_0.19_262)]',
  success: 'bg-[oklch(0.53_0.14_150)]',
} as const;

function PlanStatusLabel({
  expiresAt,
  tier,
}: {
  expiresAt: string | null;
  tier: NonNullable<AccountUsageProjection['plan']>['tier'] | null;
}) {
  const plan = tier ? PLAN_LABELS[tier] : null;
  const tone = plan?.tone ?? 'neutral';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        className={`h-auto gap-x-1.5 rounded-md border-transparent px-2 py-1 ${PLAN_TONE_STYLE[tone]}`}
        data-testid="account-usage-plan-status"
        variant="outline"
      >
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${PLAN_TONE_DOT[tone]}`}
        />
        {plan ? plan.label() : account_usage_no_plan()}
      </Badge>
      <span className="text-sm text-muted-foreground">
        {account_usage_expiry()}
        {expiresAt
          ? formatLocaleDate(expiresAt)
          : account_usage_expiry_unavailable()}
      </span>
      <Link
        className="text-sm font-medium underline underline-offset-4"
        to={Routes.Pricing}
      >
        {account_usage_plan_upgrade()}
      </Link>
    </div>
  );
}

export function AccountUsagePanel() {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const query = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'projection'),
    queryFn: ({ signal }) =>
      queryP1<AccountUsageProjection>(
        'entitlements',
        { action: 'projection', payload: {} },
        signal
      ),
  });

  if (query.isPending) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          {account_usage_loading()}
        </CardContent>
      </Card>
    );
  }
  if (query.error || !query.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{account_usage_load_error_title()}</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          {account_usage_load_error()}
          <Button
            onClick={() => void query.refetch()}
            size="sm"
            variant="outline"
          >
            <IconRefresh />
            {account_usage_retry()}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const projection = projectAccountUsage(query.data);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{account_usage_title()}</CardTitle>
          <PlanStatusLabel
            expiresAt={projection.summary.expiresAt}
            tier={projection.summary.tier}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          {account_usage_description()}
        </p>
        {/*
          Default view is one number per bucket — 「可用」, the only figure that
          answers 「我还能发几条」. 预留/已结算/已释放 and the terms table are the
          ledger behind it, so they live behind one disclosure instead of pinning
          16 numbers plus two glossary lines onto the page (P1-3).
        */}
        <div className="grid gap-4 lg:grid-cols-2">
          {projection.resources.map((resource) => (
            <section
              className="overflow-hidden rounded-lg bg-card px-4 py-5 shadow-sm ring-1 ring-foreground/10 sm:p-6"
              data-testid={`account-usage-card-${resource.resource}`}
              key={resource.resource}
            >
              <h3 className="text-sm font-medium text-muted-foreground">
                {RESOURCE_LABELS[resource.resource]()}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {account_usage_available()}
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                {resource.available}
              </p>
              {detailsOpen ? (
                <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2 border-t pt-4">
                  {(
                    [
                      [account_usage_reserved(), resource.reserved],
                      [account_usage_settled(), resource.settled],
                      [account_usage_released(), resource.released],
                    ] as const
                  ).map(([term, value]) => (
                    <div key={term}>
                      <dt className="truncate text-xs font-medium text-muted-foreground">
                        {term}
                      </dt>
                      <dd className="mt-1 text-base font-medium tabular-nums">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                {account_usage_allowance({ count: resource.allowance })}
              </p>
            </section>
          ))}
        </div>
        <Collapsible onOpenChange={setDetailsOpen} open={detailsOpen}>
          <CollapsibleTrigger
            className="flex min-h-touch-target items-center gap-2 text-sm font-medium underline underline-offset-4"
            data-testid="account-usage-details-toggle"
          >
            {detailsOpen
              ? account_usage_details_hide()
              : account_usage_details_show()}
            {detailsOpen ? (
              <IconChevronUp aria-hidden="true" className="size-4" />
            ) : (
              <IconChevronDown aria-hidden="true" className="size-4" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <p className="text-sm leading-6 text-muted-foreground">
              {account_usage_terms_explanation()}
            </p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
