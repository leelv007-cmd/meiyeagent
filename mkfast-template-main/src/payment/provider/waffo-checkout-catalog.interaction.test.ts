import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookEvent } from '@waffo/pancake-ts';
import type { WaffoClient } from './waffo';

const plan = {
  id: 'growth',
  isFree: false,
  isLifetime: false,
  prices: [
    {
      amount: 49_900,
      currency: 'CNY',
      interval: 'month',
      priceId: 'PROD_GROWTH_MONTH',
      type: 'subscription',
    },
  ],
};

vi.mock('@/lib/price-plan', () => ({
  findPlanByPlanId: (planId: string) => (planId === plan.id ? plan : undefined),
  findPriceInPlan: (planId: string, priceId: string) =>
    planId === plan.id && priceId === plan.prices[0].priceId
      ? plan.prices[0]
      : undefined,
}));

describe('Waffo checkout catalog boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-catalog product before any Waffo API call', async () => {
    const { WaffoProvider } = await import('./waffo');
    const create = vi.fn();
    const provider = new WaffoProvider({
      client: fakeClient(create),
      allowTestEvents: true,
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
    ).rejects.toThrow('not available');
    expect(create).not.toHaveBeenCalled();
  });

  it('requires a durable binding and user identity before creating checkout', async () => {
    const { WaffoProvider } = await import('./waffo');
    const create = vi.fn();
    const provider = new WaffoProvider({
      client: fakeClient(create),
      allowTestEvents: true,
    });

    await expect(
      provider.createCheckout({
        customerEmail: 'user@example.test',
        metadata: { workspaceId: 'ws_1' },
        planId: 'growth',
        priceId: 'PROD_GROWTH_MONTH',
      })
    ).rejects.toThrow('metadata.userId');
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
      allowTestEvents: true,
    });

    await expect(
      provider.createCheckout({
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
      url: 'https://checkout.waffo.test/session-1',
    });
    expect(create).toHaveBeenCalledWith({
      buyerEmail: 'user@example.test',
      buyerIdentity: 'user_1',
      currency: 'CNY',
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

  it('does not allow test-mode webhook events outside an explicit sandbox', async () => {
    const { WaffoProvider } = await import('./waffo');
    const provider = new WaffoProvider({
      client: fakeClient(vi.fn(), {
        data: { orderId: 'waffo-order-001' },
        eventId: 'waffo-payment-001',
        eventType: 'subscription.payment_succeeded',
        id: 'waffo-delivery-001',
        mode: 'test',
      }),
      allowTestEvents: false,
    });

    await expect(
      provider.handleWebhookEvent('{"signed":true}', 't=1,v1=signature')
    ).rejects.toThrow('Test-mode Waffo webhook events are disabled');
  });

  it('schedules a paid single-month subscription to cancel at period end', async () => {
    const { WaffoProvider } = await import('./waffo');
    const cancelSubscription = vi.fn().mockResolvedValue({
      orderId: 'waffo-order-001',
      status: 'canceling',
    });
    const provider = new WaffoProvider({
      client: fakeClient(vi.fn(), undefined, cancelSubscription),
      allowTestEvents: true,
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
