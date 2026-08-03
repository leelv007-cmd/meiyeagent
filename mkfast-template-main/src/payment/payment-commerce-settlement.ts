import type { VerifiedPaymentWebhookEvent } from './types';

export type PaymentCommerceSettlementKind =
  | 'credit_package'
  | 'plan'
  | 'refund';

export interface PaymentCommerceSettlementPorts {
  recordRefund(
    event: VerifiedPaymentWebhookEvent,
    rawPayload: string
  ): Promise<unknown | null>;
  settleCreditPackage(
    event: VerifiedPaymentWebhookEvent
  ): Promise<unknown | null>;
  settlePlan(event: VerifiedPaymentWebhookEvent): Promise<unknown | null>;
}

export class PaymentCommerceBindingUnavailableError extends Error {
  readonly code = 'PAYMENT_BINDING_NOT_READY' as const;

  constructor() {
    super('Verified payment event has no durable commerce binding yet.');
    this.name = 'PaymentCommerceBindingUnavailableError';
  }
}

/**
 * Routes verified payment facts through mutually exclusive commerce paths.
 * Refunds are audit-only and must never fall through to entitlement grants.
 */
export async function settleVerifiedPaymentCommerce(
  event: VerifiedPaymentWebhookEvent,
  rawPayload: string,
  ports: PaymentCommerceSettlementPorts
): Promise<PaymentCommerceSettlementKind> {
  if (await ports.recordRefund(event, rawPayload)) return 'refund';
  if (await ports.settleCreditPackage(event)) return 'credit_package';
  if (await ports.settlePlan(event)) return 'plan';
  throw new PaymentCommerceBindingUnavailableError();
}
