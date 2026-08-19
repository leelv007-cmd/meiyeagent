import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookEvent } from '@waffo/pancake-ts';
import { resolvePaymentRuntimePolicy } from '@/config/payment-runtime-policy';
import type { WaffoClient } from '@/payment/provider/waffo';

const commerceAuthority = {
  currency: 'HKD' as const,
  paymentMappingRevision: 3,
  planRevision: 'plan.credits.growth@7',
};

describe('Waffo checkout catalog boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires Core commerce authority before any Waffo API call', async () => {
    const { WaffoProvider } = await import('./waffo');
    const create = vi.fn();
    const provider = new WaffoProvider({
      client: fakeClient(create),
      environment: 'test',
    });

    await expect(
      provider.createCheckout({
        customerEmail: 'user@example.test',
        metadata: {
          planCheckoutBindingId: 'pcb_1',
          userId: 'user_1',
          workspaceId: 'ws_1',
        },
        planId: 'forged-plan',
        priceId: 'PROD_historical',
      })
    ).rejects.toThrow('Core commerce authority');
    expect(create).not.toHaveBeenCalled();
  });

  it('requires a durable binding and user identity before creating checkout', async () => {
    const { WaffoProvider } = await import('./waffo');
    const create = vi.fn();
    const provider = new WaffoProvider({
      client: fakeClient(create),
      environment: 'test',
    });

    await expect(
      provider.createCheckout({
        commerceAuthority,
        customerEmail: 'user@example.test',
        metadata: { workspaceId: 'ws_1' },
        planId: 'growth',
        priceId: 'PROD_GROWTH_MONTH',
      })
    ).rejects.toThrow('metadata.userId');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects Production checkout authority before any Waffo API call', async () => {
    const { WaffoProvider } = await import('./waffo');
    const create = vi.fn();
    const provider = new WaffoProvider({
      client: fakeClient(create),
      environment: 'production',
    });

    await expect(
      provider.createCheckout({
        commerceAuthority,
        customerEmail: 'user@example.test',
        metadata: {
          planCheckoutBindingId: 'pcb_production',
          userId: 'user_production',
          workspaceId: 'ws_production',
        },
        planId: 'growth',
        priceId: 'PROD_GROWTH_MONTH',
      })
    ).rejects.toThrow('WAFFO_ENVIRONMENT=test');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a public Test gate with Production server authority', async () => {
    expect(
      resolvePaymentRuntimePolicy({
        provider: 'waffo',
        waffoTestCheckoutEnabled: true,
      }).enabled
    ).toBe(true);

    const { WaffoProvider } = await import('./waffo');
    const create = vi.fn();
    const provider = new WaffoProvider({
      client: fakeClient(create),
      environment: 'production',
    });

    await expect(
      provider.createCheckout({
        commerceAuthority,
        customerEmail: 'user@example.test',
        metadata: {
          planCheckoutBindingId: 'pcb_public-gate',
          userId: 'user_public-gate',
          workspaceId: 'ws_public-gate',
        },
        planId: 'growth',
        priceId: 'PROD_GROWTH_MONTH',
      })
    ).rejects.toThrow('WAFFO_ENVIRONMENT=test');
    expect(create).not.toHaveBeenCalled();
  });

  it('creates authenticated checkout with the binding as the order reference', async () => {
    const { WaffoProvider } = await import('./waffo');
    const create = vi.fn().mockResolvedValue({
      checkoutUrl: 'https://checkout.waffo.test/session-1',
      sessionId: 'waffo-session-1',
    });
    const provider = new WaffoProvider({
      client: fakeClient(create),
      environment: 'test',
    });

    await expect(
      provider.createCheckout({
        commerceAuthority,
        customerEmail: 'user@example.test',
        metadata: {
          planCheckoutBindingId: 'pcb_1',
          userId: 'user_1',
          workspaceId: 'ws_1',
        },
        planId: 'growth',
        priceId: 'PROD_GROWTH_MONTH',
        successUrl: 'https://app.example.test/settings/billing',
      })
    ).resolves.toEqual({
      id: 'waffo-session-1',
      url: 'https://checkout.waffo.test/session-1?test=true',
    });
    expect(create).toHaveBeenCalledWith({
      buyerEmail: 'user@example.test',
      buyerIdentity: 'user_1',
      currency: 'HKD',
      metadata: {
        planCheckoutBindingId: 'pcb_1',
        userId: 'user_1',
        workspaceId: 'ws_1',
      },
      orderMerchantExternalId: 'pcb_1',
      productId: 'PROD_GROWTH_MONTH',
      successUrl: 'https://app.example.test/settings/billing',
      withTrial: false,
    });
  });

  it('reads subscription amount, currency, and status from the Test provider', async () => {
    const { WaffoProvider } = await import('./waffo');
    const client = fakeClient(vi.fn());
    client.graphql = {
      query: vi.fn().mockResolvedValue({
        data: {
          subscriptionProducts: [
            {
              id: 'PROD_GROWTH_MONTH',
              prices: [{ currency: 'HKD', priceInfo: { amount: '522.00' } }],
              status: 'active',
            },
          ],
        },
      }),
    };
    const provider = new WaffoProvider({
      client,
      environment: 'test',
      storeId: 'STO_TEST',
    });

    await expect(
      provider.readSubscriptionProductFacts(['PROD_GROWTH_MONTH'])
    ).resolves.toEqual([
      {
        amount: '522.00',
        currency: 'HKD',
        productId: 'PROD_GROWTH_MONTH',
        status: 'active',
      },
    ]);
  });

  it('marks a Test checkout URL without discarding its authenticated token', async () => {
    const { WaffoProvider } = await import('./waffo');
    const create = vi.fn().mockResolvedValue({
      checkoutUrl:
        'https://pancake.waffo.ai/store/STO_TEST/checkout/cs_test#token=test-only-jwt',
      sessionId: 'waffo-session-test',
    });
    const provider = new WaffoProvider({
      client: fakeClient(create),
      environment: 'test',
    });

    await expect(
      provider.createCheckout({
        commerceAuthority,
        customerEmail: 'user@example.test',
        metadata: {
          planCheckoutBindingId: 'pcb_test',
          userId: 'user_test',
          workspaceId: 'ws_test',
        },
        planId: 'growth',
        priceId: 'PROD_GROWTH_MONTH',
      })
    ).resolves.toEqual({
      id: 'waffo-session-test',
      url: 'https://pancake.waffo.ai/store/STO_TEST/checkout/cs_test?test=true#token=test-only-jwt',
    });
  });

  it('rejects a Test-mode webhook under production authority', async () => {
    const { WaffoProvider } = await import('./waffo');
    const provider = new WaffoProvider({
      client: fakeClient(vi.fn(), {
        data: { orderId: 'waffo-order-001' },
        eventId: 'waffo-payment-001',
        eventType: 'subscription.payment_succeeded',
        id: 'waffo-delivery-001',
        mode: 'test',
      }),
      environment: 'production',
      webhookPublicKeys: { prod: 'production-key' },
    });

    await expect(
      provider.handleWebhookEvent('{"signed":true}', 't=1,v1=signature')
    ).rejects.toThrow('Waffo webhook mode does not match its authority');
  });

  it('locks webhook verification to Test and rejects production events', async () => {
    const { WaffoProvider } = await import('./waffo');
    const client = fakeClient(vi.fn(), {
      data: { orderId: 'waffo-order-production-001' },
      eventId: 'waffo-payment-production-001',
      eventType: 'subscription.payment_succeeded',
      id: 'waffo-delivery-production-001',
      mode: 'prod',
    });
    const verify = vi.spyOn(client.webhooks, 'verify');
    const provider = new WaffoProvider({
      client,
      environment: 'test',
      webhookPublicKeys: { test: 'test-key' },
    });

    await expect(
      provider.handleWebhookEvent('{"signed":true}', 't=1,v1=signature')
    ).rejects.toThrow('Waffo webhook mode does not match its authority');
    expect(verify).toHaveBeenCalledWith('{"signed":true}', 't=1,v1=signature', {
      environment: 'test',
      publicKeys: { test: 'test-key' },
      toleranceMs: 0,
    });
  });

  it('schedules a paid single-month subscription to cancel at period end', async () => {
    const { WaffoProvider } = await import('./waffo');
    const cancelSubscription = vi.fn().mockResolvedValue({
      orderId: 'waffo-order-001',
      status: 'canceling',
    });
    const provider = new WaffoProvider({
      client: fakeClient(vi.fn(), undefined, cancelSubscription),
      environment: 'test',
    });

    await provider.cancelSubscriptionAtPeriodEnd('waffo-order-001');

    expect(cancelSubscription).toHaveBeenCalledWith({
      orderId: 'waffo-order-001',
    });
  });
});

function fakeClient(
  create: ReturnType<typeof vi.fn>,
  webhookEvent: Record<string, unknown> = {
    data: { orderId: 'waffo-order-001' },
    eventId: 'waffo-payment-001',
    eventType: 'subscription.payment_succeeded',
    id: 'waffo-delivery-001',
    mode: 'prod',
  },
  cancelSubscription: ReturnType<typeof vi.fn> = vi.fn()
): WaffoClient {
  const invokeCheckout = create as unknown as (input: unknown) => unknown;
  const invokeCancellation = cancelSubscription as unknown as (
    input: unknown
  ) => unknown;

  return {
    checkout: {
      authenticated: {
        create: async (input) =>
          invokeCheckout(input) as { checkoutUrl: string; sessionId: string },
      },
    },
    webhooks: {
      verify: () => webhookEvent as unknown as WebhookEvent,
    },
    orders: {
      cancelSubscription: async (input) => invokeCancellation(input),
    },
  };
}
