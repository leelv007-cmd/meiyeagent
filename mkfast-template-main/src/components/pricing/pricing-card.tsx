import {
  pricing_card_days_free_trial,
  pricing_card_free,
  pricing_card_get_lifetime_access,
  pricing_card_get_started,
  pricing_card_get_started_for_free,
  pricing_card_not_available,
  pricing_card_per_month,
  pricing_card_per_year,
  pricing_card_popular,
  pricing_card_your_current_plan,
  pricing_plan_login_to_subscribe,
  pricing_plan_payment_not_open,
  pricing_plan_payment_not_open_hint,
  pricing_plan_purchase_unavailable,
  pricing_plan_purchase_unavailable_hint,
} from '@/locale/paraglide/messages';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { authClient } from '@/auth/client';
import { websiteConfig } from '@/config/website';
import { formatPrice } from '@/lib/formatter';
import { cn } from '@/lib/utils';
import type {
  PaymentType,
  PlanInterval,
  Price,
  PricePlan,
} from '@/payment/types';
import { PlanIntervals, PaymentTypes } from '@/payment/types';
import { IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckoutButton } from './create-checkout-button';
import { Routes } from '@/lib/routes';
function getPriceForPlan(
  plan: PricePlan,
  interval?: PlanInterval,
  paymentType?: PaymentType
): Price | undefined {
  if (plan.isFree) return undefined;
  return plan.prices.find((p) => {
    if (paymentType === PaymentTypes.ONE_TIME)
      return p.type === PaymentTypes.ONE_TIME;
    return p.type === PaymentTypes.SUBSCRIPTION && p.interval === interval;
  });
}

function UnavailableCta({
  kind,
}: {
  kind: 'payment_not_open' | 'purchase_unavailable';
}) {
  const label =
    kind === 'payment_not_open'
      ? pricing_plan_payment_not_open()
      : pricing_plan_purchase_unavailable();
  const hint =
    kind === 'payment_not_open'
      ? pricing_plan_payment_not_open_hint()
      : pricing_plan_purchase_unavailable_hint();
  return (
    <div className="mt-4 space-y-2">
      <Button variant="secondary" className="w-full" disabled>
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

interface PricingCardProps {
  plan: PricePlan;
  interval?: PlanInterval;
  paymentType?: PaymentType;
  metadata?: Record<string, string>;
  className?: string;
  isCurrentPlan?: boolean;
}
export function PricingCard({
  plan,
  interval,
  paymentType,
  metadata,
  className,
  isCurrentPlan = false,
}: PricingCardProps) {
  const price = getPriceForPlan(plan, interval, paymentType);
  const { data: session } = authClient.useSession();
  const [mounted, setMounted] = useState(false);
  const currentUser = session?.user;
  const isAuthenticated = mounted && !!currentUser;
  const paymentEnabled = websiteConfig.payment?.enable === true;

  useEffect(() => {
    setMounted(true);
  }, []);

  let formattedPrice = '';
  let priceLabel = '';
  if (plan.isFree) {
    formattedPrice = pricing_card_free();
  } else if (price && price.amount > 0) {
    formattedPrice = formatPrice(price.amount, price.currency);
    if (interval === PlanIntervals.MONTH) priceLabel = pricing_card_per_month();
    else if (interval === PlanIntervals.YEAR)
      priceLabel = pricing_card_per_year();
  } else {
    // Price display only — CTAs use honest availability copy below.
    formattedPrice = pricing_card_not_available();
  }
  const isPaidPlan = !plan.isFree && !!price;
  const hasValidPriceId = !!price?.priceId?.trim();
  const hasTrialPeriod =
    price?.trialPeriodDays != null && price.trialPeriodDays > 0;

  function renderPaidCta() {
    // Availability mirrors /pricing: payment.enable + valid provider price id.
    if (!paymentEnabled) {
      return <UnavailableCta kind="payment_not_open" />;
    }
    if (!isPaidPlan || !price || !hasValidPriceId) {
      return <UnavailableCta kind="purchase_unavailable" />;
    }
    if (isAuthenticated) {
      return (
        <CheckoutButton
          planId={plan.id}
          priceId={price.priceId}
          metadata={metadata}
          className="mt-4 w-full"
        >
          {plan.isLifetime
            ? pricing_card_get_lifetime_access()
            : pricing_card_get_started()}
        </CheckoutButton>
      );
    }
    return (
      <Link
        to={Routes.Login}
        className={cn(buttonVariants({ variant: 'default' }), 'mt-4 w-full')}
      >
        {pricing_plan_login_to_subscribe()}
      </Link>
    );
  }

  return (
    <Card
      className={cn(
        'flex h-full flex-col',
        plan.popular && 'relative overflow-visible',
        className
      )}
    >
      {plan.popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 transform">
          <Badge
            variant="default"
            className="bg-[var(--spark-wash)] text-[var(--spark-deep)]"
          >
            {pricing_card_popular()}
          </Badge>
        </div>
      )}

      <CardHeader>
        <CardTitle>
          <h3 className="font-medium">{plan.name ?? plan.id}</h3>
        </CardTitle>
        <div className="flex items-baseline gap-2">
          <span className="my-4 block text-4xl font-semibold">
            {formattedPrice}
          </span>
          {priceLabel && <span className="text-2xl">{priceLabel}</span>}
        </div>
        <CardDescription>
          <p className="text-sm">{plan.description ?? ''}</p>
        </CardDescription>

        {plan.isFree ? (
          isAuthenticated ? (
            <Button variant="outline" className="mt-4 w-full" disabled>
              {pricing_card_get_started_for_free()}
            </Button>
          ) : (
            <Link
              to={Routes.Login}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'mt-4 w-full'
              )}
            >
              {pricing_card_get_started_for_free()}
            </Link>
          )
        ) : isCurrentPlan ? (
          <Button
            disabled
            className="mt-4 w-full border border-primary/20 bg-primary/10 text-primary hover:bg-primary/10 dark:border-primary/30 dark:bg-primary/15 dark:text-primary dark:hover:bg-primary/15"
          >
            {pricing_card_your_current_plan()}
          </Button>
        ) : (
          renderPaidCta()
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <hr className="border-dashed" />

        <ul className="list-outside space-y-4 text-sm">
          {plan.features?.map((feature, i) => (
            <li key={i} className="flex items-center gap-2">
              <IconCircleCheck className="size-4 text-chart-2" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <ul className="list-outside space-y-4 text-sm">
          {plan.limits?.map((limit, i) => (
            <li key={i} className="flex items-center gap-2">
              <IconCircleX className="size-4 text-muted-foreground" />
              <span>{limit}</span>
            </li>
          ))}
        </ul>

        {hasTrialPeriod && price && (
          <div className="my-4">
            <span className="inline-block rounded-md border border-chart-2/20 bg-chart-2/10 px-2.5 py-1.5 text-xs font-medium text-chart-2 shadow-sm dark:border-chart-2/30 dark:bg-chart-2/15 dark:text-chart-2">
              {price.trialPeriodDays} {pricing_card_days_free_trial()}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
