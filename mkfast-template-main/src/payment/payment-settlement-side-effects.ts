import {
  shouldCancelPlanBinding,
  type PlanSettlementIntent,
} from '@/payment/plan-commerce';
import type {
  PaymentProviderName,
  VerifiedPaymentWebhookEvent,
} from '@/payment/types';

type PlanBindingSettlementPort = {
  upsertWaffoSubscriptionPayment(input: {
    event: VerifiedPaymentWebhookEvent;
    intent: PlanSettlementIntent;
  }): Promise<'applied' | 'duplicate' | 'ignored_stale' | undefined>;
  classifyWaffoSubscriptionPayment?(input: {
    event: VerifiedPaymentWebhookEvent;
    intent: PlanSettlementIntent;
  }): Promise<'applied' | 'duplicate' | 'ignored_stale'>;
  markActive(input: {
    bindingId?: string | null;
    provider: PaymentProviderName;
    providerCheckoutId?: string | null;
    subscriptionId?: string | null;
  }): Promise<void>;
  markCanceled(input: {
    provider: PaymentProviderName;
    subscriptionId: string;
  }): Promise<void>;
};

export interface PlanSettlementSideEffectPorts {
  bindings: PlanBindingSettlementPort;
  grantPlanEntitlement(intent: PlanSettlementIntent): Promise<void>;
  cancelWaffoSubscriptionAtPeriodEnd(input: {
    periodStartsAt: string | null;
    subscriptionId: string;
  }): Promise<void>;
}

export async function applyPlanSettlementIntent(
  event: VerifiedPaymentWebhookEvent,
  intent: PlanSettlementIntent,
  ports: PlanSettlementSideEffectPorts
) {
  let waffoReplay = false;
  if (event.provider === 'waffo') {
    const classify = ports.bindings.classifyWaffoSubscriptionPayment;
    if (classify && intent.subscriptionId) {
      const order = await classify({ event, intent });
      if (order === 'ignored_stale') return;
      waffoReplay = order === 'duplicate';
    }
  }
  if (!waffoReplay) {
    await ports.grantPlanEntitlement(intent);
  }
  if (event.provider === 'waffo' && !waffoReplay) {
    const waffoMutation = await ports.bindings.upsertWaffoSubscriptionPayment({
      event,
      intent,
    });
    if (waffoMutation === 'duplicate' || waffoMutation === 'ignored_stale') {
      if (waffoMutation === 'ignored_stale') return;
      waffoReplay = true;
    }
  }
  if (
    intent.lifecycle === 'activate' ||
    intent.lifecycle === 'renew' ||
    intent.lifecycle === 'resume' ||
    intent.lifecycle === 'uncancel_at_period_end'
  ) {
    await ports.bindings.markActive({
      bindingId: event.planBindingId ?? null,
      provider: intent.provider,
      providerCheckoutId:
        event.reference.kind === 'checkout' ? event.reference.id : null,
      subscriptionId: intent.subscriptionId,
    });
    if (
      event.provider === 'waffo' &&
      intent.lifecycle === 'activate' &&
      intent.interval === 'single_month' &&
      intent.subscriptionId
    ) {
      await ports.cancelWaffoSubscriptionAtPeriodEnd({
        periodStartsAt: intent.periodStartsAt,
        subscriptionId: intent.subscriptionId,
      });
    }
    if (
      event.provider === 'waffo' &&
      intent.lifecycle === 'activate' &&
      intent.replacesSubscriptionId
    ) {
      await ports.cancelWaffoSubscriptionAtPeriodEnd({
        periodStartsAt: intent.periodStartsAt,
        subscriptionId: intent.replacesSubscriptionId,
      });
    }
  } else if (shouldCancelPlanBinding(intent, event.reference)) {
    await ports.bindings.markCanceled({
      provider: intent.provider,
      subscriptionId: event.reference.id,
    });
  }
}
