import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock('@/db', () => ({ getDb }));
vi.mock('@/notification', () => ({ sendPaymentNotification: vi.fn() }));
vi.mock('@/payment/webhook-logging', () => ({
  logPaymentWebhookError: vi.fn(),
}));

type StripeProviderConstructor = typeof import('./stripe').StripeProvider;

function subscriptionEvent(input: {
  customerId: string;
  eventId: string;
  subscriptionId: string;
  type?: 'customer.subscription.deleted' | 'customer.subscription.updated';
}) {
  const type = input.type ?? 'customer.subscription.updated';
  return {
    data: {
      object: {
        customer: input.customerId,
        id: input.subscriptionId,
        status:
          type === 'customer.subscription.deleted' ? 'canceled' : 'active',
        ...(type === 'customer.subscription.updated'
          ? {
              cancel_at_period_end: false,
              items: {
                data: [
                  {
                    plan: { interval: 'month' },
                    price: { id: 'price-growth' },
                  },
                ],
              },
            }
          : {}),
      },
    },
    id: input.eventId,
    type,
  };
}

function makeProvider(
  Provider: StripeProviderConstructor,
  event: unknown,
  customer: { id: string; metadata: Record<string, string> },
  updatedCustomer = customer
) {
  const retrieveCustomer = vi.fn(async () => customer);
  const updateCustomer = vi.fn(async () => updatedCustomer);
  const provider = Object.create(Provider.prototype) as {
    handleWebhookEvent: InstanceType<StripeProviderConstructor>['handleWebhookEvent'];
    stripe: {
      customers: {
        retrieve: typeof retrieveCustomer;
        update: typeof updateCustomer;
      };
      webhooks: {
        constructEventAsync: ReturnType<typeof vi.fn>;
      };
    };
    webhookSecret: string;
  };
  provider.webhookSecret = 'whsec_historical';
  provider.stripe = {
    customers: { retrieve: retrieveCustomer, update: updateCustomer },
    webhooks: { constructEventAsync: vi.fn(async () => event) },
  };
  return { provider, retrieveCustomer, updateCustomer };
}

function installSubscriptionDb(input?: {
  captureWhere?: (condition: SQL) => void;
  rows?: { id: string }[];
  userIds?: string[];
}) {
  const rows = input?.rows ?? [{ id: 'payment-a' }];
  const userIds = input?.userIds ?? ['user-a'];
  const updatePayment = vi.fn(() => ({
    set: () => ({
      where: (condition: SQL) => {
        input?.captureWhere?.(condition);
        return { returning: async () => rows };
      },
    }),
  }));
  getDb.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => userIds.map((id) => ({ id })),
        }),
      }),
    }),
    update: updatePayment,
  });
  return updatePayment;
}

function expectVerifiedBindingWhere(whereClause: SQL | undefined) {
  expect(whereClause).toBeDefined();
  expect(new PgDialect().sqlToQuery(whereClause!)).toMatchObject({
    params: ['sub-a', 'user-a', 'cus-a'],
    sql: '("payment"."subscription_id" = $1 and "payment"."user_id" = $2 and "payment"."customer_id" = $3)',
  });
}

describe('Stripe historical customer ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not update a historical subscription for a same-email customer owned by another user', async () => {
    const { StripeProvider } = await import('./stripe');
    const updatePayment = installSubscriptionDb();
    const { provider, updateCustomer } = makeProvider(
      StripeProvider,
      subscriptionEvent({
        customerId: 'cus-user-b',
        eventId: 'evt-user-b',
        subscriptionId: 'sub-user-b',
      }),
      {
        id: 'cus-user-b',
        metadata: { meiye_user_id: 'user-b' },
      }
    );

    await expect(
      provider.handleWebhookEvent('{}', 'signature')
    ).rejects.toThrow('Failed to handle webhook event');

    expect(updateCustomer).not.toHaveBeenCalled();
    expect(updatePayment).not.toHaveBeenCalled();
  });

  it('does not create a historical payment record for a same-email customer owned by another user', async () => {
    const { StripeProvider } = await import('./stripe');
    const insertPayment = vi.fn();
    getDb.mockReturnValue({
      insert: insertPayment,
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ id: 'user-a' }] }),
        }),
      }),
    });
    const { provider, updateCustomer } = makeProvider(
      StripeProvider,
      {
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
      },
      {
        id: 'cus-user-b',
        metadata: { meiye_user_id: 'user-b' },
      }
    );

    await expect(
      provider.handleWebhookEvent('{}', 'signature')
    ).rejects.toThrow('Failed to handle webhook event');

    expect(updateCustomer).not.toHaveBeenCalled();
    expect(insertPayment).not.toHaveBeenCalled();
  });

  it('backfills an unambiguous historical customer before applying its subscription update', async () => {
    const { StripeProvider } = await import('./stripe');
    installSubscriptionDb();
    const { provider, updateCustomer } = makeProvider(
      StripeProvider,
      subscriptionEvent({
        customerId: 'cus-legacy',
        eventId: 'evt-legacy',
        subscriptionId: 'sub-legacy',
      }),
      { id: 'cus-legacy', metadata: {} },
      {
        id: 'cus-legacy',
        metadata: { meiye_user_id: 'user-a' },
      }
    );

    await expect(
      provider.handleWebhookEvent('{}', 'signature')
    ).resolves.toBeNull();
    expect(updateCustomer).toHaveBeenCalledWith('cus-legacy', {
      metadata: { meiye_user_id: 'user-a' },
    });
  });

  it('rejects an ambiguous local customer binding without backfilling Stripe metadata', async () => {
    const { StripeProvider } = await import('./stripe');
    installSubscriptionDb({ userIds: ['user-a', 'user-b'] });
    const { provider, retrieveCustomer, updateCustomer } = makeProvider(
      StripeProvider,
      subscriptionEvent({
        customerId: 'cus-duplicate',
        eventId: 'evt-duplicate',
        subscriptionId: 'sub-duplicate',
      }),
      { id: 'cus-duplicate', metadata: {} },
      {
        id: 'cus-duplicate',
        metadata: { meiye_user_id: 'user-a' },
      }
    );

    await expect(
      provider.handleWebhookEvent('{}', 'signature')
    ).rejects.toThrow('Failed to handle webhook event');
    expect(retrieveCustomer).not.toHaveBeenCalled();
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  it('updates a subscription only through its verified subscription, user, and customer binding', async () => {
    const { StripeProvider } = await import('./stripe');
    let whereClause: SQL | undefined;
    installSubscriptionDb({
      captureWhere(condition) {
        whereClause = condition;
      },
    });
    const { provider } = makeProvider(
      StripeProvider,
      subscriptionEvent({
        customerId: 'cus-a',
        eventId: 'evt-a',
        subscriptionId: 'sub-a',
      }),
      { id: 'cus-a', metadata: { meiye_user_id: 'user-a' } }
    );

    await expect(
      provider.handleWebhookEvent('{}', 'signature')
    ).resolves.toBeNull();
    expectVerifiedBindingWhere(whereClause);
  });

  it('retries a subscription update when no payment matches the verified binding', async () => {
    const { StripeProvider } = await import('./stripe');
    installSubscriptionDb({ rows: [] });
    const { provider } = makeProvider(
      StripeProvider,
      subscriptionEvent({
        customerId: 'cus-a',
        eventId: 'evt-a',
        subscriptionId: 'sub-a',
      }),
      { id: 'cus-a', metadata: { meiye_user_id: 'user-a' } }
    );

    await expect(
      provider.handleWebhookEvent('{}', 'signature')
    ).rejects.toThrow('Failed to handle webhook event');
  });

  it('retries a subscription deletion that does not match the verified payment binding', async () => {
    const { StripeProvider } = await import('./stripe');
    let whereClause: SQL | undefined;
    installSubscriptionDb({
      captureWhere(condition) {
        whereClause = condition;
      },
      rows: [],
    });
    const { provider } = makeProvider(
      StripeProvider,
      subscriptionEvent({
        customerId: 'cus-a',
        eventId: 'evt-delete-a',
        subscriptionId: 'sub-a',
        type: 'customer.subscription.deleted',
      }),
      { id: 'cus-a', metadata: { meiye_user_id: 'user-a' } }
    );

    await expect(
      provider.handleWebhookEvent('{}', 'signature')
    ).rejects.toThrow('Failed to handle webhook event');
    expectVerifiedBindingWhere(whereClause);
  });
});
