import type { MerchantCreditDetail } from '@meiye/contracts';
import { IconRefresh } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { getCommerceReadiness } from '@/api/commerce-readiness';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CustomerPortalButton } from '@/components/pricing/customer-portal-button';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  SettingsRow,
  SettingsRowFooter,
  SettingsRowHeader,
} from '@/components/settings/settings-section';
import { Skeleton } from '@/components/ui/skeleton';
import {
  credit_billing_credits_this_period,
  credit_billing_current_plan,
  credit_billing_description,
  credit_billing_interval,
  credit_billing_interval_monthly,
  credit_billing_interval_single_month,
  credit_billing_interval_yearly,
  credit_billing_load_error,
  credit_billing_no_active_subscription,
  credit_billing_period_ends,
  credit_billing_plan_growth,
  credit_billing_plan_pro,
  credit_billing_plan_starter,
  credit_billing_plan_trial,
  credit_billing_retry,
  credit_billing_title,
  credit_billing_renew,
  credit_billing_upgrade,
} from '@/locale/paraglide/messages';
import { formatLocaleDate } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import { useMerchantCreditDetail } from '@/product/use-merchant-credit-detail';

const PLAN_LABELS: Record<
  NonNullable<MerchantCreditDetail['billing']>['tier'],
  () => string
> = {
  growth: credit_billing_plan_growth,
  pro: credit_billing_plan_pro,
  starter: credit_billing_plan_starter,
  trial: credit_billing_plan_trial,
};

const INTERVAL_LABELS: Record<
  NonNullable<MerchantCreditDetail['billing']>['interval'],
  () => string
> = {
  monthly: credit_billing_interval_monthly,
  single_month: credit_billing_interval_single_month,
  yearly: credit_billing_interval_yearly,
};

/** Current subscription facts are read from the merchant-safe credit contract. */
export function BillingCard() {
  const query = useMerchantCreditDetail();
  const commerce = useQuery({
    queryFn: () => getCommerceReadiness(),
    queryKey: ['commerce-readiness'],
  });

  if (query.isPending) {
    return (
      <SettingsRow data-testid="credit-billing-card-loading">
        <SettingsRowHeader
          description={credit_billing_description()}
          title={credit_billing_title()}
        />
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-16 w-full" />
      </SettingsRow>
    );
  }

  if (query.error || !query.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{credit_billing_title()}</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          {credit_billing_load_error()}
          <Button
            onClick={() => void query.refetch()}
            size="sm"
            variant="outline"
          >
            <IconRefresh />
            {credit_billing_retry()}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const billing = query.data.billing;
  return (
    <SettingsRow data-testid="credit-billing-card">
      <SettingsRowHeader
        description={credit_billing_description()}
        title={credit_billing_title()}
      />
      <div className="space-y-3">
        {billing ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">
                {credit_billing_current_plan()}
              </dt>
              <dd className="mt-1 font-medium">
                {PLAN_LABELS[billing.tier]()}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {credit_billing_interval()}
              </dt>
              <dd className="mt-1 font-medium">
                {INTERVAL_LABELS[billing.interval]()}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {credit_billing_credits_this_period()}
              </dt>
              <dd className="mt-1 font-medium tabular-nums">
                {billing.creditsThisPeriod}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {credit_billing_period_ends()}
              </dt>
              <dd className="mt-1 font-medium">
                {formatLocaleDate(billing.periodEndsAt)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            {credit_billing_no_active_subscription()}
          </p>
        )}
      </div>
      {/*
        升级套餐 is the topbar's retired second pill, landed where it belongs:
        beside the plan it would change, on the page that answers「我还剩多少」.
      */}
      <SettingsRowFooter>
        <span className="flex flex-wrap gap-3">
          {billing ? (
            <CustomerPortalButton
              ready={Boolean(commerce.data?.ready.portal)}
              variant="outline"
            >
              {credit_billing_renew()}
            </CustomerPortalButton>
          ) : null}
          <Link
            className={buttonVariants({ variant: 'default' })}
            to={Routes.Pricing}
          >
            {credit_billing_upgrade()}
          </Link>
        </span>
      </SettingsRowFooter>
    </SettingsRow>
  );
}
