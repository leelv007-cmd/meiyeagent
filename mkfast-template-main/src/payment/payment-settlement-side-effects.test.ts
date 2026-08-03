import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPlanSettlementIntent,
  type PlanSettlementSideEffectPorts,
} from '@/payment/payment-settlement-side-effects';
import type { PlanSettlementIntent } from '@/payment/plan-commerce';
import type { VerifiedPaymentWebhookEvent } from '@/payment/types';

test('Waffo single-month activation grants, persists, activates, then cancels at period end', async () => {
  const calls: string[] = [];
  const event: VerifiedPaymentWebhookEvent = {
    eventType: 'checkout.completed',
    planBindingId: 'pcb_1',
    provider: 'waffo',
    providerDeliveryId: 'delivery_1',
    providerEventId: 'payment_1',
    reference: { id: 'order_1', kind: 'subscription' },
  };
  const intent: PlanSettlementIntent = {
    interval: 'single_month',
    lifecycle: 'activate',
    ownerUserId: 'user_1',
    paymentEventId: 'waffo:payment_1',
    periodEndsAt: '2026-09-03T00:00:00.000Z',
    periodStartsAt: '2026-08-03T00:00:00.000Z',
    priceId: 'PROD_STARTER_SINGLE_MONTH',
    provider: 'waffo',
    providerEventId: 'payment_1',
    subscriptionId: 'order_1',
    workspaceId: 'workspace_1',
  };

  await applyPlanSettlementIntent(event, intent, fakePorts(calls));

  assert.deepEqual(calls, [
    'grant',
    'persist:waffo',
    'active:order_1',
    'cancel:order_1:2026-08-03T00:00:00.000Z',
  ]);
});

function fakePorts(calls: string[]): PlanSettlementSideEffectPorts {
  return {
    async cancelWaffoSubscriptionAtPeriodEnd(input) {
      calls.push(`cancel:${input.subscriptionId}:${input.periodStartsAt}`);
    },
    bindings: {
      async markActive(input) {
        calls.push(`active:${input.subscriptionId}`);
      },
      async markCanceled() {
        calls.push('canceled');
      },
      async upsertWaffoSubscriptionPayment() {
        calls.push('persist:waffo');
      },
    },
    async grantPlanEntitlement() {
      calls.push('grant');
    },
  };
}
