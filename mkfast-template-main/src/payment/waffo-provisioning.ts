import {
  BillingPeriod,
  TaxCategory,
  WebhookEventType,
  type AddWebhookParams,
  type CreateSubscriptionProductGroupParams,
  type CreateSubscriptionProductParams,
  type GraphQLResponse,
} from '@waffo/pancake-ts';
import type { PublicPlanCatalog } from '@meiye/contracts';
import {
  WAFFO_SUBSCRIPTION_PRODUCTS,
  type WaffoProductIdKey,
  type WaffoSubscriptionPlanId,
} from './waffo-subscription-catalog';

export type WaffoProvisioningMode = 'dry-run' | 'apply';

export interface WaffoSubscriptionProvisioningInput {
  catalog: PublicPlanCatalog;
  storeId: string;
  webhookUrl?: string;
  environment?: 'test';
  mode?: WaffoProvisioningMode;
}

export type WaffoSubscriptionProductPlan = {
  productIdKey: WaffoProductIdKey;
  planId: WaffoSubscriptionPlanId;
  interval: (typeof WAFFO_SUBSCRIPTION_PRODUCTS)[number]['interval'];
  createInput: CreateSubscriptionProductParams;
};

export type WaffoSubscriptionGroupPlan = {
  planId: WaffoSubscriptionPlanId;
  createInput: Omit<CreateSubscriptionProductGroupParams, 'productIds'>;
};

export type WaffoSubscriptionProvisioningPlan = {
  storeId: string;
  environment: 'test';
  products: WaffoSubscriptionProductPlan[];
  groups: WaffoSubscriptionGroupPlan[];
  webhook: {
    storeId: string;
    channel: 'http';
    url?: string;
    events: typeof WAFFO_SUBSCRIPTION_WEBHOOK_EVENTS;
    testMode: true;
  };
};

export interface WaffoSubscriptionProvisioningClient {
  graphql: {
    query<T>(input: {
      query: string;
      variables?: Record<string, unknown>;
    }): Promise<GraphQLResponse<T>>;
  };
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
  webhooks: {
    add(input: AddWebhookParams): Promise<{ webhook: { id: string } }>;
  };
}

export const WAFFO_SUBSCRIPTION_WEBHOOK_EVENTS = [
  WebhookEventType.SubscriptionActivated,
  WebhookEventType.SubscriptionPaymentSucceeded,
  WebhookEventType.SubscriptionCanceling,
  WebhookEventType.SubscriptionUncanceled,
  WebhookEventType.SubscriptionCanceled,
  WebhookEventType.OrderCompleted,
  WebhookEventType.RefundSucceeded,
  WebhookEventType.RefundFailed,
] as const;

type GraphQLPrice = {
  currency: string;
  priceInfo: { amount: string; taxCategory: string };
};

type GraphQLProduct = {
  id: string;
  name: string;
  billingPeriod: string;
  prices: GraphQLPrice[];
  status: string;
  metadata: Record<string, unknown> | string | null;
  storeId?: string | null;
};

type GraphQLGroup = {
  id: string;
  name: string;
  rules: { sharedTrial: boolean };
  environment: string;
  productIds: string[];
  storeId?: string | null;
};

type GraphQLWebhook = {
  id: string;
  channel: string;
  url: string;
  events: string[];
  testMode: boolean;
  storeId?: string | null;
};

type ExistingCatalog = {
  store: { id: string; storeWebhooks: GraphQLWebhook[] } | null;
  subscriptionProducts: GraphQLProduct[];
  subscriptionProductGroups: GraphQLGroup[];
};

export class WaffoProvisioningError extends Error {
  constructor(message: string) {
    super(`Waffo Test provisioning blocked: ${message}`);
    this.name = 'WaffoProvisioningError';
  }
}

export function buildWaffoSubscriptionProvisioningPlan(
  storeId: string,
  catalog: PublicPlanCatalog,
  webhookUrl?: string
): WaffoSubscriptionProvisioningPlan {
  const normalizedStoreId = requiredValue('storeId', storeId);
  if (webhookUrl !== undefined) validateHttpsUrl(webhookUrl);

  const products = WAFFO_SUBSCRIPTION_PRODUCTS.map((product) => ({
    productIdKey: product.productIdKey,
    planId: product.planId,
    interval: product.interval,
    createInput: {
      storeId: normalizedStoreId,
      name: `${titleCase(product.planId)} HKD ${intervalLabel(product.interval)}`,
      billingPeriod:
        product.billingPeriod === 'yearly'
          ? BillingPeriod.Yearly
          : BillingPeriod.Monthly,
      prices: {
        HKD: {
          amount: governedDisplayAmount(
            catalog,
            product.planId,
            product.interval
          ),
          taxCategory: TaxCategory.SaaS,
        },
      },
      metadata: {
        commercePeriod: product.interval,
        commerceTier: product.planId,
      },
    },
  }));

  const groups = (['starter', 'growth', 'pro'] as const).map((planId) => ({
    planId,
    createInput: {
      storeId: normalizedStoreId,
      name: `${titleCase(planId)} HKD subscriptions`,
      rules: { sharedTrial: false },
    },
  }));

  return {
    storeId: normalizedStoreId,
    environment: 'test',
    products,
    groups,
    webhook: {
      storeId: normalizedStoreId,
      channel: 'http',
      ...(webhookUrl === undefined ? {} : { url: webhookUrl }),
      events: WAFFO_SUBSCRIPTION_WEBHOOK_EVENTS,
      testMode: true,
    },
  };
}

export async function provisionWaffoSubscriptionCatalog(
  client: WaffoSubscriptionProvisioningClient | undefined,
  input: WaffoSubscriptionProvisioningInput
) {
  if (input.environment !== undefined && input.environment !== 'test') {
    throw new WaffoProvisioningError('environment must be explicitly test.');
  }

  const mode = input.mode ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new WaffoProvisioningError('mode must be dry-run or apply.');
  }
  if (mode === 'apply' && input.environment !== 'test') {
    throw new WaffoProvisioningError(
      'apply requires an explicit test environment.'
    );
  }

  const plan = buildWaffoSubscriptionProvisioningPlan(
    input.storeId,
    input.catalog,
    input.webhookUrl
  );
  if (mode === 'dry-run') return { mode, plan } as const;

  if (!client) {
    throw new WaffoProvisioningError('an SDK client is required for apply.');
  }
  const webhookUrl = requiredValue('webhookUrl', input.webhookUrl);
  const existing = await readExistingCatalog(client, plan.storeId);
  const existingWebhook = findWebhook(
    existing.store?.storeWebhooks ?? [],
    plan.storeId,
    webhookUrl
  );
  const existingProducts = plan.products.map((product) => ({
    plan: product,
    existing: findProduct(existing.subscriptionProducts, product),
  }));
  const existingProductIdsByPlan: Record<WaffoSubscriptionPlanId, string[]> = {
    starter: [],
    growth: [],
    pro: [],
  };
  for (const entry of existingProducts) {
    if (entry.existing) {
      existingProductIdsByPlan[entry.plan.planId].push(entry.existing.id);
    }
  }
  const existingGroups = plan.groups.map((group) => ({
    plan: group,
    existing: findGroup(
      existing.subscriptionProductGroups,
      group,
      existingProductIdsByPlan[group.planId]
    ),
  }));
  const productIds = {} as Record<WaffoProductIdKey, string>;
  const productIdsByPlan: Record<WaffoSubscriptionPlanId, string[]> = {
    starter: [],
    growth: [],
    pro: [],
  };
  let createdProducts = 0;

  for (const entry of existingProducts) {
    const { plan: product, existing: existingProduct } = entry;
    const productId =
      existingProduct?.id ??
      (await client.subscriptionProducts.create(product.createInput)).product
        .id;
    requireCreatedId('product', productId);
    if (!existingProduct) createdProducts += 1;
    productIds[product.productIdKey] = productId;
    productIdsByPlan[product.planId].push(productId);
  }

  const productGroupIds = {} as Record<WaffoSubscriptionPlanId, string>;
  let createdGroups = 0;
  for (const entry of existingGroups) {
    const { plan: group, existing: existingGroup } = entry;
    const expectedProductIds = productIdsByPlan[group.planId];
    const groupId =
      existingGroup?.id ??
      (
        await client.subscriptionProductGroups.create({
          ...group.createInput,
          productIds: expectedProductIds,
        })
      ).group.id;
    requireCreatedId('product group', groupId);
    if (!existingGroup) createdGroups += 1;
    productGroupIds[group.planId] = groupId;
  }

  const testWebhookId =
    existingWebhook?.id ??
    (
      await client.webhooks.add({
        storeId: plan.storeId,
        channel: 'http',
        url: webhookUrl,
        events: [...WAFFO_SUBSCRIPTION_WEBHOOK_EVENTS],
        testMode: true,
      })
    ).webhook.id;
  requireCreatedId('webhook', testWebhookId);

  return {
    mode: 'applied' as const,
    created: {
      products: createdProducts,
      groups: createdGroups,
      webhook: existingWebhook ? 0 : 1,
    },
    productIds,
    productGroupIds,
    paymentMapping: {
      mappings: WAFFO_SUBSCRIPTION_PRODUCTS.map((product) => ({
        paymentProductId: productIds[product.productIdKey],
        interval: product.interval,
        tier: product.planId,
      })),
    },
    testWebhookId,
  };
}

function governedDisplayAmount(
  catalog: PublicPlanCatalog,
  planId: WaffoSubscriptionPlanId,
  interval: (typeof WAFFO_SUBSCRIPTION_PRODUCTS)[number]['interval']
) {
  const plan = catalog.plans.find((candidate) => candidate.id === planId);
  const price = plan?.cyclePrices.find(
    (candidate) => candidate.cycle === interval
  );
  if (!plan || !price || plan.currency !== 'HKD' || price.amountMicros <= 0) {
    throw new WaffoProvisioningError(
      `published Core price is missing for ${planId}:${interval}.`
    );
  }
  return (price.amountMicros / 1_000_000).toFixed(2);
}

async function readExistingCatalog(
  client: WaffoSubscriptionProvisioningClient,
  storeId: string
): Promise<ExistingCatalog> {
  const response = await client.graphql.query<ExistingCatalog>({
    query: `query WaffoSubscriptionProvisioningCatalog($storeId: String!) {
      store(id: $storeId) {
        id
        storeWebhooks {
          id
          storeId
          channel
          url
          events
          testMode
        }
      }
      subscriptionProducts(storeId: $storeId) {
        id
        storeId
        name
        billingPeriod
        prices { currency priceInfo { amount taxCategory } }
        status
        metadata
      }
      subscriptionProductGroups(storeId: $storeId) {
        id
        storeId
        name
        rules { sharedTrial }
        environment
        productIds
      }
    }`,
    variables: { storeId },
  });

  if (response.errors?.length || !response.data) {
    throw new WaffoProvisioningError('catalog read failed.');
  }
  if (!response.data.store || response.data.store.id !== storeId) {
    throw new WaffoProvisioningError(
      'catalog store does not match target Test store.'
    );
  }
  return response.data;
}

function findProduct(
  products: GraphQLProduct[],
  expected: WaffoSubscriptionProductPlan
): GraphQLProduct | undefined {
  const exact = products.filter(
    (product) =>
      product.name === expected.createInput.name &&
      metadataEqual(product.metadata, expected.createInput.metadata)
  );
  if (exact.length > 1) {
    throw new WaffoProvisioningError(
      `ambiguous canonical product ${expected.productIdKey}.`
    );
  }
  if (exact.length === 1) {
    assertProductMatches(exact[0], expected);
    return exact[0];
  }

  const drift = products.filter(
    (product) =>
      product.name === expected.createInput.name ||
      (product.name.includes('HKD') &&
        normalizeMetadata(product.metadata)?.commercePeriod ===
          expected.createInput.metadata?.commercePeriod &&
        normalizeMetadata(product.metadata)?.commerceTier ===
          expected.createInput.metadata?.commerceTier)
  );
  if (drift.length > 0) {
    throw new WaffoProvisioningError(
      `catalog drift for product ${expected.productIdKey}.`
    );
  }
  return undefined;
}

function assertProductMatches(
  product: GraphQLProduct,
  expected: WaffoSubscriptionProductPlan
): void {
  if (
    product.storeId !== undefined &&
    product.storeId !== expected.createInput.storeId
  ) {
    throw new WaffoProvisioningError(
      `store drift for product ${expected.productIdKey}.`
    );
  }
  if (product.billingPeriod !== expected.createInput.billingPeriod) {
    throw new WaffoProvisioningError(
      `billing period drift for product ${expected.productIdKey}.`
    );
  }
  if (product.status !== 'active') {
    throw new WaffoProvisioningError(
      `inactive product ${expected.productIdKey} cannot be reused.`
    );
  }
  const expectedPrice = expected.createInput.prices.HKD;
  if (
    product.prices.length !== 1 ||
    product.prices[0]?.currency !== 'HKD' ||
    product.prices[0].priceInfo.amount !== expectedPrice.amount ||
    product.prices[0].priceInfo.taxCategory !== expectedPrice.taxCategory
  ) {
    throw new WaffoProvisioningError(
      `price drift for product ${expected.productIdKey}.`
    );
  }
}

function findGroup(
  groups: GraphQLGroup[],
  expected: WaffoSubscriptionGroupPlan,
  productIds: string[]
): GraphQLGroup | undefined {
  const exactName = groups.filter(
    (group) => group.name === expected.createInput.name
  );
  if (exactName.length > 1) {
    throw new WaffoProvisioningError(
      `ambiguous canonical ${expected.planId} product group.`
    );
  }
  const group = exactName[0];
  if (!group) return undefined;
  if (
    (group.storeId !== undefined &&
      group.storeId !== expected.createInput.storeId) ||
    group.environment !== 'test' ||
    group.rules.sharedTrial !== expected.createInput.rules?.sharedTrial ||
    !sameStringArray(group.productIds, productIds)
  ) {
    throw new WaffoProvisioningError(
      `catalog drift for ${expected.planId} product group.`
    );
  }
  return group;
}

function findWebhook(
  webhooks: GraphQLWebhook[],
  storeId: string,
  webhookUrl: string
): GraphQLWebhook | undefined {
  const sameUrl = webhooks.filter((webhook) => webhook.url === webhookUrl);
  if (sameUrl.length > 1) {
    throw new WaffoProvisioningError('ambiguous canonical webhook.');
  }
  const candidate = sameUrl[0];
  if (candidate) {
    assertWebhookMatches(candidate, storeId, webhookUrl);
    return candidate;
  }

  const drift = webhooks.some(
    (webhook) =>
      webhook.channel === 'http' &&
      sameStringSet(webhook.events, [...WAFFO_SUBSCRIPTION_WEBHOOK_EVENTS])
  );
  if (drift) throw new WaffoProvisioningError('webhook URL drift.');
  return undefined;
}

function assertWebhookMatches(
  webhook: GraphQLWebhook,
  storeId: string,
  webhookUrl: string
): void {
  if (
    (webhook.storeId !== undefined && webhook.storeId !== storeId) ||
    webhook.channel !== 'http' ||
    webhook.url !== webhookUrl ||
    webhook.testMode !== true ||
    !sameStringSet(webhook.events, [...WAFFO_SUBSCRIPTION_WEBHOOK_EVENTS])
  ) {
    throw new WaffoProvisioningError('webhook configuration drift.');
  }
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameStringSet(left: string[], right: string[]): boolean {
  return sameStringArray([...left].sort(), [...right].sort());
}

function metadataEqual(
  actual: Record<string, unknown> | string | null,
  expected: Record<string, unknown> | undefined
): boolean {
  actual = normalizeMetadata(actual);
  if (!actual || !expected) return actual === expected;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    sameStringArray(actualKeys, expectedKeys) &&
    actualKeys.every((key) => actual[key] === expected[key])
  );
}

function normalizeMetadata(
  value: Record<string, unknown> | string | null | undefined
): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function requiredValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new WaffoProvisioningError(`${name} is required.`);
  return normalized;
}

function validateHttpsUrl(value: string): void {
  try {
    if (new URL(value).protocol !== 'https:') throw new Error('not https');
  } catch {
    throw new WaffoProvisioningError('webhookUrl must be an HTTPS URL.');
  }
}

function requireCreatedId(
  kind: string,
  value: string | undefined
): asserts value is string {
  if (!value?.trim()) {
    throw new WaffoProvisioningError(`${kind} create returned no ID.`);
  }
}

function intervalLabel(interval: string): string {
  if (interval === 'single_month') return 'Single Month';
  if (interval === 'monthly') return 'Monthly';
  return 'Yearly';
}

function titleCase(value: string): string {
  return `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
