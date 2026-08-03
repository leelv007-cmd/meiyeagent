import { describe, expect, it, vi } from 'vitest';
import { drainPaymentRefundReviewAlerts } from './payment-refund-alerts';

const claim = {
  amount: '161.00',
  claimToken: 'refund-alert-claim-001',
  currency: 'HKD',
  eventStatus: 'succeeded' as const,
  orderId: 'waffo-order-001',
  provider: 'waffo' as const,
  providerEventId: 'waffo:refund.succeeded:waffo-refund-001',
};

describe('payment refund review alerts', () => {
  it('completes a durable alert only after the operations notification succeeds', async () => {
    const complete = vi.fn();
    const notify = vi.fn().mockResolvedValue('delivered');

    await expect(
      drainPaymentRefundReviewAlerts(
        { limit: 1 },
        {
          notify,
          outbox: {
            claimNext: vi.fn().mockResolvedValue(claim),
            complete,
            retry: vi.fn(),
          },
        }
      )
    ).resolves.toEqual({ completed: 1, failed: 0 });

    expect(notify).toHaveBeenCalledExactlyOnceWith({
      amount: '161.00',
      currency: 'HKD',
      eventStatus: 'succeeded',
      orderId: 'waffo-order-001',
      provider: 'waffo',
      providerEventId: 'waffo:refund.succeeded:waffo-refund-001',
    });
    expect(complete).toHaveBeenCalledExactlyOnceWith(claim);
  });

  it('leaves a failed notification in the durable retry queue without failing payment settlement', async () => {
    const complete = vi.fn();
    const retry = vi.fn();

    await expect(
      drainPaymentRefundReviewAlerts(
        { limit: 1 },
        {
          notify: vi
            .fn()
            .mockRejectedValue(new Error('operations unavailable')),
          outbox: {
            claimNext: vi.fn().mockResolvedValue(claim),
            complete,
            retry,
          },
        }
      )
    ).resolves.toEqual({ completed: 0, failed: 1 });

    expect(complete).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledExactlyOnceWith(
      claim,
      'PAYMENT_REFUND_ALERT_DELIVERY_FAILED'
    );
  });

  it('retries when operations notifications are disabled instead of completing the alert', async () => {
    const complete = vi.fn();
    const retry = vi.fn();

    await expect(
      drainPaymentRefundReviewAlerts(
        { limit: 1 },
        {
          notify: vi.fn().mockResolvedValue('unavailable'),
          outbox: {
            claimNext: vi.fn().mockResolvedValue(claim),
            complete,
            retry,
          },
        }
      )
    ).resolves.toEqual({ completed: 0, failed: 1 });

    expect(complete).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledExactlyOnceWith(
      claim,
      'PAYMENT_REFUND_ALERT_DELIVERY_UNAVAILABLE'
    );
  });
});
