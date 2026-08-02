import {
  shouldCancelPlanBinding,
  type PlanSettlementIntent,
} from './plan-commerce';
import type { PaymentProviderName, VerifiedPaymentWebhookEvent } from './types';

type PlanBindingSettlementPort = {
  upsertWaffoSubscriptionPayment(input: {
    event: VerifiedPaymentWebhookEvent;
    intent: PlanSettlementIntent;
  }): Promise<void>;
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
  cancelWaffoSubscriptionAtPeriodEnd(subscriptionId: string): Promise<void>;
}

export async function applyPlanSettlementIntent(
  event: VerifiedPaymentWebhookEvent,
  intent: PlanSettlementIntent,
  ports: PlanSettlementSideEffectPorts
) {
  await ports.grantPlanEntitlement(intent);
  if (event.provider === 'waffo') {
    await ports.bindings.upsertWaffoSubscriptionPayment({ event, intent });
  }
  if (
    intent.lifecycle === 'activate' ||
    intent.lifecycle === 'renew' ||
    intent.lifecycle === 'resume'
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
      await ports.cancelWaffoSubscriptionAtPeriodEnd(intent.subscriptionId);
    }
  } else if (shouldCancelPlanBinding(intent, event.reference)) {
    await ports.bindings.markCanceled({
      provider: intent.provider,
      subscriptionId: event.reference.id,
    });
  }
}
