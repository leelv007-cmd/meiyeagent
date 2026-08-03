import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PricePlan } from './types';
import {
  createCheckoutInputSchema,
  requireWaffoTestCheckoutAuthority,
  portalInputSchema,
  requireSellableCheckoutPrice,
} from './checkout-policy';

const plans: PricePlan[] = [
  {
    id: 'growth',
    isFree: false,
    isLifetime: false,
    prices: [
      {
        amount: 49_900,
        currency: 'CNY',
        interval: 'month',
        priceId: 'prod_growth_month',
        type: 'subscription',
      },
      {
        amount: 499_000,
        currency: 'CNY',
        disabled: true,
        interval: 'year',
        priceId: 'prod_growth_year_retired',
        type: 'subscription',
      },
    ],
  },
  {
    disabled: true,
    id: 'lifetime',
    isFree: false,
    isLifetime: true,
    prices: [
      {
        amount: 699_000,
        currency: 'CNY',
        priceId: 'prod_lifetime',
        type: 'one_time',
      },
    ],
  },
];

const lookup = {
  findPlanByPlanId: (planId: string) =>
    plans.find((plan) => plan.id === planId),
  findPriceInPlan: (planId: string, priceId: string) =>
    plans
      .find((plan) => plan.id === planId)
      ?.prices.find((price) => price.priceId === priceId),
};

describe('public plan checkout policy', () => {
  it('requires Test authority for every Waffo checkout', () => {
    assert.doesNotThrow(() => requireWaffoTestCheckoutAuthority('test'));
    for (const authority of ['production', undefined, 'staging']) {
      assert.throws(
        () => requireWaffoTestCheckoutAuthority(authority),
        /WAFFO_ENVIRONMENT=test/u
      );
    }
  });

  it('returns the canonical sellable price for a matching plan and price', () => {
    const selection = requireSellableCheckoutPrice(
      { planId: 'growth', priceId: 'prod_growth_month' },
      lookup
    );

    assert.equal(selection.plan.id, 'growth');
    assert.equal(selection.price.priceId, 'prod_growth_month');
    assert.equal(selection.price.amount, 49_900);
  });

  it('rejects mismatched, disabled, and malformed amount contracts', () => {
    for (const input of [
      { planId: 'lifetime', priceId: 'prod_growth_month' },
      { planId: 'growth', priceId: 'prod_growth_year_retired' },
      { planId: 'lifetime', priceId: 'prod_lifetime' },
    ]) {
      assert.throws(() => requireSellableCheckoutPrice(input, lookup));
    }

    const invalidAmountLookup = {
      findPlanByPlanId: lookup.findPlanByPlanId,
      findPriceInPlan: () => ({
        amount: 0,
        currency: 'CNY',
        interval: 'month' as const,
        priceId: 'prod_growth_month',
        type: 'subscription' as const,
      }),
    };
    assert.throws(() =>
      requireSellableCheckoutPrice(
        { planId: 'growth', priceId: 'prod_growth_month' },
        invalidAmountLookup
      )
    );
  });

  it('removes caller-controlled absolute payment return URLs', () => {
    const checkoutSchema = createCheckoutInputSchema(lookup);
    assert.equal(
      checkoutSchema.safeParse({
        planId: 'growth',
        priceId: 'prod_growth_month',
        successUrl: 'https://attacker.example/success',
      }).success,
      false
    );
    assert.equal(
      checkoutSchema.safeParse({
        cancelUrl: 'https://attacker.example/cancel',
        planId: 'growth',
        priceId: 'prod_growth_month',
      }).success,
      false
    );
    assert.equal(
      portalInputSchema.safeParse({
        returnUrl: 'https://attacker.example/return',
      }).success,
      false
    );
  });
});
