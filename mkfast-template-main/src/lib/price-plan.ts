import { websiteConfig } from '@/config/website';
import { formatPrice } from '@/lib/formatter';
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
  growth: 'growth',
} as const;

/**
 * Where the paid tier sits when the Waffo catalog is not configured.
 *
 * The payment config ships two different catalogs. With Waffo configured it
 * carries the real sellable products — starter / growth / pro — and the paid
 * tier this module quotes is `growth`. Without it, the config keeps the
 * template's own plans, where the same tier is filed under `pro` and priced
 * from `PUBLIC_DISPLAY_PRICE_CENTS.growthMonthly`.
 *
 * `pro` is therefore two different things depending on the catalog, which is
 * why this is a fallback and not a second entry in the mapping above: under the
 * Waffo catalog `pro` is a genuinely higher tier with a price of its own, and
 * quoting it would put a wrong number on the landing rather than a missing one.
 */
const GROWTH_TEMPLATE_CONFIG_PLAN_ID = 'pro';

/**
 * The self-serve paid tier both public surfaces quote (D-143, #349).
 *
 * This was a constant reading `PUBLIC_PLAN_CONFIG_IDS.growth` until #349. That
 * made the landing's price depend on a plan key that only exists under one of
 * the two catalogs: `0c20d957` (#304) repointed the tier at `growth` for the
 * Waffo catalog, and every other runtime — Playwright pins
 * `VITE_PAYMENT_PROVIDER=stripe`, and a deployment may leave it unset — quietly
 * stopped resolving to any plan at all, so the landing printed its coming-soon
 * fallback where its only price belongs. Resolving against the catalog that is
 * actually configured is what makes the two cases one code path.
 *
 * Returns undefined only when neither key is configured, which is the one
 * situation where the public pages genuinely have no price to quote.
 */
export function growthConfigPlanId(): string | undefined {
  const plans = getPricePlans();
  if (plans[PUBLIC_PLAN_CONFIG_IDS.growth]) {
    return PUBLIC_PLAN_CONFIG_IDS.growth;
  }
  if (plans[GROWTH_TEMPLATE_CONFIG_PLAN_ID]) {
    return GROWTH_TEMPLATE_CONFIG_PLAN_ID;
  }
  return undefined;
}

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

export function formatSubscriptionPrice(
  price: Pick<Price, 'amount' | 'currency'>
): string {
  return formatPrice(price.amount, price.currency);
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
    growthConfigPlanId(),
    PlanIntervals.MONTH
  );
  return monthly ? formatSubscriptionPrice(monthly) : null;
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
