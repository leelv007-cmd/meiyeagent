import { describe, expect, it } from 'vitest';
import { resolvePaymentRuntimePolicy } from './payment-runtime-policy';

describe('payment runtime policy', () => {
  it('keeps Stripe webhook runtime enabled without publishing prices', () => {
    expect(
      resolvePaymentRuntimePolicy({
        provider: 'stripe',
      })
    ).toEqual({
      enabled: true,
      provider: 'stripe',
      priceIds: {
        growthMonthly: '',
        growthSingleMonth: '',
        growthYearly: '',
        proMonthly: '',
        proSingleMonth: '',
        proYearly: '',
        lifetime: '',
        starterMonthly: '',
        starterSingleMonth: '',
        starterYearly: '',
      },
    });
  });

  it('keeps payment disabled without a provider', () => {
    expect(
      resolvePaymentRuntimePolicy({
        provider: '',
      })
    ).toEqual({
      enabled: false,
      provider: undefined,
      priceIds: {
        growthMonthly: '',
        growthSingleMonth: '',
        growthYearly: '',
        proMonthly: '',
        proSingleMonth: '',
        proYearly: '',
        lifetime: '',
        starterMonthly: '',
        starterSingleMonth: '',
        starterYearly: '',
      },
    });
  });
});
