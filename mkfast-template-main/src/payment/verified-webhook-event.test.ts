import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCreemVerifiedPaymentEvent,
  normalizeStripeVerifiedPaymentEvent,
} from './verified-webhook-event';

test('Stripe normalizes only a paid checkout session identity', () => {
  assert.deepEqual(
    normalizeStripeVerifiedPaymentEvent({
      data: { object: { id: 'cs_1', mode: 'payment', payment_status: 'paid' } },
      id: 'evt_checkout',
      type: 'checkout.session.completed',
    }),
    {
      eventType: 'checkout.session.completed',
      provider: 'stripe',
      providerEventId: 'evt_checkout',
      reference: { id: 'cs_1', kind: 'checkout' },
    }
  );
  assert.equal(
    normalizeStripeVerifiedPaymentEvent({
      data: { object: { id: 'in_1' } },
      id: 'evt_invoice',
      type: 'invoice.paid',
    }),
    null
  );
  assert.equal(
    normalizeStripeVerifiedPaymentEvent({
      data: {
        object: { id: 'cs_unpaid', mode: 'payment', payment_status: 'unpaid' },
      },
      id: 'evt_unpaid',
      type: 'checkout.session.completed',
    }),
    null
  );
  assert.equal(
    normalizeStripeVerifiedPaymentEvent({
      data: { object: { id: 'cs_1' } },
      id: 'evt_open',
      type: 'checkout.session.async_payment_succeeded',
    }),
    null
  );
});

test('Creem binds checkout.completed to the real checkout object id', () => {
  assert.deepEqual(
    normalizeCreemVerifiedPaymentEvent({
      eventType: 'checkout.completed',
      id: 'evt_creem_1',
      object: { id: 'ch_1', status: 'completed' },
    }),
    {
      eventType: 'checkout.completed',
      provider: 'creem',
      providerEventId: 'evt_creem_1',
      reference: { id: 'ch_1', kind: 'checkout' },
    }
  );
  assert.equal(
    normalizeCreemVerifiedPaymentEvent({
      eventType: 'subscription.paid',
      id: 'evt_creem_2',
      object: { id: 'sub_1' },
    }),
    null
  );
});
