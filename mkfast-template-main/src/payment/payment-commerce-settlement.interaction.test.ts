import { describe, expect, it, vi } from 'vitest';
import {
  PaymentCommerceBindingUnavailableError,
  settleVerifiedPaymentCommerce,
} from './payment-commerce-settlement';
import type { VerifiedPaymentWebhookEvent } from './types';

const refundEvent = {
  amount: '161.00',
  buyerIdentity: 'user_001',
  currency: 'HKD',
  eventType: 'refund.succeeded',
  orderMerchantExternalId: 'cpb_001',
  provider: 'waffo',
  providerDeliveryId: 'waffo-delivery-refund-001',
  providerEventId: 'waffo-refund-001',
  providerOccurredAt: '2026-08-04T01:02:03.000Z',
  reference: { id: 'waffo-order-001', kind: 'order' },
  scene: 'refund',
} satisfies VerifiedPaymentWebhookEvent;

const packageEvent = {
  amount: '161.00',
  buyerIdentity: 'user_001',
  currency: 'HKD',
  eventType: 'credit_package.completed',
  packageCheckoutBindingId: 'cpb_001',
  provider: 'waffo',
  providerDeliveryId: 'waffo-delivery-package-001',
  providerEventId: 'waffo-payment-package-001',
  providerOccurredAt: '2026-08-04T01:02:03.000Z',
  reference: { id: 'waffo-order-package-001', kind: 'order' },
  scene: 'credit_package',
} satisfies VerifiedPaymentWebhookEvent;

describe('payment commerce settlement routing', () => {
  it('records a refund before either entitlement settlement path', async () => {
    const recordRefund = vi.fn().mockResolvedValue({
      providerEventId: refundEvent.providerEventId,
    });
    const settleCreditPackage = vi.fn();
    const settlePlan = vi.fn();

    await expect(
      settleVerifiedPaymentCommerce(refundEvent, '{"signed":"refund"}', {
        recordRefund,
        settleCreditPackage,
        settlePlan,
      })
    ).resolves.toBe('refund');
    expect(settleCreditPackage).not.toHaveBeenCalled();
    expect(settlePlan).not.toHaveBeenCalled();
  });

  it('settles a canonical credit package without falling through to the plan path', async () => {
    const settlePlan = vi.fn();

    await expect(
      settleVerifiedPaymentCommerce(packageEvent, '{}', {
        recordRefund: vi.fn().mockResolvedValue(null),
        settleCreditPackage: vi.fn().mockResolvedValue({
          paymentEventId: packageEvent.providerEventId,
        }),
        settlePlan,
      })
    ).resolves.toBe('credit_package');
    expect(settlePlan).not.toHaveBeenCalled();
  });

  it('keeps an unbound recognized payment delivery retryable', async () => {
    await expect(
      settleVerifiedPaymentCommerce(packageEvent, '{}', {
        recordRefund: vi.fn().mockResolvedValue(null),
        settleCreditPackage: vi.fn().mockResolvedValue(null),
        settlePlan: vi.fn().mockResolvedValue(null),
      })
    ).rejects.toBeInstanceOf(PaymentCommerceBindingUnavailableError);
  });
});
