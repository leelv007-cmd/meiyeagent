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
  currency: 'HKD';
};

export type WaffoProductIds = Partial<Record<WaffoProductIdKey, string>>;

/**
 * The complete sellable Waffo subscription catalog. A single-month purchase
 * uses a monthly Waffo product, then gets cancelled at period end after its
 * activation webhook settles; it must never become a separate trial product.
 *
 * HKD launch prices are fixed values, not a runtime FX conversion. Their ECB
 * source date, cross-rate, and nearest-integer rounding rule are recorded in
 * docs/ops/waffo-hkd-launch-pricing-2026-08-03.md.
 */
export const WAFFO_SUBSCRIPTION_PRODUCTS: readonly WaffoSubscriptionProduct[] =
  [
    product('starter', 'single_month', 23_100),
    product('starter', 'monthly', 20_800),
    product('starter', 'yearly', 208_100),
    product('growth', 'single_month', 58_000),
    product('growth', 'monthly', 52_200),
    product('growth', 'yearly', 521_700),
    product('pro', 'single_month', 104_400),
    product('pro', 'monthly', 94_000),
    product('pro', 'yearly', 940_000),
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
    currency: 'HKD',
  };
}
