import {
  pricing_card_get_started_for_free,
  pricing_card_per_month,
  pricing_description,
  pricing_output_contact,
  pricing_output_copy_count,
  pricing_output_copy_label,
  pricing_output_description,
  pricing_output_heading,
  pricing_output_image_count,
  pricing_output_image_label,
  pricing_output_plan_growth,
  pricing_output_plan_pro,
  pricing_output_plan_starter,
  pricing_output_video_count,
  pricing_output_video_label,
  pricing_plan_concurrency_label,
  pricing_plan_login_to_subscribe,
  pricing_plan_payment_not_open,
  pricing_plan_payment_not_open_hint,
  pricing_plan_price_custom,
  pricing_plan_price_free,
  pricing_plan_purchase_unavailable,
  pricing_plan_purchase_unavailable_hint,
  pricing_plan_recommended,
  pricing_plan_subscribe,
  pricing_plan_subtitle,
  pricing_plan_yearly_hint,
  pricing_title,
} from '@/locale/paraglide/messages';
import { authClient } from '@/auth/client';
import Container from '@/components/layout/container';
import { CheckoutButton } from '@/components/pricing/create-checkout-button';
import { PricingShell } from '@/components/pricing/pricing-shell';
import { Button, buttonVariants } from '@/components/ui/button';
import { websiteConfig } from '@/config/website';
import { getPricePlans } from '@/lib/price-plan';
import { Routes } from '@/lib/routes';
import { seo } from '@/lib/seo';
import { cn } from '@/lib/utils';
import { PaymentTypes, PlanIntervals } from '@/payment/types';
import type { Price } from '@/payment/types';
import { IconSparkles } from '@tabler/icons-react';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/(pages)/pricing')({
  head: () =>
    seo('/pricing', {
      title: `${pricing_title()} | ${websiteConfig.metadata?.name}`,
      description: pricing_description(),
    }),
  component: PricingPage,
});

type PlanTier = 'free' | 'paid' | 'contact';

interface DisplayPlan {
  key: string;
  tier: PlanTier;
  /** config plan id backing this tier's price & checkout, when self-serve */
  configPlanId?: string;
  name: () => string;
  recommended?: boolean;
  quota: { copy: number; image: number; video: number; concurrency: number };
}

const DISPLAY_PLANS: DisplayPlan[] = [
  {
    key: 'starter',
    tier: 'free',
    configPlanId: 'free',
    name: pricing_output_plan_starter,
    quota: { copy: 30, image: 10, video: 5, concurrency: 1 },
  },
  {
    key: 'growth',
    tier: 'paid',
    configPlanId: 'pro',
    name: pricing_output_plan_growth,
    recommended: true,
    quota: { copy: 100, image: 40, video: 20, concurrency: 4 },
  },
  {
    key: 'pro',
    tier: 'contact',
    name: pricing_output_plan_pro,
    quota: { copy: 300, image: 120, video: 60, concurrency: 8 },
  },
];

function findSubscriptionPrice(
  configPlanId: string | undefined,
  interval: (typeof PlanIntervals)[keyof typeof PlanIntervals]
): Price | undefined {
  if (!configPlanId) return undefined;
  const plan = getPricePlans()[configPlanId];
  return plan?.prices?.find(
    (p) => p.type === PaymentTypes.SUBSCRIPTION && p.interval === interval
  );
}

function toYuan(amountInCents: number): string {
  return `¥${Math.round(amountInCents / 100)}`;
}

function PricingPage() {
  return (
    <PricingShell>
      <Container className="px-4 py-16">
        <div className="mx-auto max-w-6xl space-y-10">
          <header className="space-y-3 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              {pricing_title()}
            </h1>
            <p className="mx-auto max-w-2xl text-base text-muted-foreground">
              {pricing_plan_subtitle()}
            </p>
          </header>

          <section aria-labelledby="output-plan-heading">
            <h2 id="output-plan-heading" className="sr-only">
              {pricing_output_heading()}
            </h2>
            <div className="grid gap-6 md:grid-cols-3">
              {DISPLAY_PLANS.map((plan) => (
                <PlanCard key={plan.key} plan={plan} />
              ))}
            </div>
          </section>

          <p className="mx-auto max-w-2xl text-center text-sm text-muted-foreground">
            {pricing_output_description()}
          </p>
        </div>
      </Container>
    </PricingShell>
  );
}

function PlanCard({ plan }: { plan: DisplayPlan }) {
  return (
    <section
      aria-label={plan.name()}
      className={cn(
        'flex h-full flex-col gap-6 rounded-3xl border bg-card p-6 text-card-foreground md:p-7',
        plan.recommended && 'ring-1 ring-[color:var(--spark)]'
      )}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{plan.name()}</h2>
          {plan.recommended ? (
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
        <PlanPrice plan={plan} />
      </div>

      <PlanQuota quota={plan.quota} />

      <div className="mt-auto space-y-2">
        <PlanCta plan={plan} />
      </div>
    </section>
  );
}

function PlanPrice({ plan }: { plan: DisplayPlan }) {
  if (plan.tier === 'free') {
    return (
      <p className="text-3xl font-semibold">{pricing_plan_price_free()}</p>
    );
  }
  if (plan.tier === 'contact') {
    return (
      <p className="text-3xl font-semibold">{pricing_plan_price_custom()}</p>
    );
  }
  const monthly = findSubscriptionPrice(plan.configPlanId, PlanIntervals.MONTH);
  const yearly = findSubscriptionPrice(plan.configPlanId, PlanIntervals.YEAR);
  return (
    <div className="space-y-1">
      <p className="flex items-baseline gap-1">
        <span className="text-3xl font-semibold">
          {monthly ? toYuan(monthly.amount) : pricing_plan_price_custom()}
        </span>
        {monthly ? (
          <span className="text-base text-muted-foreground">
            {pricing_card_per_month()}
          </span>
        ) : null}
      </p>
      {yearly ? (
        <p className="text-xs text-muted-foreground">
          {pricing_plan_yearly_hint({
            amount: Math.round(yearly.amount / 100),
          })}
        </p>
      ) : null}
    </div>
  );
}

function PlanQuota({ quota }: { quota: DisplayPlan['quota'] }) {
  const rows: Array<{ label: string; value: string }> = [
    {
      label: pricing_output_copy_label(),
      value: pricing_output_copy_count({ count: quota.copy }),
    },
    {
      label: pricing_output_image_label(),
      value: pricing_output_image_count({ count: quota.image }),
    },
    {
      label: pricing_output_video_label(),
      value: pricing_output_video_count({ count: quota.video }),
    },
    {
      label: pricing_plan_concurrency_label(),
      value: String(quota.concurrency),
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="space-y-0.5">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="font-semibold text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlanCta({ plan }: { plan: DisplayPlan }) {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isAuthenticated = mounted && !!userId;

  if (plan.tier === 'contact') {
    return (
      <a
        href={Routes.Contact}
        className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
      >
        {pricing_output_contact()}
      </a>
    );
  }

  if (plan.tier === 'free') {
    if (isAuthenticated) {
      return (
        <Button variant="outline" className="w-full" disabled>
          {pricing_card_get_started_for_free()}
        </Button>
      );
    }
    return (
      <a
        href={Routes.Login}
        className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
      >
        {pricing_card_get_started_for_free()}
      </a>
    );
  }

  // Paid tier (Growth). Availability mirrors the real payment computation:
  // payment.enable + a valid provider price id. Never fake a working CTA.
  const monthly = findSubscriptionPrice(plan.configPlanId, PlanIntervals.MONTH);
  const paymentEnabled = websiteConfig.payment?.enable === true;
  const hasValidPriceId = !!monthly?.priceId?.trim();

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

  if (!hasValidPriceId || !monthly) {
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

  if (isAuthenticated) {
    return (
      <CheckoutButton
        planId={plan.configPlanId as string}
        priceId={monthly.priceId}
        metadata={userId ? { userId } : undefined}
        className="w-full"
      >
        {pricing_plan_subscribe()}
      </CheckoutButton>
    );
  }

  return (
    <a
      href={Routes.Login}
      className={cn(buttonVariants({ variant: 'default' }), 'w-full')}
    >
      {pricing_plan_login_to_subscribe()}
    </a>
  );
}
