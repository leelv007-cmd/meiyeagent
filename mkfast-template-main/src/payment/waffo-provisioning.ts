import {
  BillingPeriod,
  TaxCategory,
  WebhookEventType,
  type CreateSubscriptionProductGroupParams,
  type CreateSubscriptionProductParams,
} from '@waffo/pancake-ts';
import {
  WAFFO_SUBSCRIPTION_PRODUCTS,
  type WaffoProductIdKey,
  type WaffoSubscriptionPlanId,
} from './waffo-subscription-catalog';

export interface WaffoSubscriptionProvisioningClient {
  subscriptionProducts: {
    create(
      input: CreateSubscriptionProductParams
    ): Promise<{ product: { id: string } }>;
  };
  subscriptionProductGroups: {
    create(
      input: CreateSubscriptionProductGroupParams
    ): Promise<{ group: { id: string } }>;
  };
}

export const WAFFO_SUBSCRIPTION_WEBHOOK_EVENTS = [
  WebhookEventType.SubscriptionActivated,
  WebhookEventType.SubscriptionPaymentSucceeded,
  WebhookEventType.SubscriptionCanceling,
  WebhookEventType.SubscriptionUncanceled,
  WebhookEventType.SubscriptionCanceled,
] as const;

export async function provisionWaffoSubscriptionCatalog(
  client: WaffoSubscriptionProvisioningClient,
  input: { storeId: string; testWebhookId: string }
) {
  const productIds = {} as Record<WaffoProductIdKey, string>;
  const productIdsByPlan: Record<WaffoSubscriptionPlanId, string[]> = {
    starter: [],
    growth: [],
    pro: [],
  };

  for (const product of WAFFO_SUBSCRIPTION_PRODUCTS) {
    const created = await client.subscriptionProducts.create({
      storeId: input.storeId,
      name: `${titleCase(product.planId)} ${intervalLabel(product.interval)}`,
      billingPeriod:
        product.billingPeriod === 'yearly'
          ? BillingPeriod.Yearly
          : BillingPeriod.Monthly,
      prices: {
        HKD: {
          amount: centsToDisplayAmount(product.amount),
          taxCategory: TaxCategory.SaaS,
        },
      },
      metadata: {
        commercePeriod: product.interval,
        commerceTier: product.planId,
      },
    });
    productIds[product.productIdKey] = created.product.id;
    productIdsByPlan[product.planId].push(created.product.id);
  }

  const productGroupIds = {} as Record<WaffoSubscriptionPlanId, string>;
  for (const planId of ['starter', 'growth', 'pro'] as const) {
    const created = await client.subscriptionProductGroups.create({
      storeId: input.storeId,
      name: `${titleCase(planId)} HKD subscriptions`,
      productIds: productIdsByPlan[planId],
      rules: { sharedTrial: false },
    });
    productGroupIds[planId] = created.group.id;
  }

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
    testWebhookId: input.testWebhookId,
  };
}

function centsToDisplayAmount(amount: number): string {
  const units = Math.floor(amount / 100);
  return `${units}.${String(amount % 100).padStart(2, '0')}`;
}

function intervalLabel(interval: string): string {
  if (interval === 'single_month') return 'Single Month';
  if (interval === 'monthly') return 'Monthly';
  return 'Yearly';
}

function titleCase(value: string): string {
  return `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
