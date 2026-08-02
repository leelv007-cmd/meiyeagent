import type { MerchantCreditDetail } from '@meiye/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  credit_billing_manage,
  credit_billing_no_active_subscription,
  credit_billing_period_ends,
  credit_billing_plan_growth,
  credit_billing_plan_pro,
  credit_billing_plan_starter,
  credit_billing_plan_trial,
  credit_billing_retry,
  credit_billing_title,
} from '@/locale/paraglide/messages';
import { formatLocaleDate } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { Link } from '@tanstack/react-router';
import { IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';

const cardClass = 'w-full overflow-hidden';
const footerClass = 'flex justify-end bg-muted px-6 py-4';

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
  const query = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'credit_detail'),
    queryFn: ({ signal }) =>
      queryP1<MerchantCreditDetail>(
        'entitlements',
        { action: 'credit_detail', payload: {} },
        signal
      ),
  });

  if (query.isPending) {
    return (
      <Card className={cardClass} data-testid="credit-billing-card-loading">
        <CardHeader>
          <CardTitle>{credit_billing_title()}</CardTitle>
          <CardDescription>{credit_billing_description()}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
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
    <Card className={cardClass} data-testid="credit-billing-card">
      <CardHeader>
        <CardTitle>{credit_billing_title()}</CardTitle>
        <CardDescription>{credit_billing_description()}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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
      </CardContent>
      <CardFooter className={footerClass}>
        <Link
          className={buttonVariants({ variant: 'default' })}
          to={Routes.Pricing}
        >
          {credit_billing_manage()}
        </Link>
      </CardFooter>
    </Card>
  );
}
