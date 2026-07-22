import { describe, expect, it } from 'vitest';
import { resolvePaymentRuntimePolicy } from './payment-runtime-policy';

describe('payment runtime policy', () => {
  it('keeps Stripe webhook runtime enabled without publishing prices', () => {
    expect(
      resolvePaymentRuntimePolicy({
        provider: 'stripe',
        publicPaidLaunchEnabled: true,
        creemPriceIds: {
          proMonthly: 'must_not_publish',
          proYearly: 'must_not_publish',
          lifetime: 'must_not_publish',
        },
      })
    ).toEqual({
      enabled: true,
      provider: 'stripe',
      priceIds: { proMonthly: '', proYearly: '', lifetime: '' },
    });
  });

  it('publishes Creem prices only for an explicit paid launch', () => {
    expect(
      resolvePaymentRuntimePolicy({
        provider: 'creem',
        publicPaidLaunchEnabled: true,
        creemPriceIds: {
          proMonthly: 'creem_monthly',
          proYearly: 'creem_yearly',
          lifetime: 'creem_lifetime',
        },
      })
    ).toEqual({
      enabled: true,
      provider: 'creem',
      priceIds: {
        proMonthly: 'creem_monthly',
        proYearly: 'creem_yearly',
        lifetime: 'creem_lifetime',
      },
    });
  });

  it.each([
    { provider: 'creem' as const, publicPaidLaunchEnabled: false },
    { provider: '' as const, publicPaidLaunchEnabled: true },
  ])('disables unsupported runtime input %#', (input) => {
    expect(
      resolvePaymentRuntimePolicy({
        ...input,
        creemPriceIds: {
          proMonthly: 'must_not_publish',
          proYearly: 'must_not_publish',
          lifetime: 'must_not_publish',
        },
      })
    ).toEqual({
      enabled: false,
      provider: undefined,
      priceIds: { proMonthly: '', proYearly: '', lifetime: '' },
    });
  });
});
