import assert from 'node:assert/strict';
import test from 'node:test';
import { withCanonicalProStudioOffer } from './-entry-offer';

const lockedEntry = {
  offer: {
    canPurchase: true,
    demoUrl: '/pro-studio#demo',
    description: 'Pro Studio',
    id: 'canvas-placeholder',
    priceLabel: 'canvas-placeholder',
    purchasePath: '/placeholder',
  },
  status: 'locked' as const,
};

const completeEnvironment = {
  PRO_STUDIO_AMOUNT_CENTS: '29900',
  PRO_STUDIO_CURRENCY: 'CNY',
  PRO_STUDIO_OFFER_ID: 'pro-studio-v1',
  PRO_STUDIO_PAYMENT_TYPE: 'one_time',
  PRO_STUDIO_PRICE_ID: 'price-pro-studio',
};

test('renders the same canonical offer used by checkout', () => {
  const result = withCanonicalProStudioOffer(
    lockedEntry,
    completeEnvironment,
    {
      findPlanByPriceId: () => undefined,
    },
    true
  );

  assert.deepEqual(result.offer, {
    ...lockedEntry.offer,
    id: 'pro-studio-v1',
    priceLabel: '¥299 一次性',
    purchasePath: '/api/pro-studio/checkout',
    purchaseReason: undefined,
  });
});

test('incomplete or main-plan configuration has no purchase CTA', () => {
  for (const [name, environment, findPlanByPriceId] of [
    ['incomplete', {}, () => undefined],
    ['Growth plan collision', completeEnvironment, () => ({ id: 'pro' })],
  ] as const) {
    const result = withCanonicalProStudioOffer(
      lockedEntry,
      environment,
      { findPlanByPriceId },
      true
    );
    assert.equal(result.offer.canPurchase, false, name);
    assert.equal(result.offer.purchasePath, '', name);
    assert.equal(result.offer.priceLabel, '价格暂不可用', name);
    assert.equal(result.offer.purchaseReason, 'unavailable', name);
  }
});

test('keeps checkout owner-only even with complete configuration', () => {
  const result = withCanonicalProStudioOffer(
    {
      ...lockedEntry,
      offer: { ...lockedEntry.offer, canPurchase: false },
    },
    completeEnvironment,
    { findPlanByPriceId: () => undefined },
    true
  );
  assert.equal(result.offer.canPurchase, false);
  assert.equal(result.offer.purchaseReason, 'owner_required');
});

test('complete offer still has no CTA when the payment provider is not ready', () => {
  const result = withCanonicalProStudioOffer(
    lockedEntry,
    completeEnvironment,
    { findPlanByPriceId: () => undefined },
    false
  );
  assert.equal(result.offer.canPurchase, false);
  assert.equal(result.offer.purchasePath, '');
  assert.equal(result.offer.purchaseReason, 'unavailable');
});

test('paid claims waiting for activation hide the purchase CTA', () => {
  for (const status of ['pending', 'activating'] as const) {
    for (const paymentProviderReady of [true, false]) {
      const result = withCanonicalProStudioOffer(
        lockedEntry,
        completeEnvironment,
        { findPlanByPriceId: () => undefined },
        paymentProviderReady,
        status
      );
      assert.equal(result.offer.canPurchase, false, status);
      assert.equal(result.offer.purchasePath, '', status);
      assert.equal(result.offer.purchaseReason, 'activation_pending', status);
    }
  }
});
