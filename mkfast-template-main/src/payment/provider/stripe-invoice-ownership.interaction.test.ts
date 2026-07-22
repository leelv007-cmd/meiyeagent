import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock('@/db', () => ({ getDb }));
vi.mock('@/notification', () => ({ sendPaymentNotification: vi.fn() }));
vi.mock('@/payment/webhook-logging', () => ({
  logPaymentWebhookError: vi.fn(),
}));

describe('Stripe invoice ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a one-time invoice whose event customer does not own the payment row', async () => {
    const { StripeProvider } = await import('./stripe');
    const updatePayment = vi.fn(() => ({
      set: () => ({ where: async () => undefined }),
    }));
    const paymentRecord = {
      cancelAtPeriodEnd: null,
      createdAt: new Date('2026-07-01T00:00:00Z'),
      customerId: 'cus-a',
      id: 'payment-a',
      interval: null,
      invoiceId: 'in-cross-user',
      paid: false,
      periodEnd: null,
      periodStart: null,
      priceId: 'price-lifetime',
      scene: 'lifetime',
      sessionId: null,
      status: 'pending',
      subscriptionId: null,
      trialEnd: null,
      trialStart: null,
      type: 'one_time',
      updatedAt: new Date('2026-07-01T00:00:00Z'),
      userId: 'user-a',
    };
    getDb.mockReturnValue({
      select: (selection?: unknown) =>
        selection
          ? {
              from: () => ({
                where: () => ({
                  limit: async () => [{ id: 'user-a' }],
                }),
              }),
            }
          : {
              from: () => ({
                where: () => ({
                  orderBy: () => ({ limit: async () => [paymentRecord] }),
                }),
              }),
            },
      update: updatePayment,
    });

    const retrieveCustomer = vi.fn(async () => ({
      id: 'cus-a',
      metadata: { meiye_user_id: 'user-a' },
    }));
    const provider = Object.create(StripeProvider.prototype) as {
      handleWebhookEvent: InstanceType<
        typeof StripeProvider
      >['handleWebhookEvent'];
      stripe: {
        customers: {
          retrieve: typeof retrieveCustomer;
          update: ReturnType<typeof vi.fn>;
        };
        webhooks: {
          constructEventAsync: ReturnType<typeof vi.fn>;
        };
      };
      webhookSecret: string;
    };
    provider.webhookSecret = 'whsec_historical';
    provider.stripe = {
      customers: { retrieve: retrieveCustomer, update: vi.fn() },
      webhooks: {
        constructEventAsync: vi.fn(async () => ({
          data: {
            object: {
              amount_paid: 29_900,
              billing_reason: 'manual',
              customer: 'cus-b',
              id: 'in-cross-user',
              lines: { data: [] },
              subscription: null,
            },
          },
          id: 'evt-invoice-cross-user',
          type: 'invoice.paid',
        })),
      },
    };

    await expect(
      provider.handleWebhookEvent('{}', 'signature')
    ).rejects.toThrow('Failed to handle webhook event');

    expect(retrieveCustomer).not.toHaveBeenCalled();
    expect(updatePayment).not.toHaveBeenCalled();
  });

  it('validates subscription customer ownership before rejecting an invoice without a price', async () => {
    const { StripeProvider } = await import('./stripe');
    const updatePayment = vi.fn();
    const paymentRecord = {
      customerId: 'cus-a',
      id: 'payment-a',
      invoiceId: 'in-no-price',
      sessionId: null,
      subscriptionId: 'sub-a',
      type: 'subscription',
      userId: 'user-a',
    };
    getDb.mockReturnValue({
      select: (selection?: unknown) =>
        selection
          ? {
              from: () => ({
                where: () => ({
                  limit: async () => [{ id: 'user-a' }],
                }),
              }),
            }
          : {
              from: () => ({
                where: () => ({
                  orderBy: () => ({ limit: async () => [paymentRecord] }),
                }),
              }),
            },
      update: updatePayment,
    });

    const retrieveCustomer = vi.fn(async () => ({
      id: 'cus-b',
      metadata: { meiye_user_id: 'user-b' },
    }));
    const retrieveSubscription = vi.fn(async () => ({
      customer: 'cus-b',
      id: 'sub-a',
      items: { data: [] },
    }));
    const provider = Object.create(StripeProvider.prototype) as {
      handleWebhookEvent: InstanceType<
        typeof StripeProvider
      >['handleWebhookEvent'];
      stripe: {
        customers: {
          retrieve: typeof retrieveCustomer;
          update: ReturnType<typeof vi.fn>;
        };
        subscriptions: { retrieve: typeof retrieveSubscription };
        webhooks: {
          constructEventAsync: ReturnType<typeof vi.fn>;
        };
      };
      webhookSecret: string;
    };
    provider.webhookSecret = 'whsec_historical';
    provider.stripe = {
      customers: { retrieve: retrieveCustomer, update: vi.fn() },
      subscriptions: { retrieve: retrieveSubscription },
      webhooks: {
        constructEventAsync: vi.fn(async () => ({
          data: {
            object: {
              billing_reason: 'subscription_cycle',
              customer: 'cus-a',
              id: 'in-no-price',
              lines: { data: [] },
              subscription: 'sub-a',
            },
          },
          id: 'evt-invoice-no-price',
          type: 'invoice.paid',
        })),
      },
    };

    await expect(
      provider.handleWebhookEvent('{}', 'signature')
    ).rejects.toThrow('Failed to handle webhook event');

    expect(retrieveCustomer).toHaveBeenCalledWith('cus-b');
    expect(updatePayment).not.toHaveBeenCalled();
  });
});
