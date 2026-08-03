import { describe, expect, it, vi } from 'vitest';
import {
  recordVerifiedPaymentRefund,
  resolvePaymentRefundReview,
  type PaymentRefundRecordInput,
} from './payment-refunds';
import type { VerifiedPaymentWebhookEvent } from './types';

const succeededRefund = {
  amount: '161.00',
  buyerIdentity: 'user_001',
  currency: 'HKD',
  eventType: 'refund.succeeded',
  orderMerchantExternalId: 'cpb_001',
  provider: 'waffo',
  providerDeliveryId: 'waffo-delivery-refund-001',
  providerEventId: 'waffo:refund.succeeded:waffo-refund-001',
  providerOccurredAt: '2026-08-04T01:02:03.000Z',
  reference: { id: 'waffo-order-001', kind: 'order' },
  scene: 'refund',
} satisfies VerifiedPaymentWebhookEvent;

describe('payment refund audit', () => {
  it('records a signed Waffo refund once for manual review without mutating credits', async () => {
    const record = vi.fn().mockResolvedValue('created');
    const rawPayload = '{"signed":"waffo-refund"}';

    await expect(
      recordVerifiedPaymentRefund(succeededRefund, rawPayload, { record })
    ).resolves.toEqual({
      dispositionStatus: 'pending_review',
      eventStatus: 'succeeded',
      orderId: 'waffo-order-001',
      provider: 'waffo',
      providerEventId: 'waffo:refund.succeeded:waffo-refund-001',
    });
    expect(record).toHaveBeenCalledExactlyOnceWith({
      amount: '161.00',
      currency: 'HKD',
      dispositionStatus: 'pending_review',
      eventStatus: 'succeeded',
      orderId: 'waffo-order-001',
      orderMerchantExternalId: 'cpb_001',
      ownerUserId: 'user_001',
      provider: 'waffo',
      providerDeliveryId: 'waffo-delivery-refund-001',
      providerEventId: 'waffo:refund.succeeded:waffo-refund-001',
      providerOccurredAt: '2026-08-04T01:02:03.000Z',
      rawPayload,
      scene: 'refund',
    } satisfies PaymentRefundRecordInput);
  });

  it('does not send a paid package event through the refund audit path', async () => {
    const record = vi.fn();
    const packageEvent = {
      ...succeededRefund,
      eventType: 'credit_package.completed',
      scene: 'credit_package',
    } satisfies VerifiedPaymentWebhookEvent;

    await expect(
      recordVerifiedPaymentRefund(packageEvent, '{}', { record })
    ).resolves.toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

  it('records the alert work durably without a synchronous notifier', async () => {
    await recordVerifiedPaymentRefund(succeededRefund, '{}', {
      record: vi.fn().mockResolvedValue('created'),
    });
  });

  it('resolves a pending refund review with an audited operator decision', async () => {
    const resolve = vi.fn().mockResolvedValue('resolved');

    await expect(
      resolvePaymentRefundReview(
        {
          actorUserId: 'admin-001',
          eventStatus: 'succeeded',
          note: 'Confirmed with the merchant and payment provider.',
          provider: 'waffo',
          providerEventId: 'waffo:refund.succeeded:waffo-refund-001',
        },
        { resolve }
      )
    ).resolves.toBe('resolved');
    expect(resolve).toHaveBeenCalledExactlyOnceWith({
      actorUserId: 'admin-001',
      eventStatus: 'succeeded',
      note: 'Confirmed with the merchant and payment provider.',
      provider: 'waffo',
      providerEventId: 'waffo:refund.succeeded:waffo-refund-001',
    });
  });

  it('rejects an unauditable refund resolution before storage', async () => {
    const resolve = vi.fn();
    await expect(
      resolvePaymentRefundReview(
        {
          actorUserId: 'admin-001',
          eventStatus: 'succeeded',
          note: '   ',
          provider: 'waffo',
          providerEventId: 'waffo:refund.succeeded:waffo-refund-001',
        },
        { resolve }
      )
    ).rejects.toMatchObject({ code: 'PAYMENT_REFUND_CONTRACT_INVALID' });
    expect(resolve).not.toHaveBeenCalled();
  });
});
