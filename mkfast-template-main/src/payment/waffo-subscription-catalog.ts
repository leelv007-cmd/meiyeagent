import type { PlanInterval, Price } from './types';

export type WaffoSubscriptionPlanId = 'starter' | 'growth' | 'pro';

export type WaffoProductIdKey =
  | 'starterSingleMonth'
  | 'starterMonthly'
  | 'starterYearly'
  | 'growthSingleMonth'
  | 'growthMonthly'
  | 'growthYearly'
  | 'proSingleMonth'
  | 'proMonthly'
  | 'proYearly';

export type WaffoSubscriptionProduct = {
  productIdKey: WaffoProductIdKey;
  planId: WaffoSubscriptionPlanId;
  interval: Extract<PlanInterval, 'single_month' | 'monthly' | 'yearly'>;
  billingPeriod: 'monthly' | 'yearly';
  amount: number;
  currency: 'CNY';
};

export type WaffoProductIds = Partial<Record<WaffoProductIdKey, string>>;

/**
 * The complete sellable Waffo subscription catalog. A single-month purchase
 * uses a monthly Waffo product, then gets cancelled at period end after its
 * activation webhook settles; it must never become a separate trial product.
 */
export const WAFFO_SUBSCRIPTION_PRODUCTS: readonly WaffoSubscriptionProduct[] =
  [
    product('starter', 'single_month', 19_900),
    product('starter', 'monthly', 17_910),
    product('starter', 'yearly', 179_100),
    product('growth', 'single_month', 49_900),
    product('growth', 'monthly', 44_910),
    product('growth', 'yearly', 449_100),
    product('pro', 'single_month', 89_900),
    product('pro', 'monthly', 80_910),
    product('pro', 'yearly', 809_100),
  ];

export function waffoSubscriptionPricesForPlan(
  planId: WaffoSubscriptionPlanId,
  productIds: WaffoProductIds
): Price[] {
  return WAFFO_SUBSCRIPTION_PRODUCTS.filter(
    (product) => product.planId === planId
  ).map((product) => ({
    type: 'subscription',
    priceId: productIds[product.productIdKey]?.trim() ?? '',
    amount: product.amount,
    currency: product.currency,
    interval: product.interval,
  }));
}

function product(
  planId: WaffoSubscriptionPlanId,
  interval: WaffoSubscriptionProduct['interval'],
  amount: number
): WaffoSubscriptionProduct {
  const intervalKey =
    interval === 'single_month'
      ? 'SingleMonth'
      : interval === 'monthly'
        ? 'Monthly'
        : 'Yearly';
  return {
    productIdKey: `${planId}${intervalKey}` as WaffoProductIdKey,
    planId,
    interval,
    billingPeriod: interval === 'yearly' ? 'yearly' : 'monthly',
    amount,
    currency: 'CNY',
  };
}
