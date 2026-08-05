import {
  pricing_billing_cycle_label,
  pricing_billing_cycle_monthly,
  pricing_billing_cycle_single_month,
  pricing_billing_cycle_yearly,
  pricing_booster_buy,
  pricing_booster_description,
  pricing_booster_expire_days,
  pricing_booster_heading,
  pricing_booster_login_to_buy,
  pricing_card_credits_monthly,
  pricing_card_credits_trial,
  pricing_output_plan_growth,
  pricing_output_plan_pro,
  pricing_output_plan_starter,
  pricing_output_plan_trial,
  pricing_plan_login_to_subscribe,
  pricing_plan_payment_not_open,
  pricing_plan_payment_not_open_hint,
  pricing_plan_purchase_unavailable,
  pricing_plan_purchase_unavailable_hint,
  pricing_plan_recommended,
  pricing_plan_subscribe,
  pricing_reference_disclaimer,
  pricing_reference_estimate,
  pricing_trial_no_purchase,
} from '@/locale/paraglide/messages';
import {
  CheckoutButton,
  CreditPackageCheckoutButton,
} from '@/components/pricing/create-checkout-button';
import {
  formatPublishedPrice,
  planPriceForCycle,
  publishedReferenceOutputs,
  type PricingBillingCycle,
} from '@/components/pricing/credit-pricing-model';
import { Button, buttonVariants } from '@/components/ui/button';
import { websiteConfig } from '@/config/website';
import {
  findSubscriptionPrice,
  PUBLIC_PAID_MONTHLY_PRICE_TESTID,
} from '@/lib/price-plan';
import { Routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { getLocale } from '@/locale/paraglide/runtime';
import { PlanIntervals } from '@/payment/types';
import type { PublicPlanCatalog, PublicPlanOffer } from '@meiye/contracts';
import { IconSparkles } from '@tabler/icons-react';
import { useMemo, useState } from 'react';

const BILLING_CYCLES: Array<{
  cycle: PricingBillingCycle;
  label: () => string;
}> = [
  {
    cycle: 'single_month',
    label: pricing_billing_cycle_single_month,
  },
  {
    cycle: 'monthly',
    label: pricing_billing_cycle_monthly,
  },
  {
    cycle: 'yearly',
    label: pricing_billing_cycle_yearly,
  },
];

const CYCLE_TO_PLAN_INTERVAL = {
  single_month: PlanIntervals.SINGLE_MONTH,
  monthly: PlanIntervals.MONTHLY,
  yearly: PlanIntervals.YEARLY,
} as const;

const PLAN_NAME: Record<PublicPlanOffer['id'], () => string> = {
  trial: pricing_output_plan_trial,
  starter: pricing_output_plan_starter,
  growth: pricing_output_plan_growth,
  pro: pricing_output_plan_pro,
};

export function CreditPricingContent({
  catalog,
  isAuthenticated,
  userId,
}: {
  catalog: PublicPlanCatalog;
  isAuthenticated: boolean;
  userId?: string;
}) {
  const [cycle, setCycle] = useState<PricingBillingCycle>('monthly');
  const locale = getLocale() === 'zh' ? 'zh-HK' : 'en-US';
  const paymentEnabled = websiteConfig.payment?.enable === true;
  const plans = useMemo(
    () =>
      (['trial', 'starter', 'growth', 'pro'] as const)
        .map((id) => catalog.plans.find((plan) => plan.id === id))
        .filter((plan): plan is PublicPlanOffer => plan != null),
    [catalog.plans]
  );

  return (
    <div className="space-y-10">
      <section
        aria-label={pricing_billing_cycle_label()}
        className="flex flex-wrap items-center justify-center gap-2"
      >
        {BILLING_CYCLES.map((option) => {
          const selected = option.cycle === cycle;
          return (
            <Button
              key={option.cycle}
              type="button"
              variant={selected ? 'default' : 'outline'}
              aria-pressed={selected}
              data-testid={`pricing-cycle-${option.cycle}`}
              onClick={() => setCycle(option.cycle)}
            >
              {option.label()}
            </Button>
          );
        })}
      </section>

      <section
        id="subscription-plans"
        data-testid="pricing-subscription-plans"
        className="scroll-mt-24"
      >
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              cycle={cycle}
              locale={locale}
              isAuthenticated={isAuthenticated}
              paymentEnabled={paymentEnabled}
              userId={userId}
            />
          ))}
        </div>
      </section>

      <section
        id="credit-boosters"
        data-testid="pricing-credit-boosters"
        className="scroll-mt-24 space-y-4 rounded-3xl border bg-card p-6 text-card-foreground"
      >
        <div className="space-y-1 text-center md:text-left">
          <h2 className="text-xl font-semibold">{pricing_booster_heading()}</h2>
          <p className="text-sm text-muted-foreground">
            {pricing_booster_description()}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {catalog.addOns.map((addon) => (
            <article
              key={addon.id}
              className="flex flex-col gap-3 rounded-2xl border p-4"
              data-testid={`pricing-booster-${addon.id}`}
            >
              <div className="space-y-1">
                <p className="text-2xl font-semibold tabular-nums">
                  {addon.credits}
                </p>
                <p className="text-lg font-medium tabular-nums">
                  {formatPublishedPrice(
                    addon.amountMicros,
                    addon.currency,
                    locale
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {pricing_booster_expire_days({
                    days: String(addon.expireDays),
                  })}
                </p>
              </div>
              <div className="mt-auto">
                {isAuthenticated ? (
                  <CreditPackageCheckoutButton
                    offerId={addon.id}
                    className="w-full"
                    data-testid={`pricing-booster-checkout-${addon.id}`}
                  >
                    {pricing_booster_buy()}
                  </CreditPackageCheckoutButton>
                ) : (
                  <a
                    href={Routes.Login}
                    className={cn(
                      buttonVariants({ variant: 'outline' }),
                      'w-full'
                    )}
                  >
                    {pricing_booster_login_to_buy()}
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  cycle,
  locale,
  isAuthenticated,
  paymentEnabled,
  userId,
}: {
  plan: PublicPlanOffer;
  cycle: PricingBillingCycle;
  locale: string;
  isAuthenticated: boolean;
  paymentEnabled: boolean;
  userId?: string;
}) {
  const recommended = plan.id === 'growth';
  const priced = planPriceForCycle(plan, cycle);
  const references = publishedReferenceOutputs(plan);
  const showOriginal =
    plan.monthlyPriceMicros > 0 &&
    priced.originalAmountMicros > priced.amountMicros;

  const planName = PLAN_NAME[plan.id]();
  const creditsSuffix =
    plan.id === 'trial' || plan.monthlyPriceMicros === 0
      ? pricing_card_credits_trial()
      : pricing_card_credits_monthly();

  return (
    <section
      aria-label={planName}
      className={cn(
        'flex h-full flex-col gap-5 rounded-3xl border bg-card p-6 text-card-foreground',
        recommended && 'ring-1 ring-[color:var(--spark)]'
      )}
      data-testid={`pricing-plan-card-${plan.id}`}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">{planName}</h3>
          {recommended ? (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
              style={{
                background: 'var(--spark-wash)',
                color: 'var(--spark-deep)',
              }}
            >
              <IconSparkles className="size-3.5" aria-hidden />
              {pricing_plan_recommended()}
            </span>
          ) : null}
        </div>

        <p
          className="text-3xl font-semibold tabular-nums tracking-tight"
          data-testid={`pricing-credits-${plan.id}`}
        >
          {plan.credits}
          <span className="ml-1 text-base font-medium text-muted-foreground">
            {creditsSuffix}
          </span>
        </p>

        <div className="space-y-1">
          <p
            className="text-2xl font-semibold tabular-nums"
            data-testid={`pricing-price-${plan.id}`}
          >
            {plan.monthlyPriceMicros === 0 && priced.amountMicros === 0
              ? '—'
              : formatPublishedPrice(
                  priced.amountMicros,
                  plan.currency,
                  locale
                )}
          </p>
          {/*
            The same handle the landing hangs on its quoted month price (#242),
            so a browser can read "the paid tier's monthly price" off both
            public surfaces without knowing how either lays it out.

            Conditional on purpose. It belongs to one plan — the self-serve
            paid tier the landing quotes — and only while this card is showing
            a monthly figure; under the yearly cycle the number beside it is a
            year's price, and answering "the month price" with it would be the
            kind of quiet mismatch this handle exists to catch. #310 dropped
            the handle when it moved these cards onto the published catalog,
            which left the cross-surface guard reading zero elements and
            passing nothing (#346).
          */}
          {plan.id === 'growth' && cycle === 'monthly' ? (
            <span
              className="sr-only"
              data-testid={PUBLIC_PAID_MONTHLY_PRICE_TESTID}
            >
              {formatPublishedPrice(priced.amountMicros, plan.currency, locale)}
            </span>
          ) : null}
          {showOriginal ? (
            <p
              className="text-sm text-muted-foreground line-through tabular-nums"
              data-testid={`pricing-original-${plan.id}`}
            >
              {formatPublishedPrice(
                priced.originalAmountMicros,
                plan.currency,
                locale
              )}
            </p>
          ) : null}
        </div>
      </div>

      <p
        className="text-sm text-muted-foreground"
        data-testid={`pricing-reference-${plan.id}`}
      >
        {pricing_reference_estimate({
          copy: String(references.copy),
          image: String(references.image),
          video: String(references.video),
        })}
        <span className="mt-1 block text-xs">
          {pricing_reference_disclaimer()}
        </span>
      </p>

      <div className="mt-auto">
        <PlanCheckoutCta
          plan={plan}
          cycle={cycle}
          isAuthenticated={isAuthenticated}
          paymentEnabled={paymentEnabled}
          userId={userId}
        />
      </div>
    </section>
  );
}

function PlanCheckoutCta({
  plan,
  cycle,
  isAuthenticated,
  paymentEnabled,
  userId,
}: {
  plan: PublicPlanOffer;
  cycle: PricingBillingCycle;
  isAuthenticated: boolean;
  paymentEnabled: boolean;
  userId?: string;
}) {
  if (plan.id === 'trial' || plan.monthlyPriceMicros === 0) {
    return (
      <Button variant="outline" className="w-full" disabled>
        {pricing_trial_no_purchase()}
      </Button>
    );
  }

  if (!paymentEnabled) {
    return (
      <div className="space-y-2">
        <Button variant="secondary" className="w-full" disabled>
          {pricing_plan_payment_not_open()}
        </Button>
        <p className="text-xs text-muted-foreground">
          {pricing_plan_payment_not_open_hint()}
        </p>
      </div>
    );
  }

  const price = findSubscriptionPrice(plan.id, CYCLE_TO_PLAN_INTERVAL[cycle]);
  if (!price?.priceId?.trim()) {
    return (
      <div className="space-y-2">
        <Button variant="secondary" className="w-full" disabled>
          {pricing_plan_purchase_unavailable()}
        </Button>
        <p className="text-xs text-muted-foreground">
          {pricing_plan_purchase_unavailable_hint()}
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <a
        href={Routes.Login}
        className={cn(buttonVariants({ variant: 'default' }), 'w-full')}
      >
        {pricing_plan_login_to_subscribe()}
      </a>
    );
  }

  return (
    <CheckoutButton
      planId={plan.id}
      priceId={price.priceId}
      metadata={userId ? { userId } : undefined}
      data-testid={`pricing-checkout-${plan.id}-${cycle}`}
      className="w-full"
    >
      {pricing_plan_subscribe()}
    </CheckoutButton>
  );
}
