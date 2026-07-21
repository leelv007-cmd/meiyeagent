import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ getDb: vi.fn() }));
vi.mock('@/notification', () => ({ sendPaymentNotification: vi.fn() }));

describe('Stripe retirement boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks all new Stripe commerce without calling the remote API', async () => {
    const { StripeProvider } = await import('./stripe');
    type TestProvider = {
      createCheckout: InstanceType<typeof StripeProvider>['createCheckout'];
      createCustomerPortal: InstanceType<
        typeof StripeProvider
      >['createCustomerPortal'];
      stripe: { prices: { retrieve: ReturnType<typeof vi.fn> } };
      validateServerCatalogOffer: InstanceType<
        typeof StripeProvider
      >['validateServerCatalogOffer'];
    };
    const provider = Object.create(StripeProvider.prototype) as TestProvider;
    const retrieve = vi.fn();
    provider.stripe = { prices: { retrieve } };

    await expect(
      provider.validateServerCatalogOffer({
        kind: 'pro_studio_add_on',
        offerId: 'pro-studio-v1',
        price: {
          amount: 29_900,
          currency: 'CNY',
          priceId: 'price_retired',
          type: 'one_time',
        },
      })
    ).rejects.toMatchObject({ code: 'STRIPE_NEW_COMMERCE_RETIRED' });
    await expect(
      provider.createCheckout({
        customerEmail: 'user@example.test',
        planId: 'growth',
        priceId: 'price_retired',
      })
    ).rejects.toMatchObject({ code: 'STRIPE_NEW_COMMERCE_RETIRED' });
    await expect(
      provider.createCustomerPortal({ customerId: 'cus_legacy' })
    ).rejects.toMatchObject({ code: 'STRIPE_NEW_COMMERCE_RETIRED' });
    expect(retrieve).not.toHaveBeenCalled();
  }, 15_000);
});
