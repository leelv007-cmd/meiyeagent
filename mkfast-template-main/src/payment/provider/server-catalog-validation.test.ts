import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCreemServerCatalogOffer,
  assertStripeServerCatalogOffer,
} from './server-catalog-validation';

const offer = {
  offerId: 'pro-studio-v1',
  price: {
    amount: 29900,
    currency: 'CNY',
    priceId: 'price-pro-studio',
    type: 'one_time' as const,
  },
};

test('Stripe price must match canonical amount, currency and one-time cadence', () => {
  assert.doesNotThrow(() =>
    assertStripeServerCatalogOffer(offer, {
      active: true,
      currency: 'cny',
      id: 'price-pro-studio',
      recurring: null,
      type: 'one_time',
      unit_amount: 29900,
    })
  );
  for (const actual of [
    {
      active: true,
      currency: 'cny',
      id: 'price-pro-studio',
      recurring: null,
      type: 'one_time',
      unit_amount: 19900,
    },
    {
      active: true,
      currency: 'usd',
      id: 'price-pro-studio',
      recurring: null,
      type: 'one_time',
      unit_amount: 29900,
    },
    {
      active: true,
      currency: 'cny',
      id: 'price-pro-studio',
      recurring: { interval: 'month' },
      type: 'recurring',
      unit_amount: 29900,
    },
  ]) {
    assert.throws(() => assertStripeServerCatalogOffer(offer, actual));
  }
});

test('Creem product must match canonical amount, currency and one-time billing type', () => {
  assert.doesNotThrow(() =>
    assertCreemServerCatalogOffer(offer, {
      billingPeriod: 'once',
      billingType: 'onetime',
      currency: 'CNY',
      id: 'price-pro-studio',
      price: 29900,
      status: 'active',
    })
  );
  assert.throws(() =>
    assertCreemServerCatalogOffer(offer, {
      billingPeriod: 'every-month',
      billingType: 'recurring',
      currency: 'CNY',
      id: 'price-pro-studio',
      price: 29900,
      status: 'active',
    })
  );
});
