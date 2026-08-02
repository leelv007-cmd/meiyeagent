import { websiteConfig } from '@/config/website';
import { PaymentTypes, PlanIntervals } from '@/payment/types';
import type { Price, PricePlan } from '@/payment/types';

/**
 * Which payment-config plan backs each public plan offer (D-143).
 *
 * This mapping is the seam where the two public surfaces could disagree: the
 * landing quotes the paid tier through `growthMonthlyPriceLabel()` while
 * /pricing prices its own cards. When /pricing kept its own `configPlanId:
 * 'pro'` literal, repointing that one row at a different product silently made
 * the two pages quote different prices for the same plan. One mapping, read by
 * both, means repointing a tier moves both pages together or not at all.
 */
export const PUBLIC_PLAN_CONFIG_IDS = {
  starter: 'free',
  growth: 'pro',
} as const;

/** The self-serve paid tier both public surfaces quote (D-143). */
export const GROWTH_CONFIG_PLAN_ID = PUBLIC_PLAN_CONFIG_IDS.growth;

/**
 * The handle a browser uses to read the paid tier's monthly price (#242).
 *
 * The landing and /pricing lay the same number out completely differently, so
 * "did a visitor see the same price on both" had no way to be asked of the
 * rendered page — only of the source, and a source guard has no fixed point
 * against namespace imports or computed access. One testid, exported from the
 * module that owns the price, gives both surfaces the same handle and lets the
 * browser answer it directly.
 */
export const PUBLIC_PAID_MONTHLY_PRICE_TESTID = 'public-paid-monthly-price';

export function findSubscriptionPrice(
  configPlanId: string | undefined,
  interval: (typeof PlanIntervals)[keyof typeof PlanIntervals]
): Price | undefined {
  if (!configPlanId) return undefined;
  const plan = getPricePlans()[configPlanId];
  const exact = plan?.prices?.find(
    (p) => p.type === PaymentTypes.SUBSCRIPTION && p.interval === interval
  );
  if (exact) return exact;

  const canonicalInterval =
    interval === PlanIntervals.MONTH
      ? PlanIntervals.MONTHLY
      : interval === PlanIntervals.YEAR
        ? PlanIntervals.YEARLY
        : interval;
  return plan?.prices?.find(
    (p) =>
      p.type === PaymentTypes.SUBSCRIPTION && p.interval === canonicalInterval
  );
}

export function formatYuan(amountInCents: number): string {
  return `¥${Math.round(amountInCents / 100)}`;
}

/**
 * The one place a public surface reads the Growth monthly price from.
 *
 * The landing page used to carry its own ¥399 message while /pricing computed
 * ¥499 from the payment configuration — two public pages contradicting each
 * other about the same plan (D-143). Both now call this; there is no second
 * number to keep in step.
 */
export function growthMonthlyPriceLabel(): string | null {
  const monthly = findSubscriptionPrice(
    GROWTH_CONFIG_PLAN_ID,
    PlanIntervals.MONTH
  );
  return monthly ? formatYuan(monthly.amount) : null;
}

/**
 * Get price plans from website config
 */
export const getPricePlans = (): Record<string, PricePlan> => {
  return (websiteConfig.payment?.price?.plans ?? {}) as Record<
    string,
    PricePlan
  >;
};

/**
 * Get all price plans as an array
 */
export function getAllPricePlans(): PricePlan[] {
  return Object.values(getPricePlans());
}

/**
 * Get plan by plan ID
 */
export function findPlanByPlanId(planId: string): PricePlan | undefined {
  return getAllPricePlans().find((plan) => plan.id === planId);
}

/**
 * Find plan by price ID
 */
export function findPlanByPriceId(priceId: string): PricePlan | undefined {
  const plans = getAllPricePlans();
  for (const plan of plans) {
    const matchingPrice = plan.prices.find((p) => p.priceId === priceId);
    if (matchingPrice) return plan;
  }
  return undefined;
}

/**
 * Find price by price ID and plan ID
 */
export function findPriceInPlan(
  planId: string,
  priceId: string
): Price | undefined {
  const plan = findPlanByPlanId(planId);
  if (!plan) return undefined;
  return plan.prices.find((p) => p.priceId === priceId);
}
