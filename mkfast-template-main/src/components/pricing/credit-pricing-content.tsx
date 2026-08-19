import {
  pricing_billing_cycle_label,
  pricing_billing_cycle_monthly,
  pricing_billing_cycle_single_month,
  pricing_billing_cycle_yearly,
  pricing_booster_buy,
  pricing_booster_credits,
  pricing_booster_description,
  pricing_booster_expire_days,
  pricing_booster_heading,
  pricing_booster_login_to_buy,
  pricing_card_credits_monthly,
  pricing_card_credits_trial,
  pricing_card_price_free,
  pricing_plan_login_to_subscribe,
  pricing_plan_notify_me,
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
  PLAN_NAME,
  planPriceForCycle,
  publishedReferenceOutputs,
  type PricingBillingCycle,
} from '@/components/pricing/credit-pricing-model';
import { Button, buttonVariants } from '@/components/ui/button';
import { PUBLIC_PAID_MONTHLY_PRICE_TESTID } from '@/lib/price-plan';
import { Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';
import { cn } from '@/lib/utils';
import { getLocale } from '@/locale/paraglide/runtime';
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

export function CreditPricingContent({
  catalog,
  commerceReadiness,
  isAuthenticated,
  userId,
}: {
  catalog: PublicPlanCatalog;
  commerceReadiness: {
    addOnCheckout: boolean;
    planCheckout: boolean;
  };
  isAuthenticated: boolean;
  userId?: string;
}) {
  const [cycle, setCycle] = useState<PricingBillingCycle>('monthly');
  const locale = getLocale() === 'zh' ? 'zh-HK' : 'en-US';
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
              addOnCheckoutReady={commerceReadiness.addOnCheckout}
              isAuthenticated={isAuthenticated}
              planCheckoutReady={commerceReadiness.planCheckout}
              userId={userId}
            />
          ))}
        </div>
      </section>

      {/*
        Packs used to be three bordered cards inside this panel's own card —
        card-in-card, and three more purchase decisions competing at the same
        weight as the four plans above. Every SKU is still here (the catalog
        owns them), but the band is now one surface: a divider-separated list,
        smaller type, no per-pack card. Plans are the decision; a pack is what
        you reach for once you already have one.
      */}
      <section
        id="credit-boosters"
        data-testid="pricing-credit-boosters"
        className="scroll-mt-24 rounded-2xl border bg-card px-5 py-4 text-card-foreground"
      >
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold">
            {pricing_booster_heading()}
          </h2>
          <p className="text-sm text-muted-foreground">
            {pricing_booster_description()}
          </p>
        </div>
        <ul className="mt-3 divide-y border-t">
          {catalog.addOns.map((addon) => (
            <li
              key={addon.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
              data-testid={`pricing-booster-${addon.id}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="font-medium tabular-nums">
                  {pricing_booster_credits({ credits: String(addon.credits) })}
                </span>
                <span className="font-medium tabular-nums">
                  {formatPublishedPrice(
                    addon.amountMicros,
                    addon.currency,
                    locale
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {pricing_booster_expire_days({
                    days: String(addon.expireDays),
                  })}
                </span>
              </div>
              {commerceReadiness.addOnCheckout ? (
                isAuthenticated ? (
                  <CreditPackageCheckoutButton
                    offerId={addon.id}
                    ready
                    data-testid={`pricing-booster-checkout-${addon.id}`}
                  >
                    {pricing_booster_buy()}
                  </CreditPackageCheckoutButton>
                ) : (
                  <a
                    href={Routes.Login}
                    className={cn(buttonVariants({ variant: 'outline' }))}
                  >
                    {pricing_booster_login_to_buy()}
                  </a>
                )
              ) : null}
            </li>
          ))}
        </ul>
        {!commerceReadiness.addOnCheckout ? (
          <div className="mt-3">
            <CommerceUnavailableExit
              hint={pricing_plan_purchase_unavailable_hint()}
              label={pricing_plan_purchase_unavailable()}
              notifyHref={getPathWithLocale(Routes.Contact)}
              notifyTestId="pricing-notify-addon"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  cycle,
  locale,
  addOnCheckoutReady,
  isAuthenticated,
  planCheckoutReady,
  userId,
}: {
  plan: PublicPlanOffer;
  cycle: PricingBillingCycle;
  locale: string;
  addOnCheckoutReady: boolean;
  isAuthenticated: boolean;
  planCheckoutReady: boolean;
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
          {/* Plan cards hang straight off the page h1 with no group heading in
              between, so the card name is an h2. Size still comes from
              text-lg — this changes rank, not looks. */}
          <h2 className="text-lg font-semibold">{planName}</h2>
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
            {/*
              A bare em dash in the price slot reads as a missing number rather
              than as a price — worst on a phone, where it is one stroke alone
              on a line. The free tier does have an answer to "what does it
              cost", and this is it.
            */}
            {plan.monthlyPriceMicros === 0 && priced.amountMicros === 0
              ? pricing_card_price_free()
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
          addOnCheckoutReady={addOnCheckoutReady}
          isAuthenticated={isAuthenticated}
          planCheckoutReady={planCheckoutReady}
          userId={userId}
        />
      </div>
    </section>
  );
}

function PlanCheckoutCta({
  plan,
  cycle,
  addOnCheckoutReady,
  isAuthenticated,
  planCheckoutReady,
  userId,
}: {
  plan: PublicPlanOffer;
  cycle: PricingBillingCycle;
  addOnCheckoutReady: boolean;
  isAuthenticated: boolean;
  planCheckoutReady: boolean;
  userId?: string;
}) {
  if (plan.id === 'trial' || plan.monthlyPriceMicros === 0) {
    return (
      <Button variant="outline" className="w-full" disabled>
        {pricing_trial_no_purchase()}
      </Button>
    );
  }

  if (!planCheckoutReady) {
    // The subscription channel really is closed, so the plan button stays
    // disabled and honest. What was missing is the other half: the hint under
    // it promised to tell her the moment it opens and gave her nothing to
    // press, so the promise had no way to come true. This link carries the plan
    // she was reading over to /contact, which names it back to her. A plain
    // anchor rather than a Link: this module is rendered outside a router by
    // the public-pricing contract test.
    //
    // CREDIT-01B: do not promise add-on packs when that channel is also closed.
    return (
      <CommerceUnavailableExit
        hint={
          addOnCheckoutReady
            ? pricing_plan_payment_not_open_hint()
            : pricing_plan_purchase_unavailable_hint()
        }
        label={pricing_plan_payment_not_open()}
        notifyHref={getPathWithLocale(`${Routes.Contact}?plan=${plan.id}`)}
        notifyTestId={`pricing-notify-${plan.id}`}
      />
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
      cycle={cycle}
      metadata={userId ? { userId } : undefined}
      ready
      data-testid={`pricing-checkout-${plan.id}-${cycle}`}
      className="w-full"
    >
      {pricing_plan_subscribe()}
    </CheckoutButton>
  );
}

function CommerceUnavailableExit({
  hint,
  label,
  notifyHref,
  notifyTestId,
}: {
  hint: string;
  label: string;
  notifyHref: string;
  notifyTestId: string;
}) {
  return (
    <div className="space-y-2" data-testid="commerce-unavailable-exit">
      <Button variant="secondary" className="w-full" disabled>
        {label}
      </Button>
      <a
        className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
        data-testid={notifyTestId}
        href={notifyHref}
      >
        {pricing_plan_notify_me()}
      </a>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
