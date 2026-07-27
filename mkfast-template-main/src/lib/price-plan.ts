import { websiteConfig } from '@/config/website';
import { PaymentTypes, PlanIntervals } from '@/payment/types';
import type { Price, PricePlan } from '@/payment/types';

/** The self-serve paid tier both public surfaces quote (D-143). */
export const GROWTH_CONFIG_PLAN_ID = 'pro';

export function findSubscriptionPrice(
  configPlanId: string | undefined,
  interval: (typeof PlanIntervals)[keyof typeof PlanIntervals]
): Price | undefined {
  if (!configPlanId) return undefined;
  const plan = getPricePlans()[configPlanId];
  return plan?.prices?.find(
    (p) => p.type === PaymentTypes.SUBSCRIPTION && p.interval === interval
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
