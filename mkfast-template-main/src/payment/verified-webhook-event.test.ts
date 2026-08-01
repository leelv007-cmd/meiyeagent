import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCreemVerifiedPaymentEvent,
  normalizeStripeVerifiedPaymentEvent,
} from './verified-webhook-event';

test('Stripe normalizes paid checkout (payment or subscription mode)', () => {
  assert.deepEqual(
    normalizeStripeVerifiedPaymentEvent({
      data: {
        object: {
          id: 'cs_1',
          mode: 'payment',
          payment_status: 'paid',
          metadata: { planCheckoutBindingId: 'pcb_1' },
        },
      },
      id: 'evt_checkout',
      type: 'checkout.session.completed',
    }),
    {
      eventType: 'checkout.session.completed',
      provider: 'stripe',
      providerEventId: 'evt_checkout',
      reference: { id: 'cs_1', kind: 'checkout' },
      planBindingId: 'pcb_1',
    }
  );
  assert.equal(
    normalizeStripeVerifiedPaymentEvent({
      data: {
        object: {
          id: 'sub_active',
          status: 'active',
          cancel_at_period_end: false,
        },
      },
      id: 'evt_active_update',
      type: 'customer.subscription.updated',
    }),
    null
  );
  assert.deepEqual(
    normalizeStripeVerifiedPaymentEvent({
      data: {
        object: { id: 'cs_sub', mode: 'subscription', payment_status: 'paid' },
      },
      id: 'evt_sub_checkout',
      type: 'checkout.session.completed',
    }),
    {
      eventType: 'checkout.session.completed',
      provider: 'stripe',
      providerEventId: 'evt_sub_checkout',
      reference: { id: 'cs_sub', kind: 'checkout' },
    }
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
});

test('Stripe normalizes invoice.paid, subscription updated, and deleted', () => {
  assert.deepEqual(
    normalizeStripeVerifiedPaymentEvent({
      data: {
        object: {
          id: 'in_1',
          billing_reason: 'subscription_cycle',
          parent: {
            subscription_details: { subscription: 'sub_cycle_1' },
          },
        },
      },
      id: 'evt_invoice',
      type: 'invoice.paid',
    }),
    {
      eventType: 'invoice.paid',
      provider: 'stripe',
      providerEventId: 'evt_invoice',
      reference: { id: 'sub_cycle_1', kind: 'subscription' },
    }
  );
  assert.deepEqual(
    normalizeStripeVerifiedPaymentEvent({
      data: {
        object: {
          id: 'in_legacy',
          billing_reason: 'subscription_cycle',
          subscription: 'sub_cycle_legacy',
        },
      },
      id: 'evt_invoice_legacy',
      type: 'invoice.paid',
    }),
    {
      eventType: 'invoice.paid',
      provider: 'stripe',
      providerEventId: 'evt_invoice_legacy',
      reference: { id: 'sub_cycle_legacy', kind: 'subscription' },
    }
  );
  assert.equal(
    normalizeStripeVerifiedPaymentEvent({
      data: {
        object: { id: 'in_initial', billing_reason: 'subscription_create' },
      },
      id: 'evt_initial_invoice',
      type: 'invoice.paid',
    }),
    null
  );
  assert.deepEqual(
    normalizeStripeVerifiedPaymentEvent({
      data: {
        object: {
          id: 'sub_1',
          status: 'active',
          cancel_at_period_end: true,
        },
      },
      id: 'evt_upd',
      type: 'customer.subscription.updated',
    }),
    {
      eventType: 'customer.subscription.updated',
      provider: 'stripe',
      providerEventId: 'evt_upd',
      reference: { id: 'sub_1', kind: 'subscription' },
    }
  );
  assert.deepEqual(
    normalizeStripeVerifiedPaymentEvent({
      data: {
        object: {
          id: 'sub_resumed',
          status: 'active',
          cancel_at_period_end: false,
        },
        previous_attributes: { cancel_at_period_end: true },
      },
      id: 'evt_resumed',
      type: 'customer.subscription.updated',
    }),
    {
      eventType: 'customer.subscription.resumed',
      provider: 'stripe',
      providerEventId: 'evt_resumed',
      reference: { id: 'sub_resumed', kind: 'subscription' },
    }
  );
  assert.deepEqual(
    normalizeStripeVerifiedPaymentEvent({
      data: { object: { id: 'sub_2' } },
      id: 'evt_del',
      type: 'customer.subscription.deleted',
    }),
    {
      eventType: 'customer.subscription.deleted',
      provider: 'stripe',
      providerEventId: 'evt_del',
      reference: { id: 'sub_2', kind: 'subscription' },
    }
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

test('Stripe normalizes a recurring invoice payment failure to past_due input', () => {
  assert.deepEqual(
    normalizeStripeVerifiedPaymentEvent({
      data: {
        object: {
          id: 'in_failed',
          billing_reason: 'subscription_cycle',
          parent: {
            subscription_details: { subscription: 'sub_failed' },
          },
        },
      },
      id: 'evt_invoice_failed',
      type: 'invoice.payment_failed',
    }),
    {
      eventType: 'invoice.payment_failed',
      provider: 'stripe',
      providerEventId: 'evt_invoice_failed',
      reference: { id: 'sub_failed', kind: 'subscription' },
    }
  );
});

test('Creem normalizes checkout, renewal, and cancel/expire lifecycle', () => {
  assert.deepEqual(
    normalizeCreemVerifiedPaymentEvent({
      eventType: 'checkout.completed',
      id: 'evt_creem_1',
      object: {
        id: 'ch_1',
        status: 'completed',
        metadata: { planCheckoutBindingId: 'pcb_creem_1' },
      },
    }),
    {
      eventType: 'checkout.completed',
      provider: 'creem',
      providerEventId: 'evt_creem_1',
      reference: { id: 'ch_1', kind: 'checkout' },
      planBindingId: 'pcb_creem_1',
    }
  );
  assert.deepEqual(
    normalizeCreemVerifiedPaymentEvent({
      eventType: 'subscription.paid',
      id: 'evt_creem_2',
      object: { id: 'sub_1' },
    }),
    {
      eventType: 'subscription.renewed',
      provider: 'creem',
      providerEventId: 'evt_creem_2',
      reference: { id: 'sub_1', kind: 'subscription' },
    }
  );
  assert.equal(
    normalizeCreemVerifiedPaymentEvent({
      eventType: 'subscription.past_due',
      id: 'evt_creem_past_due',
      object: { id: 'sub_past_due' },
    }),
    null,
  );
  assert.deepEqual(
    normalizeCreemVerifiedPaymentEvent({
      eventType: 'subscription.canceled',
      id: 'evt_creem_3',
      object: { id: 'sub_2' },
    }),
    {
      eventType: 'customer.subscription.deleted',
      provider: 'creem',
      providerEventId: 'evt_creem_3',
      reference: { id: 'sub_2', kind: 'subscription' },
    }
  );
  assert.deepEqual(
    normalizeCreemVerifiedPaymentEvent({
      eventType: 'subscription.scheduled_cancel',
      id: 'evt_creem_scheduled',
      object: { id: 'sub_scheduled' },
    }),
    {
      eventType: 'customer.subscription.updated',
      provider: 'creem',
      providerEventId: 'evt_creem_scheduled',
      reference: { id: 'sub_scheduled', kind: 'subscription' },
    }
  );
  assert.deepEqual(
    normalizeCreemVerifiedPaymentEvent({
      eventType: 'subscription.expired',
      id: 'evt_creem_4',
      object: { id: 'sub_3' },
    }),
    {
      eventType: 'subscription.expired',
      provider: 'creem',
      providerEventId: 'evt_creem_4',
      reference: { id: 'sub_3', kind: 'subscription' },
    }
  );
});
