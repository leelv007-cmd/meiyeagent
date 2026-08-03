import { describe, expect, it, vi } from 'vitest';
import type { WaffoClient } from '@/payment/provider/waffo';

vi.mock('@/lib/price-plan', () => ({
  findPlanByPlanId: () => undefined,
  findPriceInPlan: () => undefined,
}));

const ACTIVATION_PAYLOAD = {
  data: {
    merchantProvidedBuyerIdentity: 'user-001',
    orderId: 'ORD_recovery_1',
    orderMerchantExternalId: 'pcb_recovery_1',
  },
  eventId: 'ORD_recovery_1',
  eventType: 'subscription.activated',
  id: 'delivery-recovery-1',
  mode: 'test',
};

const PROVIDER_PERIOD = {
  currentPeriodEnd: '2026-09-03T12:35:43.000Z',
  currentPeriodStart: '2026-08-03T12:35:43.000Z',
};

function recoveryClient(
  webhookEvent: Record<string, unknown>,
  graphql: ReturnType<typeof vi.fn>
): WaffoClient {
  return {
    checkout: {
      authenticated: {
        create: vi.fn() as unknown as (input: never) => never,
      },
    },
    graphql: {
      query: graphql as unknown as (input: never) => never,
    },
    orders: {
      cancelSubscription: vi.fn() as unknown as (input: never) => never,
    },
    webhooks: {
      verify: () => webhookEvent as never,
    },
  } as unknown as WaffoClient;
}

function orderLookupResult(orders: Array<Record<string, unknown>>) {
  return { data: { subscriptionOrders: orders } };
}

describe('Waffo billing period recovery', () => {
  it('recovers a missing billing period from the provider order', async () => {
    const { WaffoProvider } = await import('./waffo');
    const graphql = vi.fn().mockResolvedValue(
      orderLookupResult([{ id: 'ORD_recovery_1', ...PROVIDER_PERIOD }])
    );
    const provider = new WaffoProvider({
      client: recoveryClient(ACTIVATION_PAYLOAD, graphql),
      environment: 'test',
      storeId: 'STO_test',
      webhookPublicKeys: { test: 'test-key' },
    });

    const event = await provider.handleWebhookEvent('{}', 'sig');

    expect(event?.eventType).toBe('checkout.completed');
    expect(event?.periodStartsAt).toBe(PROVIDER_PERIOD.currentPeriodStart);
    expect(event?.periodEndsAt).toBe(PROVIDER_PERIOD.currentPeriodEnd);
    expect(graphql).toHaveBeenCalledTimes(1);
    expect(graphql.mock.calls[0][0].variables).toEqual({
      orderId: 'ORD_recovery_1',
      storeId: 'STO_test',
    });
  });

  it('recovers renewal periods for subscription.payment_succeeded', async () => {
    const { WaffoProvider } = await import('./waffo');
    const graphql = vi.fn().mockResolvedValue(
      orderLookupResult([{ id: 'ORD_recovery_1', ...PROVIDER_PERIOD }])
    );
    const provider = new WaffoProvider({
      client: recoveryClient(
        {
          ...ACTIVATION_PAYLOAD,
          eventId: 'PAY_recovery_1',
          eventType: 'subscription.payment_succeeded',
          id: 'delivery-recovery-2',
        },
        graphql
      ),
      environment: 'test',
      storeId: 'STO_test',
      webhookPublicKeys: { test: 'test-key' },
    });

    const event = await provider.handleWebhookEvent('{}', 'sig');

    expect(event?.eventType).toBe('subscription.renewed');
    expect(event?.periodStartsAt).toBe(PROVIDER_PERIOD.currentPeriodStart);
    expect(event?.periodEndsAt).toBe(PROVIDER_PERIOD.currentPeriodEnd);
  });

  it('fails closed with a retryable code when the provider has no period', async () => {
    const { WaffoProvider } = await import('./waffo');
    const graphql = vi.fn().mockResolvedValue(orderLookupResult([]));
    const provider = new WaffoProvider({
      client: recoveryClient(ACTIVATION_PAYLOAD, graphql),
      environment: 'test',
      storeId: 'STO_test',
      webhookPublicKeys: { test: 'test-key' },
    });

    await expect(
      provider.handleWebhookEvent('{}', 'sig')
    ).rejects.toMatchObject({ code: 'WAFFO_PERIOD_RECOVERY_UNAVAILABLE' });
  });

  it('fails closed when the recovered period is not a valid range', async () => {
    const { WaffoProvider } = await import('./waffo');
    const graphql = vi.fn().mockResolvedValue(
      orderLookupResult([
        {
          currentPeriodEnd: '2026-08-03T12:35:43.000Z',
          currentPeriodStart: '2026-08-03T12:35:43.000Z',
          id: 'ORD_recovery_1',
        },
      ])
    );
    const provider = new WaffoProvider({
      client: recoveryClient(ACTIVATION_PAYLOAD, graphql),
      environment: 'test',
      storeId: 'STO_test',
      webhookPublicKeys: { test: 'test-key' },
    });

    await expect(
      provider.handleWebhookEvent('{}', 'sig')
    ).rejects.toMatchObject({ code: 'WAFFO_PERIOD_RECOVERY_UNAVAILABLE' });
  });

  it('does not query the provider when the payload already carries a period', async () => {
    const { WaffoProvider } = await import('./waffo');
    const graphql = vi.fn();
    const provider = new WaffoProvider({
      client: recoveryClient(
        {
          ...ACTIVATION_PAYLOAD,
          data: {
            ...ACTIVATION_PAYLOAD.data,
            currentPeriodEnd: '2026-09-03',
            currentPeriodStart: '2026-08-03',
          },
        },
        graphql
      ),
      environment: 'test',
      storeId: 'STO_test',
      webhookPublicKeys: { test: 'test-key' },
    });

    const event = await provider.handleWebhookEvent('{}', 'sig');

    expect(event?.periodStartsAt).toBe('2026-08-03');
    expect(event?.periodEndsAt).toBe('2026-09-03');
    expect(graphql).not.toHaveBeenCalled();
  });

  it('does not query the provider for non-paid lifecycle events', async () => {
    const { WaffoProvider } = await import('./waffo');
    const graphql = vi.fn();
    const provider = new WaffoProvider({
      client: recoveryClient(
        {
          ...ACTIVATION_PAYLOAD,
          eventId: 'CANCEL_recovery_1',
          eventType: 'subscription.canceling',
          id: 'delivery-recovery-3',
        },
        graphql
      ),
      environment: 'test',
      storeId: 'STO_test',
      webhookPublicKeys: { test: 'test-key' },
    });

    const event = await provider.handleWebhookEvent('{}', 'sig');

    expect(event?.eventType).toBe('customer.subscription.updated');
    expect(graphql).not.toHaveBeenCalled();
  });
});
