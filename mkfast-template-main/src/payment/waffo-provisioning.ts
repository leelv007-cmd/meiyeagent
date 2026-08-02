import {
  WAFFO_SUBSCRIPTION_PRODUCTS,
  type WaffoProductIdKey,
  type WaffoSubscriptionPlanId,
} from './waffo-subscription-catalog';

type SubscriptionProductInput = {
  storeId: string;
  name: string;
  billingPeriod: 'monthly' | 'yearly';
  prices: { CNY: { amount: string; taxCategory: 'saas' } };
  metadata: Record<string, string>;
};

export interface WaffoSubscriptionProvisioningClient {
  subscriptionProducts: {
    create(
      input: SubscriptionProductInput
    ): Promise<{ product: { id: string } }>;
    publish(input: { id: string }): Promise<{ product: { id: string } }>;
  };
  subscriptionProductGroups: {
    create(input: {
      storeId: string;
      name: string;
      productIds: string[];
      rules: { sharedTrial: false };
    }): Promise<{ group: { id: string } }>;
    publish(input: { id: string }): Promise<{ group: { id: string } }>;
  };
  webhooks: {
    add(input: {
      storeId: string;
      channel: 'http';
      url: string;
      events: readonly string[];
      testMode: true;
    }): Promise<{ webhook: { id: string } }>;
  };
}

export const WAFFO_SUBSCRIPTION_WEBHOOK_EVENTS = [
  'subscription.activated',
  'subscription.payment_succeeded',
  'subscription.canceling',
  'subscription.uncanceled',
  'subscription.canceled',
] as const;

export async function provisionWaffoSubscriptionCatalog(
  client: WaffoSubscriptionProvisioningClient,
  input: { storeId: string; webhookUrl: string }
) {
  const productIds = {} as Record<WaffoProductIdKey, string>;
  const productIdsByPlan = {
    starter: [],
    growth: [],
    pro: [],
  } satisfies Record<WaffoSubscriptionPlanId, string[]>;

  for (const product of WAFFO_SUBSCRIPTION_PRODUCTS) {
    const created = await client.subscriptionProducts.create({
      storeId: input.storeId,
      name: `${titleCase(product.planId)} ${intervalLabel(product.interval)}`,
      billingPeriod: product.billingPeriod,
      prices: {
        CNY: { amount: centsToYuan(product.amount), taxCategory: 'saas' },
      },
      metadata: {
        commercePeriod: product.interval,
        commerceTier: product.planId,
      },
    });
    await client.subscriptionProducts.publish({ id: created.product.id });
    productIds[product.productIdKey] = created.product.id;
    productIdsByPlan[product.planId].push(created.product.id);
  }

  const productGroupIds = {} as Record<WaffoSubscriptionPlanId, string>;
  for (const planId of ['starter', 'growth', 'pro'] as const) {
    const created = await client.subscriptionProductGroups.create({
      storeId: input.storeId,
      name: `${titleCase(planId)} subscriptions`,
      productIds: productIdsByPlan[planId],
      rules: { sharedTrial: false },
    });
    await client.subscriptionProductGroups.publish({ id: created.group.id });
    productGroupIds[planId] = created.group.id;
  }

  const webhook = await client.webhooks.add({
    storeId: input.storeId,
    channel: 'http',
    url: input.webhookUrl,
    events: WAFFO_SUBSCRIPTION_WEBHOOK_EVENTS,
    testMode: true,
  });

  return {
    productIds,
    productGroupIds,
    // Apply this exact payload to Core's plan.payment-mapping before Waffo
    // checkout is enabled. Product IDs are allocated remotely, so a source
    // file cannot safely hard-code them ahead of provisioning.
    paymentMapping: {
      mappings: WAFFO_SUBSCRIPTION_PRODUCTS.map((product) => ({
        paymentProductId: productIds[product.productIdKey],
        interval: product.interval,
        tier: product.planId,
      })),
    },
    testWebhookId: webhook.webhook.id,
  };
}

function centsToYuan(amount: number): string {
  const yuan = Math.floor(amount / 100);
  return `${yuan}.${String(amount % 100).padStart(2, '0')}`;
}

function intervalLabel(interval: string): string {
  if (interval === 'single_month') return 'Single Month';
  if (interval === 'monthly') return 'Monthly';
  return 'Yearly';
}

function titleCase(value: string): string {
  return `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
