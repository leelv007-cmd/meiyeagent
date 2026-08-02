import assert from 'node:assert/strict';
import test from 'node:test';
import { WAFFO_SUBSCRIPTION_PRODUCTS } from './waffo-subscription-catalog';

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
  assert.equal(
    WAFFO_SUBSCRIPTION_PRODUCTS.some((product) => product.planId === 'trial'),
    false
  );
});
