import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePaymentRuntimePolicy } from '@/config/payment-runtime-policy';

test('Waffo Test checkout requires its isolated public gate', () => {
  assert.equal(
    resolvePaymentRuntimePolicy({
      provider: 'waffo',
      waffoTestCheckoutEnabled: false,
    }).enabled,
    false
  );

  assert.deepEqual(
    resolvePaymentRuntimePolicy({
      provider: 'waffo',
      waffoTestCheckoutEnabled: true,
    }),
    {
      enabled: true,
      priceIds: {
        growthMonthly: '',
        growthSingleMonth: '',
        growthYearly: '',
        lifetime: '',
        proMonthly: '',
        proSingleMonth: '',
        proYearly: '',
        starterMonthly: '',
        starterSingleMonth: '',
        starterYearly: '',
      },
      provider: 'waffo',
    }
  );
});
