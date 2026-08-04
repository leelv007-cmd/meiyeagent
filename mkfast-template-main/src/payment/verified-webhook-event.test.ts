import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCreemVerifiedPaymentEvent,
  normalizeStripeVerifiedPaymentEvent,
  normalizeWaffoVerifiedPaymentEvent,
  WaffoPaymentEventContractError,
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
    null
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

test('Waffo normalizes a subscription activation into an owned checkout settlement', () => {
  assert.deepEqual(
    normalizeWaffoVerifiedPaymentEvent({
      id: 'waffo-delivery-001',
      eventId: 'waffo-payment-001',
      eventType: 'subscription.activated',
      timestamp: '2026-08-03T00:00:01.000Z',
      data: {
        orderId: 'waffo-order-001',
        merchantProvidedBuyerIdentity: 'user-001',
        orderMerchantExternalId: 'plan-checkout-binding-001',
        currentPeriodStart: '2026-08-03T00:00:00.000Z',
        currentPeriodEnd: '2026-09-03T00:00:00.000Z',
      },
    }),
    {
      eventType: 'checkout.completed',
      provider: 'waffo',
      providerEventId: 'waffo-payment-001',
      providerDeliveryId: 'waffo-delivery-001',
      providerOccurredAt: '2026-08-03T00:00:01.000Z',
      reference: { id: 'waffo-order-001', kind: 'subscription' },
      planBindingId: 'plan-checkout-binding-001',
      buyerIdentity: 'user-001',
      periodStartsAt: '2026-08-03T00:00:00.000Z',
      periodEndsAt: '2026-09-03T00:00:00.000Z',
    }
  );
});

test('Waffo normalizes a paid one-time credit package with its signed order facts', () => {
  assert.deepEqual(
    normalizeWaffoVerifiedPaymentEvent({
      id: 'waffo-delivery-package-001',
      eventId: 'waffo-payment-package-001',
      eventType: 'order.completed',
      timestamp: '2026-08-04T00:00:01.000Z',
      data: {
        orderId: 'waffo-order-package-001',
        merchantProvidedBuyerIdentity: 'user-001',
        orderMerchantExternalId: 'credit-package-binding-001',
        amount: '57.00',
        currency: 'HKD',
      },
    }),
    {
      eventType: 'credit_package.completed',
      provider: 'waffo',
      providerEventId: 'waffo-payment-package-001',
      providerDeliveryId: 'waffo-delivery-package-001',
      providerOccurredAt: '2026-08-04T00:00:01.000Z',
      reference: { id: 'waffo-order-package-001', kind: 'order' },
      scene: 'credit_package',
      buyerIdentity: 'user-001',
      packageCheckoutBindingId: 'credit-package-binding-001',
      amount: '57.00',
      currency: 'HKD',
    }
  );
});

test('Waffo normalizes successful and failed refunds for audit-only handling', () => {
  for (const eventType of ['refund.succeeded', 'refund.failed'] as const) {
    assert.deepEqual(
      normalizeWaffoVerifiedPaymentEvent({
        id: `waffo-delivery-${eventType}`,
        eventId: 'waffo-refund-001',
        eventType,
        timestamp: '2026-08-04T01:02:03.000Z',
        data: {
          orderId: 'waffo-order-package-refund',
          merchantProvidedBuyerIdentity: 'user-001',
          orderMerchantExternalId: 'credit-package-binding-refund',
          amount: '57.00',
          currency: 'HKD',
        },
      }),
      {
        eventType,
        provider: 'waffo',
        providerEventId: `waffo:${eventType}:waffo-refund-001`,
        providerDeliveryId: `waffo-delivery-${eventType}`,
        providerOccurredAt: '2026-08-04T01:02:03.000Z',
        reference: { id: 'waffo-order-package-refund', kind: 'order' },
        scene: 'refund',
        buyerIdentity: 'user-001',
        orderMerchantExternalId: 'credit-package-binding-refund',
        amount: '57.00',
        currency: 'HKD',
      }
    );
  }
});

test('recognized Waffo package and refund events reject incomplete signed facts', () => {
  for (const eventType of ['order.completed', 'refund.succeeded'] as const) {
    for (const data of [
      {
        amount: '57.00',
        currency: 'HKD',
        merchantProvidedBuyerIdentity: 'user-001',
        orderId: 'waffo-order-missing-package-binding',
      },
      {
        amount: '57.00',
        currency: 'HKD',
        orderId: 'waffo-order-missing-package-owner',
        orderMerchantExternalId: 'credit-package-binding-001',
      },
      {
        currency: 'HKD',
        merchantProvidedBuyerIdentity: 'user-001',
        orderId: 'waffo-order-missing-package-amount',
        orderMerchantExternalId: 'credit-package-binding-001',
      },
      {
        amount: '57.00',
        merchantProvidedBuyerIdentity: 'user-001',
        orderId: 'waffo-order-missing-package-currency',
        orderMerchantExternalId: 'credit-package-binding-001',
      },
    ]) {
      assert.throws(
        () =>
          normalizeWaffoVerifiedPaymentEvent({
            id: `waffo-delivery-${eventType}-${data.orderId}`,
            eventId: `waffo-event-${eventType}-${data.orderId}`,
            eventType,
            timestamp: '2026-08-04T01:02:03.000Z',
            data,
          }),
        (error: unknown) =>
          error instanceof WaffoPaymentEventContractError &&
          error.code === 'WAFFO_EVENT_CONTRACT_INVALID'
      );
    }
  }
});

test('Waffo uncanceled is a distinct lifecycle event, not a past-due resume', () => {
  assert.deepEqual(
    normalizeWaffoVerifiedPaymentEvent({
      id: 'waffo-delivery-uncancel',
      eventId: 'waffo-event-uncancel',
      eventType: 'subscription.uncanceled',
      timestamp: '2026-08-05T00:00:00.000Z',
      data: {
        orderId: 'waffo-order-uncancel',
        merchantProvidedBuyerIdentity: 'user-001',
      },
    }),
    {
      eventType: 'subscription.uncanceled',
      provider: 'waffo',
      providerEventId: 'waffo-event-uncancel',
      providerDeliveryId: 'waffo-delivery-uncancel',
      providerOccurredAt: '2026-08-05T00:00:00.000Z',
      reference: { id: 'waffo-order-uncancel', kind: 'subscription' },
      buyerIdentity: 'user-001',
    }
  );
});

test('recognized Waffo activation contract failures are typed retryable errors', () => {
  for (const data of [
    {
      orderId: 'waffo-order-missing-binding',
      merchantProvidedBuyerIdentity: 'user-001',
    },
    {
      orderId: 'waffo-order-missing-owner',
      orderMerchantExternalId: 'pcb-001',
    },
    // Zod rejects "" as present-and-invalid; the schema failure must surface
    // as a contract error, never a silent irrelevant-event null.
    {
      merchantProvidedBuyerIdentity: '',
      orderId: 'waffo-order-empty-owner',
      orderMerchantExternalId: 'pcb-001',
    },
    {
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
      currentPeriodStart: 'not-an-iso-date',
      merchantProvidedBuyerIdentity: 'user-001',
      orderId: 'waffo-order-invalid-period',
      orderMerchantExternalId: 'pcb-001',
    },
    {
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
      currentPeriodStart: '2026-09-01T00:00:00.000Z',
      merchantProvidedBuyerIdentity: 'user-001',
      orderId: 'waffo-order-inverted-period',
      orderMerchantExternalId: 'pcb-001',
    },
  ]) {
    assert.throws(
      () =>
        normalizeWaffoVerifiedPaymentEvent({
          data,
          eventId: `waffo-event-${data.orderId}`,
          eventType: 'subscription.activated',
          id: `waffo-delivery-${data.orderId}`,
          timestamp: '2026-08-03T00:00:01.000Z',
        }),
      (error: unknown) =>
        error instanceof WaffoPaymentEventContractError &&
        error.code === 'WAFFO_EVENT_CONTRACT_INVALID'
    );
  }
});

test('a recognized Waffo lifecycle event without a provider timestamp is a contract breach', () => {
  assert.throws(
    () =>
      normalizeWaffoVerifiedPaymentEvent({
        data: {
          merchantProvidedBuyerIdentity: 'user-001',
          orderId: 'waffo-order-no-timestamp',
          orderMerchantExternalId: 'pcb-001',
        },
        eventId: 'waffo-event-no-timestamp',
        eventType: 'subscription.payment_succeeded',
        id: 'waffo-delivery-no-timestamp',
      }),
    (error: unknown) =>
      error instanceof WaffoPaymentEventContractError &&
      error.code === 'WAFFO_EVENT_CONTRACT_INVALID'
  );
});

test('Waffo payment_succeeded without its provider Payment ID is a contract breach', () => {
  assert.throws(
    () =>
      normalizeWaffoVerifiedPaymentEvent({
        data: {
          currentPeriodEnd: '2026-09-03T00:00:00.000Z',
          currentPeriodStart: '2026-08-03T00:00:00.000Z',
          orderId: 'waffo-order-no-payment-id',
        },
        eventType: 'subscription.payment_succeeded',
        id: 'waffo-delivery-no-payment-id',
        timestamp: '2026-08-03T00:00:01.000Z',
      }),
    (error: unknown) =>
      error instanceof WaffoPaymentEventContractError &&
      error.code === 'WAFFO_EVENT_CONTRACT_INVALID'
  );
});

test('an unrecognized event type stays a silent null, not a contract error', () => {
  assert.equal(
    normalizeWaffoVerifiedPaymentEvent({
      data: { orderId: 'waffo-order-refund' },
      eventId: 'waffo-event-refund',
      eventType: 'refund.created',
      id: 'waffo-delivery-refund',
    }),
    null
  );
});

test('a Waffo event with a malformed provider timestamp is a contract breach', () => {
  assert.throws(
    () =>
      normalizeWaffoVerifiedPaymentEvent({
        data: {
          currentPeriodEnd: '2026-09-03T00:00:00.000Z',
          currentPeriodStart: '2026-08-03T00:00:00.000Z',
          merchantProvidedBuyerIdentity: 'user-001',
          orderId: 'waffo-order-bad-timestamp',
          orderMerchantExternalId: 'pcb-001',
        },
        eventId: 'waffo-event-bad-timestamp',
        eventType: 'subscription.activated',
        id: 'waffo-delivery-bad-timestamp',
        timestamp: 'yesterday-ish',
      }),
    (error: unknown) =>
      error instanceof WaffoPaymentEventContractError &&
      error.code === 'WAFFO_EVENT_CONTRACT_INVALID'
  );
});

test('Waffo activation with an absent or half-open period defers to provider recovery', () => {
  const absent = normalizeWaffoVerifiedPaymentEvent({
    data: {
      merchantProvidedBuyerIdentity: 'user-001',
      orderId: 'waffo-order-recoverable-period',
      orderMerchantExternalId: 'pcb-001',
    },
    eventId: 'waffo-event-recoverable-period',
    eventType: 'subscription.activated',
    id: 'waffo-delivery-recoverable-period',
    timestamp: '2026-08-03T00:00:01.000Z',
  });
  assert.equal(absent?.eventType, 'checkout.completed');
  assert.equal(absent?.periodStartsAt, undefined);
  assert.equal(absent?.periodEndsAt, undefined);

  // A half-open period is recoverable too: the provider order record replaces
  // both bounds before settlement.
  const halfOpen = normalizeWaffoVerifiedPaymentEvent({
    data: {
      currentPeriodStart: '2026-08-03T00:00:00.000Z',
      merchantProvidedBuyerIdentity: 'user-001',
      orderId: 'waffo-order-half-open-period',
      orderMerchantExternalId: 'pcb-001',
    },
    eventId: 'waffo-event-half-open-period',
    eventType: 'subscription.activated',
    id: 'waffo-delivery-half-open-period',
    timestamp: '2026-08-03T00:00:01.000Z',
  });
  assert.equal(halfOpen?.eventType, 'checkout.completed');
  assert.equal(halfOpen?.periodStartsAt, '2026-08-03T00:00:00.000Z');
  assert.equal(halfOpen?.periodEndsAt, undefined);
});

test('Waffo preserves provider occurrence time and maps past_due', () => {
  assert.deepEqual(
    normalizeWaffoVerifiedPaymentEvent({
      data: {
        currentPeriodEnd: '2026-09-03T00:00:00.000Z',
        currentPeriodStart: '2026-08-03T00:00:00.000Z',
        merchantProvidedBuyerIdentity: 'user-001',
        orderId: 'waffo-order-past-due',
      },
      eventId: 'waffo-event-past-due',
      eventType: 'subscription.past_due',
      id: 'waffo-delivery-past-due',
      timestamp: '2026-08-04T01:02:03.000Z',
    }),
    {
      eventType: 'subscription.past_due',
      provider: 'waffo',
      providerEventId: 'waffo-event-past-due',
      providerDeliveryId: 'waffo-delivery-past-due',
      providerOccurredAt: '2026-08-04T01:02:03.000Z',
      reference: { id: 'waffo-order-past-due', kind: 'subscription' },
      buyerIdentity: 'user-001',
      periodStartsAt: '2026-08-03T00:00:00.000Z',
      periodEndsAt: '2026-09-03T00:00:00.000Z',
    }
  );
});
