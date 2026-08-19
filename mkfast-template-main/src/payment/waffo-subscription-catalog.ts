import type { PlanInterval } from '@/payment/types';

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
};

/**
 * The complete sellable Waffo subscription catalog. A single-month purchase
 * uses a monthly Waffo product, then gets cancelled at period end after its
 * activation webhook settles; it must never become a separate trial product.
 *
 * Prices deliberately do not live here. Core's published `plan.credits.*`
 * revision owns amounts; this list owns only the provider identity shape.
 */
export const WAFFO_SUBSCRIPTION_PRODUCTS: readonly WaffoSubscriptionProduct[] =
  [
    product('starter', 'single_month'),
    product('starter', 'monthly'),
    product('starter', 'yearly'),
    product('growth', 'single_month'),
    product('growth', 'monthly'),
    product('growth', 'yearly'),
    product('pro', 'single_month'),
    product('pro', 'monthly'),
    product('pro', 'yearly'),
  ];

function product(
  planId: WaffoSubscriptionPlanId,
  interval: WaffoSubscriptionProduct['interval']
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
  };
}
