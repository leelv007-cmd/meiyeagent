import { beforeEach, describe, expect, it, vi } from 'vitest';

const plan = {
  id: 'growth',
  isFree: false,
  isLifetime: false,
  prices: [
    {
      amount: 49_900,
      currency: 'CNY',
      interval: 'month',
      priceId: 'prod_growth_month',
      type: 'subscription',
    },
  ],
};

vi.mock('@/db', () => ({ getDb: vi.fn() }));
vi.mock('@/notification', () => ({ sendPaymentNotification: vi.fn() }));
vi.mock('@/lib/price-plan', () => ({
  findPlanByPlanId: (planId: string) => (planId === plan.id ? plan : undefined),
  findPlanByPriceId: (priceId: string) =>
    priceId === plan.prices[0].priceId ? plan : undefined,
  findPriceInPlan: (planId: string, priceId: string) =>
    planId === plan.id && priceId === plan.prices[0].priceId
      ? plan.prices[0]
      : undefined,
}));

describe('Creem checkout catalog boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-catalog product before any Creem API call', async () => {
    const { CreemProvider } = await import('./creem');
    const productsGet = vi.fn();
    const checkoutCreate = vi.fn();
    type TestProvider = {
      client: {
        checkouts: { create: typeof checkoutCreate };
        products: { get: typeof productsGet };
      };
      createCheckout: InstanceType<typeof CreemProvider>['createCheckout'];
    };
    const provider = Object.create(CreemProvider.prototype) as TestProvider;
    provider.client = {
      checkouts: { create: checkoutCreate },
      products: { get: productsGet },
    };

    await expect(
      provider.createCheckout({
        customerEmail: 'user@example.test',
        planId: 'forged-plan',
        priceId: 'prod_historical',
      })
    ).rejects.toThrow();
    expect(productsGet).not.toHaveBeenCalled();
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('rejects a remote product whose amount differs from the canonical catalog', async () => {
    const { CreemProvider } = await import('./creem');
    const productsGet = vi.fn().mockResolvedValue({
      billingPeriod: 'every-month',
      billingType: 'recurring',
      currency: 'CNY',
      id: 'prod_growth_month',
      price: 1,
      status: 'active',
    });
    const checkoutCreate = vi.fn();
    type TestProvider = {
      client: {
        checkouts: { create: typeof checkoutCreate };
        products: { get: typeof productsGet };
      };
      createCheckout: InstanceType<typeof CreemProvider>['createCheckout'];
    };
    const provider = Object.create(CreemProvider.prototype) as TestProvider;
    provider.client = {
      checkouts: { create: checkoutCreate },
      products: { get: productsGet },
    };

    await expect(
      provider.createCheckout({
        customerEmail: 'user@example.test',
        planId: 'growth',
        priceId: 'prod_growth_month',
      })
    ).rejects.toThrow();
    expect(productsGet).toHaveBeenCalledWith('prod_growth_month');
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('creates checkout only after the local and remote catalogs agree', async () => {
    const { CreemProvider } = await import('./creem');
    const productsGet = vi.fn().mockResolvedValue({
      billingPeriod: 'every-month',
      billingType: 'recurring',
      currency: 'CNY',
      id: 'prod_growth_month',
      price: 49_900,
      status: 'active',
    });
    const checkoutCreate = vi.fn().mockResolvedValue({
      checkoutUrl: 'https://checkout.creem.io/ch_1',
      id: 'ch_1',
    });
    type TestProvider = {
      client: {
        checkouts: { create: typeof checkoutCreate };
        products: { get: typeof productsGet };
      };
      createCheckout: InstanceType<typeof CreemProvider>['createCheckout'];
    };
    const provider = Object.create(CreemProvider.prototype) as TestProvider;
    provider.client = {
      checkouts: { create: checkoutCreate },
      products: { get: productsGet },
    };

    await expect(
      provider.createCheckout({
        customerEmail: 'user@example.test',
        planId: 'growth',
        priceId: 'prod_growth_month',
        successUrl: 'https://app.example.test/settings/billing',
      })
    ).resolves.toEqual({
      id: 'ch_1',
      url: 'https://checkout.creem.io/ch_1',
    });
    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'prod_growth_month' })
    );
  });
});
