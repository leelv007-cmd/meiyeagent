import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock('@/db', () => ({ getDb }));
vi.mock('@/notification', () => ({ sendPaymentNotification: vi.fn() }));
vi.mock('@/payment/webhook-logging', () => ({
  logPaymentWebhookError: vi.fn(),
}));

describe('Stripe historical customer ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not update a historical subscription for a same-email customer owned by another user', async () => {
    const { StripeProvider } = await import('./stripe');
    const update = vi.fn();
    getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 'user-a' }],
          }),
        }),
      }),
      update,
    });

    const retrieveCustomer = vi.fn(async () => ({
      id: 'cus-user-b',
      metadata: { meiye_user_id: 'user-b' },
    }));
    const provider = Object.create(StripeProvider.prototype) as {
      handleWebhookEvent: InstanceType<
        typeof StripeProvider
      >['handleWebhookEvent'];
      stripe: {
        customers: { retrieve: typeof retrieveCustomer };
        webhooks: {
          constructEventAsync: ReturnType<typeof vi.fn>;
        };
      };
      webhookSecret: string;
    };
    provider.webhookSecret = 'whsec_historical';
    provider.stripe = {
      customers: { retrieve: retrieveCustomer },
      webhooks: {
        constructEventAsync: vi.fn(async () => ({
          data: {
            object: {
              cancel_at_period_end: false,
              customer: 'cus-user-b',
              id: 'sub-user-b',
              items: { data: [{ price: { id: 'price-growth' } }] },
              status: 'active',
            },
          },
          id: 'evt-user-b',
          type: 'customer.subscription.updated',
        })),
      },
    };

    await expect(
      provider.handleWebhookEvent('{}', 'signature')
    ).rejects.toThrow('Failed to handle webhook event');

    expect(retrieveCustomer).toHaveBeenCalledWith('cus-user-b');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not create a historical payment record for a same-email customer owned by another user', async () => {
    const { StripeProvider } = await import('./stripe');
    const insert = vi.fn();
    getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 'user-a' }],
          }),
        }),
      }),
      insert,
    });

    const retrieveCustomer = vi.fn(async () => ({
      id: 'cus-user-b',
      metadata: { meiye_user_id: 'user-b' },
    }));
    const provider = Object.create(StripeProvider.prototype) as {
      handleWebhookEvent: InstanceType<
        typeof StripeProvider
      >['handleWebhookEvent'];
      stripe: {
        customers: { retrieve: typeof retrieveCustomer };
        webhooks: {
          constructEventAsync: ReturnType<typeof vi.fn>;
        };
      };
      webhookSecret: string;
    };
    provider.webhookSecret = 'whsec_historical';
    provider.stripe = {
      customers: { retrieve: retrieveCustomer },
      webhooks: {
        constructEventAsync: vi.fn(async () => ({
          data: {
            object: {
              customer: 'cus-user-b',
              id: 'cs-user-b',
              metadata: { priceId: 'price-legacy', userId: 'user-a' },
              mode: 'payment',
              payment_status: 'paid',
            },
          },
          id: 'evt-checkout-user-b',
          type: 'checkout.session.completed',
        })),
      },
    };

    await expect(
      provider.handleWebhookEvent('{}', 'signature')
    ).rejects.toThrow('Failed to handle webhook event');

    expect(retrieveCustomer).toHaveBeenCalledWith('cus-user-b');
    expect(insert).not.toHaveBeenCalled();
  });
});
