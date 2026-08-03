import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWaffoSubscriptionProvisioningPlan,
  provisionWaffoSubscriptionCatalog,
  type WaffoSubscriptionProvisioningClient,
  type WaffoSubscriptionProvisioningPlan,
} from '@/payment/waffo-provisioning';

const STORE_ID = 'STO_test';
const WEBHOOK_URL = 'https://preview.example.test/api/webhooks/waffo';

test('dry-run returns the Test catalog plan without reading or writing the API', async () => {
  const calls = { graphql: 0, products: 0, groups: 0, webhooks: 0 };
  const client = fakeClient(emptyCatalog(), calls);

  const result = await provisionWaffoSubscriptionCatalog(client, {
    storeId: STORE_ID,
    environment: 'test',
    mode: 'dry-run',
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.plan.products.length, 9);
  assert.equal(result.plan.groups.length, 3);
  assert.equal(result.plan.webhook.testMode, true);
  assert.equal(result.plan.webhook.url, undefined);
  assert.deepEqual(result.plan.webhook.events, [
    'subscription.activated',
    'subscription.payment_succeeded',
    'subscription.canceling',
    'subscription.uncanceled',
    'subscription.canceled',
    'order.completed',
    'refund.succeeded',
    'refund.failed',
  ]);
  assert.deepEqual(calls, { graphql: 0, products: 0, groups: 0, webhooks: 0 });
});

test('defaults to a Test dry-run when no environment or mode is supplied', async () => {
  const calls = { graphql: 0, products: 0, groups: 0, webhooks: 0 };
  const result = await provisionWaffoSubscriptionCatalog(
    fakeClient(emptyCatalog(), calls),
    { storeId: STORE_ID }
  );

  assert.equal(result.mode, 'dry-run');
  assert.deepEqual(calls, { graphql: 0, products: 0, groups: 0, webhooks: 0 });
});

test('requires explicit Test authority for apply', async () => {
  await assert.rejects(
    provisionWaffoSubscriptionCatalog(undefined, {
      storeId: STORE_ID,
      webhookUrl: WEBHOOK_URL,
      mode: 'apply',
    }),
    /explicit test environment/i
  );
});

test('apply creates missing Test products, groups, and webhook after one read', async () => {
  const calls = { graphql: 0, products: 0, groups: 0, webhooks: 0 };
  const catalog = emptyCatalog();
  const client = fakeClient(catalog, calls);

  const result = await provisionWaffoSubscriptionCatalog(client, {
    storeId: STORE_ID,
    webhookUrl: WEBHOOK_URL,
    environment: 'test',
    mode: 'apply',
  });

  assert.equal(result.mode, 'applied');
  assert.deepEqual(result.created, { products: 9, groups: 3, webhook: 1 });
  assert.equal(calls.graphql, 1);
  assert.equal(calls.products, 9);
  assert.equal(calls.groups, 3);
  assert.equal(calls.webhooks, 1);
  assert.equal(result.testWebhookId, 'WEBHOOK_1');
  assert.deepEqual(Object.keys(result.productIds), [
    'starterSingleMonth',
    'starterMonthly',
    'starterYearly',
    'growthSingleMonth',
    'growthMonthly',
    'growthYearly',
    'proSingleMonth',
    'proMonthly',
    'proYearly',
  ]);
});

test('apply reuses an exact catalog and creates nothing on the second run', async () => {
  const calls = { graphql: 0, products: 0, groups: 0, webhooks: 0 };
  const catalog = emptyCatalog();
  const client = fakeClient(catalog, calls);
  const input = {
    storeId: STORE_ID,
    webhookUrl: WEBHOOK_URL,
    environment: 'test' as const,
    mode: 'apply' as const,
  };

  const first = await provisionWaffoSubscriptionCatalog(client, input);
  const firstCalls = { ...calls };
  const second = await provisionWaffoSubscriptionCatalog(client, input);

  assert.deepEqual(first.created, { products: 9, groups: 3, webhook: 1 });
  assert.deepEqual(second.created, { products: 0, groups: 0, webhook: 0 });
  assert.deepEqual(second.productIds, first.productIds);
  assert.deepEqual(second.productGroupIds, first.productGroupIds);
  assert.equal(second.testWebhookId, first.testWebhookId);
  assert.deepEqual(calls, {
    graphql: firstCalls.graphql + 1,
    products: firstCalls.products,
    groups: firstCalls.groups,
    webhooks: firstCalls.webhooks,
  });
});

test('reuses GraphQL products when metadata is returned as a JSON string', async () => {
  const calls = { graphql: 0, products: 0, groups: 0, webhooks: 0 };
  const catalog = emptyCatalog();
  const client = fakeClient(catalog, calls);
  const input = {
    storeId: STORE_ID,
    webhookUrl: WEBHOOK_URL,
    environment: 'test' as const,
    mode: 'apply' as const,
  };
  await provisionWaffoSubscriptionCatalog(client, input);
  for (const product of catalog.subscriptionProducts) {
    product.metadata = JSON.stringify(product.metadata);
  }
  for (const webhook of catalog.store.storeWebhooks) {
    webhook.events.reverse();
  }
  const second = await provisionWaffoSubscriptionCatalog(client, input);

  assert.deepEqual(second.created, { products: 0, groups: 0, webhook: 0 });
  assert.equal(calls.products, 9);
  assert.equal(calls.groups, 3);
  assert.equal(calls.webhooks, 1);
});

test('rejects duplicate canonical products before any create', async () => {
  const plan = buildWaffoSubscriptionProvisioningPlan(STORE_ID);
  const duplicate = productFromPlan(plan.products[0], 'PROD_duplicate');
  const catalog = emptyCatalog();
  catalog.subscriptionProducts.push(duplicate, {
    ...duplicate,
    id: 'PROD_duplicate_2',
  });
  const calls = { graphql: 0, products: 0, groups: 0, webhooks: 0 };

  await assert.rejects(
    provisionWaffoSubscriptionCatalog(fakeClient(catalog, calls), {
      storeId: STORE_ID,
      webhookUrl: WEBHOOK_URL,
      environment: 'test',
      mode: 'apply',
    }),
    /ambiguous.*product/i
  );
  assert.deepEqual(calls, { graphql: 1, products: 0, groups: 0, webhooks: 0 });
});

test('rejects canonical product price drift instead of updating it', async () => {
  const plan = buildWaffoSubscriptionProvisioningPlan(STORE_ID);
  const drifted = productFromPlan(plan.products[0], 'PROD_drifted');
  drifted.prices[0].priceInfo.amount = '999.00';
  const catalog = emptyCatalog();
  catalog.subscriptionProducts.push(drifted);
  const calls = { graphql: 0, products: 0, groups: 0, webhooks: 0 };

  await assert.rejects(
    provisionWaffoSubscriptionCatalog(fakeClient(catalog, calls), {
      storeId: STORE_ID,
      webhookUrl: WEBHOOK_URL,
      environment: 'test',
      mode: 'apply',
    }),
    /drift.*product/i
  );
  assert.deepEqual(calls, { graphql: 1, products: 0, groups: 0, webhooks: 0 });
});

test('rejects a webhook with canonical events on a different URL', async () => {
  const plan = buildWaffoSubscriptionProvisioningPlan(STORE_ID);
  const catalog = emptyCatalog();
  catalog.store.storeWebhooks.push({
    id: 'WEBHOOK_drifted',
    channel: 'http',
    url: 'https://old.example.test/api/webhooks/waffo',
    events: [...plan.webhook.events],
    testMode: true,
  });
  const calls = { graphql: 0, products: 0, groups: 0, webhooks: 0 };

  await assert.rejects(
    provisionWaffoSubscriptionCatalog(fakeClient(catalog, calls), {
      storeId: STORE_ID,
      webhookUrl: WEBHOOK_URL,
      environment: 'test',
      mode: 'apply',
    }),
    /webhook.*drift/i
  );
  assert.deepEqual(calls, { graphql: 1, products: 0, groups: 0, webhooks: 0 });
});

test('recovers a partial apply without recreating products or completed groups', async () => {
  const calls = { graphql: 0, products: 0, groups: 0, webhooks: 0 };
  const catalog = emptyCatalog();
  let failGroupAt = 2;
  const client = fakeClient(catalog, calls, {
    createGroup: async (input, id) => {
      if (failGroupAt > 0 && id === failGroupAt) {
        failGroupAt = 0;
        throw new Error('simulated group interruption');
      }
      return input;
    },
  });
  const input = {
    storeId: STORE_ID,
    webhookUrl: WEBHOOK_URL,
    environment: 'test' as const,
    mode: 'apply' as const,
  };

  await assert.rejects(
    provisionWaffoSubscriptionCatalog(client, input),
    /interruption/
  );
  const recovered = await provisionWaffoSubscriptionCatalog(client, input);

  assert.deepEqual(recovered.created, { products: 0, groups: 2, webhook: 1 });
  assert.equal(calls.products, 9);
  assert.equal(calls.groups, 4);
  assert.equal(calls.webhooks, 1);
});

function emptyCatalog(): ProvisioningCatalog {
  return {
    store: { id: STORE_ID, storeWebhooks: [] },
    subscriptionProducts: [],
    subscriptionProductGroups: [],
  };
}

function fakeClient(
  catalog: ProvisioningCatalog,
  calls: CallCounts,
  hooks: {
    createGroup?: (input: unknown, id: number) => Promise<unknown>;
  } = {}
): WaffoSubscriptionProvisioningClient {
  return {
    graphql: {
      query: async <T>() => {
        calls.graphql += 1;
        return { data: structuredClone(catalog) as T };
      },
    },
    subscriptionProducts: {
      create: async (input) => {
        calls.products += 1;
        const id = `PROD_${calls.products}`;
        catalog.subscriptionProducts.push({
          ...productFromInput(input, id),
          status: 'active',
        });
        return { product: { id } };
      },
    },
    subscriptionProductGroups: {
      create: async (input) => {
        calls.groups += 1;
        const id = `GROUP_${calls.groups}`;
        if (hooks.createGroup) await hooks.createGroup(input, calls.groups);
        catalog.subscriptionProductGroups.push({
          id,
          name: input.name,
          rules: input.rules ?? { sharedTrial: false },
          environment: 'test',
          productIds: input.productIds ?? [],
          products:
            input.productIds?.map((productId) => ({
              id: productId,
              name: '',
              billingPeriod: 'monthly',
              prices: [],
            })) ?? [],
        });
        return { group: { id } };
      },
    },
    webhooks: {
      add: async (input) => {
        calls.webhooks += 1;
        const id = `WEBHOOK_${calls.webhooks}`;
        catalog.store.storeWebhooks.push({
          id,
          channel: input.channel,
          url: input.url,
          events: [...input.events],
          testMode: input.testMode,
        });
        return { webhook: { id } };
      },
    },
  };
}

function productFromInput(
  input: Parameters<
    NonNullable<
      WaffoSubscriptionProvisioningClient['subscriptionProducts']['create']
    >
  >[0],
  id: string
): GraphQLProduct {
  return {
    id,
    name: input.name,
    billingPeriod: input.billingPeriod,
    prices: Object.entries(input.prices).map(([currency, priceInfo]) => ({
      currency,
      priceInfo: {
        amount: priceInfo.amount,
        taxCategory: priceInfo.taxCategory,
      },
    })),
    status: 'active',
    metadata: input.metadata ?? {},
  };
}

function productFromPlan(
  product: WaffoSubscriptionProvisioningPlan['products'][number],
  id: string
): GraphQLProduct {
  return productFromInput(product.createInput, id);
}

type CallCounts = {
  graphql: number;
  products: number;
  groups: number;
  webhooks: number;
};

type GraphQLProduct = {
  id: string;
  name: string;
  billingPeriod: string;
  prices: Array<{
    currency: string;
    priceInfo: { amount: string; taxCategory: string };
  }>;
  status: string;
  metadata: Record<string, unknown> | string;
};

type ProvisioningCatalog = {
  store: {
    id: string;
    storeWebhooks: Array<{
      id: string;
      channel: string;
      url: string;
      events: string[];
      testMode: boolean;
    }>;
  };
  subscriptionProducts: GraphQLProduct[];
  subscriptionProductGroups: Array<{
    id: string;
    name: string;
    rules: { sharedTrial: boolean };
    environment: string;
    productIds: string[];
    products: Array<{
      id: string;
      name: string;
      billingPeriod: string;
      prices: Array<{
        currency: string;
        priceInfo: { amount: string; taxCategory: string };
      }>;
    }>;
  }>;
};
