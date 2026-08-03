import { describe, expect, it, vi } from 'vitest';
import { WaffoProvider, type WaffoClient } from './waffo';

describe('Waffo credit-package checkout', () => {
  it('creates a Test-only authenticated one-time checkout bound to one package purchase', async () => {
    const create = vi.fn().mockResolvedValue({
      checkoutUrl: 'https://checkout.waffo.test/package-001',
      sessionId: 'waffo-package-session-001',
    });
    const provider = new WaffoProvider({
      client: fakeClient(create),
      environment: 'test',
    });

    await expect(
      provider.createCreditPackageCheckout({
        buyerEmail: 'owner@example.test',
        buyerIdentity: 'user_001',
        currency: 'HKD',
        packageCheckoutBindingId: 'cpb_001',
        productId: 'PROD_CREDITS_300',
        successUrl: 'https://app.example.test/settings/billing',
      })
    ).resolves.toEqual({
      id: 'waffo-package-session-001',
      url: 'https://checkout.waffo.test/package-001?test=true',
    });

    expect(create).toHaveBeenCalledExactlyOnceWith({
      buyerEmail: 'owner@example.test',
      buyerIdentity: 'user_001',
      currency: 'HKD',
      metadata: { creditPackageCheckoutBindingId: 'cpb_001' },
      orderMerchantExternalId: 'cpb_001',
      productId: 'PROD_CREDITS_300',
      successUrl: 'https://app.example.test/settings/billing',
    });
  });

  it('rejects a Production authority before the Waffo SDK receives a package checkout call', async () => {
    const create = vi.fn();
    const provider = new WaffoProvider({
      client: fakeClient(create),
      environment: 'production',
    });

    await expect(
      provider.createCreditPackageCheckout({
        buyerIdentity: 'user_001',
        currency: 'HKD',
        packageCheckoutBindingId: 'cpb_001',
        productId: 'PROD_CREDITS_300',
      })
    ).rejects.toThrow('WAFFO_ENVIRONMENT=test');
    expect(create).not.toHaveBeenCalled();
  });
});

function fakeClient(create: ReturnType<typeof vi.fn>): WaffoClient {
  return {
    checkout: { authenticated: { create } },
    orders: { cancelSubscription: vi.fn() },
    webhooks: { verify: vi.fn() },
  } as unknown as WaffoClient;
}
