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

test('Waffo past_due persists the degraded payment state without activating or canceling it', async () => {
  const calls: string[] = [];
  const event: VerifiedPaymentWebhookEvent = {
    eventType: 'subscription.past_due',
    provider: 'waffo',
    providerEventId: 'payment_past_due',
    providerOccurredAt: '2026-08-04T01:02:03.000Z',
    reference: { id: 'order_past_due', kind: 'subscription' },
  };
  const intent: PlanSettlementIntent = {
    interval: 'monthly',
    lifecycle: 'past_due',
    ownerUserId: 'user_1',
    paymentEventId:
      'waffo:order_past_due:2026-08-04T00:00:00.000Z:2026-09-04T00:00:00.000Z',
    periodEndsAt: '2026-09-04T00:00:00.000Z',
    periodStartsAt: '2026-08-04T00:00:00.000Z',
    priceId: 'PROD_STARTER_MONTHLY',
    provider: 'waffo',
    providerEventId: 'payment_past_due',
    providerOccurredAt: '2026-08-04T01:02:03.000Z',
    subscriptionId: 'order_past_due',
    workspaceId: 'workspace_1',
  };

  await applyPlanSettlementIntent(event, intent, fakePorts(calls));

  assert.deepEqual(calls, ['grant', 'persist:waffo']);
});

test('Waffo replacement activation schedules the old subscription cancellation exactly once', async () => {
  const calls: string[] = [];
  const event: VerifiedPaymentWebhookEvent = {
    eventType: 'checkout.completed',
    planBindingId: 'pcb_replacement',
    provider: 'waffo',
    providerEventId: 'payment_replacement',
    reference: { id: 'order_new', kind: 'subscription' },
  };
  const intent: PlanSettlementIntent = {
    interval: 'monthly',
    lifecycle: 'activate',
    ownerUserId: 'user_1',
    paymentEventId: 'waffo:payment_replacement',
    periodEndsAt: '2026-09-03T00:00:00.000Z',
    periodStartsAt: '2026-08-03T00:00:00.000Z',
    priceId: 'PROD_GROWTH_MONTHLY',
    provider: 'waffo',
    providerEventId: 'payment_replacement',
    replacesSubscriptionId: 'order_old',
    subscriptionId: 'order_new',
    workspaceId: 'workspace_1',
  };

  await applyPlanSettlementIntent(event, intent, fakePorts(calls));

  assert.deepEqual(calls, [
    'grant',
    'persist:waffo',
    'active:order_new',
    'cancel:order_old:2026-08-03T00:00:00.000Z',
  ]);
});

test('Waffo stale or duplicate lifecycle events do not re-run entitlement side effects', async () => {
  const calls: string[] = [];
  const event: VerifiedPaymentWebhookEvent = {
    eventType: 'customer.subscription.deleted',
    provider: 'waffo',
    providerEventId: 'payment_stale',
    reference: { id: 'order_stale', kind: 'subscription' },
  };
  const intent: PlanSettlementIntent = {
    interval: 'monthly',
    lifecycle: 'expire',
    ownerUserId: 'user_1',
    paymentEventId: 'waffo:payment_stale',
    periodEndsAt: '2026-09-03T00:00:00.000Z',
    periodStartsAt: '2026-08-03T00:00:00.000Z',
    priceId: 'PROD_STARTER_MONTHLY',
    provider: 'waffo',
    providerEventId: 'payment_stale',
    subscriptionId: 'order_stale',
    workspaceId: 'workspace_1',
  };
  const ports = fakePorts(calls);
  ports.bindings.classifyWaffoSubscriptionPayment = async () => 'ignored_stale';

  await applyPlanSettlementIntent(event, intent, ports);

  assert.deepEqual(calls, []);
});

test('Waffo duplicate activation still resumes an incomplete cancellation side effect', async () => {
  const calls: string[] = [];
  const event: VerifiedPaymentWebhookEvent = {
    eventType: 'checkout.completed',
    planBindingId: 'pcb_replay',
    provider: 'waffo',
    providerEventId: 'payment_replay',
    reference: { id: 'order_replay', kind: 'subscription' },
  };
  const intent: PlanSettlementIntent = {
    interval: 'single_month',
    lifecycle: 'activate',
    ownerUserId: 'user_1',
    paymentEventId: 'waffo:payment_replay',
    periodEndsAt: '2026-09-03T00:00:00.000Z',
    periodStartsAt: '2026-08-03T00:00:00.000Z',
    priceId: 'PROD_STARTER_SINGLE_MONTH',
    provider: 'waffo',
    providerEventId: 'payment_replay',
    subscriptionId: 'order_replay',
    workspaceId: 'workspace_1',
  };
  const ports = fakePorts(calls);
  ports.bindings.classifyWaffoSubscriptionPayment = async () => 'duplicate';

  await applyPlanSettlementIntent(event, intent, ports);

  assert.deepEqual(calls, [
    'active:order_replay',
    'cancel:order_replay:2026-08-03T00:00:00.000Z',
  ]);
});

function fakePorts(calls: string[]): PlanSettlementSideEffectPorts {
  return {
    async cancelWaffoSubscriptionAtPeriodEnd(input) {
      calls.push(`cancel:${input.subscriptionId}:${input.periodStartsAt}`);
    },
    bindings: {
      async classifyWaffoSubscriptionPayment() {
        return 'applied';
      },
      async markActive(input) {
        calls.push(`active:${input.subscriptionId}`);
      },
      async markCanceled() {
        calls.push('canceled');
      },
      async upsertWaffoSubscriptionPayment() {
        calls.push('persist:waffo');
        return 'applied';
      },
    },
    async grantPlanEntitlement() {
      calls.push('grant');
    },
  };
}
