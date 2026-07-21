import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stripeConstructor } = vi.hoisted(() => ({
  stripeConstructor: vi.fn(),
}));

vi.mock('stripe', () => ({ Stripe: stripeConstructor }));
vi.mock('@/db', () => ({ getDb: vi.fn() }));
vi.mock('@/notification', () => ({ sendPaymentNotification: vi.fn() }));

describe('Stripe historical lifecycle API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_historical');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_historical');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('pins the Stripe SDK to the installed compatible API version', async () => {
    const { StripeProvider } = await import('./stripe');

    new StripeProvider();

    expect(stripeConstructor).toHaveBeenCalledWith('sk_test_historical', {
      apiVersion: '2025-02-24.acacia',
    });
  });
});
