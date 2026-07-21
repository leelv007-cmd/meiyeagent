import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('payment runtime policy', () => {
  it('keeps Stripe webhook runtime configured while publishing no Stripe prices', async () => {
    vi.stubEnv('VITE_PAYMENT_PROVIDER', 'stripe');
    vi.stubEnv('VITE_PUBLIC_PAID_LAUNCH_ENABLED', 'true');
    vi.stubEnv('VITE_STRIPE_PRICE_PRO_MONTHLY', 'price_must_not_publish');
    vi.resetModules();

    const { websiteConfig } = await import('./website');
    const prices = Object.values(
      websiteConfig.payment?.price?.plans ?? {}
    ).flatMap((plan) => plan.prices);

    expect(websiteConfig.payment?.enable).toBe(true);
    expect(websiteConfig.payment?.provider).toBe('stripe');
    expect(prices.every((price) => price.priceId === '')).toBe(true);
  }, 15_000);
});
