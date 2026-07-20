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
    });

    assert.deepEqual(command, {
      module: 'entitlements',
      action: 'payment_grant',
      payload: {
        lifecycle: 'renew',
        paymentEventId: 'stripe:evt_cycle',
        paymentProductId: 'price_custom',
        interval: 'year',
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
