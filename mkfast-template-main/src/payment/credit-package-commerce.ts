import type { VerifiedPaymentWebhookEvent } from './types';
import type { CreditPackageSkuSnapshot } from './waffo-credit-package-catalog';

export interface CreditPackageCheckoutBindingFacts {
  id: string;
  offerId: string;
  ownerUserId: string;
  productId: string;
  workspaceId: string;
  skuSnapshot: CreditPackageSkuSnapshot;
}

export interface CreditPackageSettlementIntent {
  offerId: string;
  ownerUserId: string;
  paymentEventId: string;
  workspaceId: string;
  credits: number;
  expireDays: number;
}

export type CreditPackageSettlementClaim =
  | {
      binding: CreditPackageCheckoutBindingFacts;
      claimToken: string;
      status: 'claimed';
    }
  | {
      binding: CreditPackageCheckoutBindingFacts;
      status: 'duplicate';
    };

export type CreditPackageOrderEvent = Omit<
  VerifiedPaymentWebhookEvent,
  'eventType' | 'reference'
> & {
  eventType: 'credit_package.completed';
  packageCheckoutBindingId?: string;
  reference: { id: string; kind: 'order' };
};

export type PaymentSettlementEvent =
  | CreditPackageOrderEvent
  | VerifiedPaymentWebhookEvent;

export interface CreditPackageSettlementPorts {
  claimSettlement(
    event: CreditPackageOrderEvent
  ): Promise<CreditPackageSettlementClaim | null>;
  completeSettlement(input: {
    bindingId: string;
    claimToken: string;
  }): Promise<void>;
  grantAddOn(intent: CreditPackageSettlementIntent): Promise<void>;
  validateBinding(
    event: CreditPackageOrderEvent,
    binding: CreditPackageCheckoutBindingFacts
  ): void;
}

export function creditPackageSettlementIntentFromEvent(
  event: PaymentSettlementEvent,
  binding: CreditPackageCheckoutBindingFacts
): CreditPackageSettlementIntent | null {
  if (!isCreditPackageOrder(event)) return null;
  if (binding.id !== event.packageCheckoutBindingId) return null;
  if (!binding.offerId || !binding.ownerUserId || !binding.workspaceId)
    return null;
  const orderId = event.reference.id.trim();
  if (!orderId) return null;
  return {
    offerId: binding.offerId,
    ownerUserId: binding.ownerUserId,
    paymentEventId: `${event.provider}:order:${orderId}`,
    workspaceId: binding.workspaceId,
    credits: binding.skuSnapshot.credits,
    expireDays: binding.skuSnapshot.expireDays,
  };
}

export async function settleVerifiedCreditPackagePurchase(
  event: PaymentSettlementEvent,
  ports: CreditPackageSettlementPorts
): Promise<CreditPackageSettlementIntent | null> {
  if (!isCreditPackageOrder(event)) return null;
  const claim = await ports.claimSettlement(event);
  if (!claim) return null;
  const intent = creditPackageSettlementIntentFromEvent(event, claim.binding);
  if (!intent) return null;
  if (claim.status === 'duplicate') return intent;
  ports.validateBinding(event, claim.binding);
  await ports.grantAddOn(intent);
  await ports.completeSettlement({
    bindingId: claim.binding.id,
    claimToken: claim.claimToken,
  });
  return intent;
}

function isCreditPackageOrder(
  event: PaymentSettlementEvent
): event is CreditPackageOrderEvent {
  const packageEvent = event as unknown as Partial<CreditPackageOrderEvent>;
  return (
    packageEvent.provider === 'waffo' &&
    packageEvent.eventType === 'credit_package.completed' &&
    packageEvent.reference?.kind === 'order' &&
    typeof packageEvent.packageCheckoutBindingId === 'string' &&
    packageEvent.packageCheckoutBindingId.trim().length > 0
  );
}
