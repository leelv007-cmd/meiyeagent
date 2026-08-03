import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePaymentRuntimePolicy } from '@/config/payment-runtime-policy';

const waffoProducts = {
  growthMonthly: 'PROD_GROWTH_MONTHLY',
  growthSingleMonth: 'PROD_GROWTH_SINGLE',
  growthYearly: 'PROD_GROWTH_YEARLY',
  proMonthly: 'PROD_PRO_MONTHLY',
  proSingleMonth: 'PROD_PRO_SINGLE',
  proYearly: 'PROD_PRO_YEARLY',
  starterMonthly: 'PROD_STARTER_MONTHLY',
  starterSingleMonth: 'PROD_STARTER_SINGLE',
  starterYearly: 'PROD_STARTER_YEARLY',
};

test('Waffo only enables a complete three-tier, three-period catalog', () => {
  assert.deepEqual(
    resolvePaymentRuntimePolicy({
      creemPriceIds: {},
      provider: 'waffo',
      publicPaidLaunchEnabled: true,
      waffoProductIds: waffoProducts,
    }),
    {
      enabled: true,
      priceIds: {
        ...waffoProducts,
        lifetime: '',
      },
      provider: 'waffo',
    }
  );

  assert.equal(
    resolvePaymentRuntimePolicy({
      creemPriceIds: {},
      provider: 'waffo',
      publicPaidLaunchEnabled: true,
      waffoProductIds: { ...waffoProducts, proYearly: '' },
    }).enabled,
    false
  );
});
