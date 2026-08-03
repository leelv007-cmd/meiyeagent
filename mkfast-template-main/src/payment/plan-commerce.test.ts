import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  planGrantCommandFromIntent,
  planSettlementIntentFromEvent,
  requireCheckoutWorkspaceBinding,
  settleVerifiedPlanPayment,
  type PlanCheckoutBindingFacts,
  type PlanSettlementIntent,
} from './plan-commerce';
import type { VerifiedPaymentWebhookEvent } from './types';

const binding: PlanCheckoutBindingFacts = {
  workspaceId: 'ws-1',
  ownerUserId: 'user-1',
  priceId: 'price_growth_month',
  interval: 'month',
  periodStartsAt: '2026-07-01T00:00:00.000Z',
  periodEndsAt: '2026-08-01T00:00:00.000Z',
  subscriptionId: 'sub_1',
};

describe('plan-commerce settlement', () => {
  it('requires workspace binding on checkout metadata', () => {
    assert.throws(
      () => requireCheckoutWorkspaceBinding({ userId: 'u1' }),
      /workspaceId/
    );
    assert.deepEqual(
      requireCheckoutWorkspaceBinding({
        userId: 'u1',
        workspaceId: 'ws-1',
      }),
      { userId: 'u1', workspaceId: 'ws-1' }
    );
  });

  it('maps checkout complete to activate intent', () => {
    const event: VerifiedPaymentWebhookEvent = {
      eventType: 'checkout.session.completed',
      provider: 'stripe',
      providerEventId: 'evt_1',
      reference: { id: 'cs_1', kind: 'checkout' },
    };
    const intent = planSettlementIntentFromEvent(event, binding);
    assert.deepEqual(intent, {
      lifecycle: 'activate',
      paymentEventId: 'stripe:evt_1',
      provider: 'stripe',
      providerEventId: 'evt_1',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      priceId: 'price_growth_month',
      interval: 'month',
      periodStartsAt: '2026-07-01T00:00:00.000Z',
      periodEndsAt: '2026-08-01T00:00:00.000Z',
      subscriptionId: 'sub_1',
    });
  });

  it('sends product identity to core so admin mapping stays the tier truth', () => {
    const command = planGrantCommandFromIntent({
      lifecycle: 'renew',
      paymentEventId: 'stripe:evt_cycle',
      provider: 'stripe',
      providerEventId: 'evt_cycle',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      priceId: 'price_custom',
      interval: 'year',
      periodStartsAt: '2026-07-01T00:00:00.000Z',
      periodEndsAt: '2027-07-01T00:00:00.000Z',
      subscriptionId: 'sub_custom',
    });

    assert.deepEqual(command, {
      module: 'entitlements',
      action: 'payment_grant',
      payload: {
        lifecycle: 'renew',
        paymentEventId: 'stripe:evt_cycle',
        paymentProductId: 'price_custom',
        interval: 'year',
        subscriptionId: 'sub_custom',
        periodStartsAt: '2026-07-01T00:00:00.000Z',
        periodEndsAt: '2027-07-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
      },
    });
    assert.equal('tier' in command.payload, false);
  });

  it('maps invoice.paid / subscription.renewed to renew', () => {
    const renew = planSettlementIntentFromEvent(
      {
        eventType: 'invoice.paid',
        provider: 'stripe',
        providerEventId: 'evt_inv',
        reference: { id: 'sub_1', kind: 'subscription' },
      },
      binding
    );
    assert.equal(renew?.lifecycle, 'renew');
    assert.equal(renew?.paymentEventId, 'stripe:evt_inv');
  });

  it('uses one Waffo settlement key for activation and payment of the same billing period', () => {
    const periodStartsAt = '2026-08-03T00:00:00.000Z';
    const periodEndsAt = '2026-09-03T00:00:00.000Z';
    const waffoBinding = {
      ...binding,
      interval: 'monthly' as const,
      periodEndsAt,
      periodStartsAt,
      subscriptionId: null,
    };
    const activation = planSettlementIntentFromEvent(
      {
        eventType: 'checkout.completed',
        planBindingId: 'pcb_waffo_1',
        provider: 'waffo',
        providerDeliveryId: 'delivery_activation',
        providerEventId: 'business_activation',
        reference: { id: 'subscription_waffo_1', kind: 'subscription' },
        periodEndsAt,
        periodStartsAt,
      },
      waffoBinding
    );
    const paymentSucceeded = planSettlementIntentFromEvent(
      {
        eventType: 'subscription.renewed',
        provider: 'waffo',
        providerDeliveryId: 'delivery_payment',
        providerEventId: 'business_payment',
        reference: { id: 'subscription_waffo_1', kind: 'subscription' },
        periodEndsAt,
        periodStartsAt,
      },
      waffoBinding
    );

    assert.notEqual(
      activation?.providerEventId,
      paymentSucceeded?.providerEventId
    );
    assert.equal(
      activation?.paymentEventId,
      'waffo:subscription:subscription_waffo_1:2026-08-03T00:00:00.000Z:2026-09-03T00:00:00.000Z'
    );
    assert.equal(paymentSucceeded?.paymentEventId, activation?.paymentEventId);
    assert.equal(
      activation &&
        planGrantCommandFromIntent(activation).payload.paymentProvider,
      'waffo'
    );
  });

  it('fails closed when a Waffo paid subscription event has no billing period', () => {
    assert.equal(
      planSettlementIntentFromEvent(
        {
          eventType: 'subscription.renewed',
          provider: 'waffo',
          providerEventId: 'business_without_period',
          reference: { id: 'subscription_waffo_1', kind: 'subscription' },
        },
        {
          ...binding,
          interval: 'monthly',
          periodEndsAt: null,
          periodStartsAt: null,
        }
      ),
      null
    );
  });

  it('uses the verified subscription reference when a legacy binding row has no subscription id', () => {
    const intent = planSettlementIntentFromEvent(
      {
        eventType: 'invoice.paid',
        provider: 'stripe',
        providerEventId: 'evt_verified_subscription',
        reference: { id: 'sub_verified', kind: 'subscription' },
      },
      { ...binding, subscriptionId: null }
    );

    assert.equal(intent?.subscriptionId, 'sub_verified');
  });

  it('does not guess a subscription for an initial checkout without payment correlation', async () => {
    const event: VerifiedPaymentWebhookEvent = {
      eventType: 'checkout.session.completed',
      provider: 'stripe',
      providerEventId: 'evt_unresolved_checkout',
      reference: { id: 'cs_unresolved', kind: 'checkout' },
    };
    let grants = 0;

    const settled = await settleVerifiedPlanPayment(event, {
      async resolveBinding() {
        return { ...binding, subscriptionId: null };
      },
      async grantPlan() {
        grants += 1;
      },
    });

    assert.equal(settled, null);
    assert.equal(grants, 0);
  });

  it('maps subscription delete, cancel, and resume lifecycle', () => {
    assert.equal(
      planSettlementIntentFromEvent(
        {
          eventType: 'customer.subscription.deleted',
          provider: 'stripe',
          providerEventId: 'evt_del',
          reference: { id: 'sub_1', kind: 'subscription' },
        },
        binding
      )?.lifecycle,
      'expire'
    );
    assert.equal(
      planSettlementIntentFromEvent(
        {
          eventType: 'customer.subscription.updated',
          provider: 'stripe',
          providerEventId: 'evt_upd',
          reference: { id: 'sub_1', kind: 'subscription' },
        },
        { ...binding, cancelAtPeriodEnd: true }
      )?.lifecycle,
      'cancel_at_period_end'
    );
    assert.equal(
      planSettlementIntentFromEvent(
        {
          eventType: 'customer.subscription.resumed',
          provider: 'stripe',
          providerEventId: 'evt_resume',
          reference: { id: 'sub_1', kind: 'subscription' },
        },
        { ...binding, cancelAtPeriodEnd: false }
      )?.lifecycle,
      'resume'
    );
  });

  it('settles via ports and skips when binding is absent', async () => {
    const grants: PlanSettlementIntent[] = [];
    const event: VerifiedPaymentWebhookEvent = {
      eventType: 'checkout.completed',
      provider: 'creem',
      providerEventId: 'evt_c1',
      reference: { id: 'ch_1', kind: 'checkout' },
    };

    const settled = await settleVerifiedPlanPayment(event, {
      async resolveBinding() {
        return binding;
      },
      async grantPlan(intent) {
        grants.push(intent);
      },
    });
    assert.equal(settled?.lifecycle, 'activate');
    assert.equal(grants.length, 1);
    assert.equal(grants[0]?.paymentEventId, 'creem:evt_c1');

    const skipped = await settleVerifiedPlanPayment(event, {
      async resolveBinding() {
        return null;
      },
      async grantPlan() {
        throw new Error('should not grant');
      },
    });
    assert.equal(skipped, null);
  });
});
