import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WAFFO_SUBSCRIPTION_PRODUCTS,
  waffoSubscriptionPricesForPlan,
} from './waffo-subscription-catalog';

test('Waffo catalog has only the nine paid tier-period subscription products', () => {
  assert.equal(WAFFO_SUBSCRIPTION_PRODUCTS.length, 9);
  assert.deepEqual(
    WAFFO_SUBSCRIPTION_PRODUCTS.map((product) => product.planId),
    [
      'starter',
      'starter',
      'starter',
      'growth',
      'growth',
      'growth',
      'pro',
      'pro',
      'pro',
    ]
  );
  assert.deepEqual(
    WAFFO_SUBSCRIPTION_PRODUCTS.map((product) => product.interval),
    [
      'single_month',
      'monthly',
      'yearly',
      'single_month',
      'monthly',
      'yearly',
      'single_month',
      'monthly',
      'yearly',
    ]
  );
  assert.deepEqual(
    WAFFO_SUBSCRIPTION_PRODUCTS.map((product) => ({
      amount: product.amount,
      currency: product.currency,
      interval: product.interval,
      planId: product.planId,
    })),
    [
      { amount: 23_100, currency: 'HKD', interval: 'single_month', planId: 'starter' },
      { amount: 20_800, currency: 'HKD', interval: 'monthly', planId: 'starter' },
      { amount: 208_100, currency: 'HKD', interval: 'yearly', planId: 'starter' },
      { amount: 58_000, currency: 'HKD', interval: 'single_month', planId: 'growth' },
      { amount: 52_200, currency: 'HKD', interval: 'monthly', planId: 'growth' },
      { amount: 521_700, currency: 'HKD', interval: 'yearly', planId: 'growth' },
      { amount: 104_400, currency: 'HKD', interval: 'single_month', planId: 'pro' },
      { amount: 94_000, currency: 'HKD', interval: 'monthly', planId: 'pro' },
      { amount: 940_000, currency: 'HKD', interval: 'yearly', planId: 'pro' },
    ]
  );
  assert.deepEqual(
    waffoSubscriptionPricesForPlan('growth', {
      growthMonthly: 'PROD_GROWTH_MONTHLY_HKD',
    }),
    [
      {
        amount: 58_000,
        currency: 'HKD',
        interval: 'single_month',
        priceId: '',
        type: 'subscription',
      },
      {
        amount: 52_200,
        currency: 'HKD',
        interval: 'monthly',
        priceId: 'PROD_GROWTH_MONTHLY_HKD',
        type: 'subscription',
      },
      {
        amount: 521_700,
        currency: 'HKD',
        interval: 'yearly',
        priceId: '',
        type: 'subscription',
      },
    ]
  );
});
