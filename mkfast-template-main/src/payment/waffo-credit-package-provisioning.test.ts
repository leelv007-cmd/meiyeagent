import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWaffoCreditPackageProvisioningPlan,
  provisionWaffoCreditPackageCatalog,
  type WaffoCreditPackageProvisioningClient,
  type WaffoCreditPackageProvisioningPlan,
} from './waffo-credit-package-provisioning';

const STORE_ID = 'STO_test';

test('builds the three fixed HKD Test credit-package SKUs', () => {
  const plan = buildWaffoCreditPackageProvisioningPlan(STORE_ID);

  assert.deepEqual(
    plan.products.map((product) => ({
      metadata: product.createInput.metadata,
      offerId: product.offerId,
      prices: product.createInput.prices,
    })),
    [
      {
        metadata: {
          commerceScene: 'credit_package',
          commerceSku: 'credits-100',
          credits: 100,
          expireDays: 7,
        },
        offerId: 'credits-100',
        prices: { HKD: { amount: '57.00', taxCategory: 'saas' } },
      },
      {
        metadata: {
          commerceScene: 'credit_package',
          commerceSku: 'credits-300',
          credits: 300,
          expireDays: 7,
        },
        offerId: 'credits-300',
        prices: { HKD: { amount: '161.00', taxCategory: 'saas' } },
      },
      {
        metadata: {
          commerceScene: 'credit_package',
          commerceSku: 'credits-1000',
          credits: 1_000,
          expireDays: 7,
        },
        offerId: 'credits-1000',
        prices: { HKD: { amount: '498.00', taxCategory: 'saas' } },
      },
    ]
  );
});

test('defaults to a Test dry-run without reading or writing the Waffo API', async () => {
  const result = await provisionWaffoCreditPackageCatalog(undefined, {
    storeId: STORE_ID,
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.plan.products.length, 3);
});

test('rejects a non-Test runtime environment before any SDK access', async () => {
  const calls = { graphql: 0, products: 0 };

  await assert.rejects(
    provisionWaffoCreditPackageCatalog(fakeClient(calls), {
      environment: 'production' as never,
      storeId: STORE_ID,
    }),
    /environment must be explicitly test/i
  );

  assert.deepEqual(calls, { graphql: 0, products: 0 });
});

test('requires explicit Test authority before apply can use an SDK client', async () => {
  const calls = { graphql: 0, products: 0 };

  await assert.rejects(
    provisionWaffoCreditPackageCatalog(fakeClient(calls), {
      storeId: STORE_ID,
      mode: 'apply',
    }),
    /explicit test environment/i
  );

  assert.deepEqual(calls, { graphql: 0, products: 0 });
});

test('reconciles the three Test one-time SKUs without subscriptions or webhooks', async () => {
  const calls = { graphql: 0, products: 0, queries: [] as string[] };
  const catalog = emptyCatalog();
  const client = fakeClient(calls, catalog);
  const input = {
    environment: 'test' as const,
    mode: 'apply' as const,
    storeId: STORE_ID,
  };

  const first = await provisionWaffoCreditPackageCatalog(client, input);

  assert.equal(first.mode, 'applied');
  assert.deepEqual(first.created, { products: 3 });
  assert.deepEqual(first.productIds, {
    'credits-100': 'PROD_1',
    'credits-300': 'PROD_2',
    'credits-1000': 'PROD_3',
  });
  assert.equal(calls.graphql, 1);
  assert.equal(calls.products, 3);
  assert.match(calls.queries[0] ?? '', /onetimeProducts/);
  assert.doesNotMatch(calls.queries[0] ?? '', /subscription|webhook/i);

  const second = await provisionWaffoCreditPackageCatalog(client, input);

  assert.deepEqual(second.created, { products: 0 });
  assert.equal(calls.graphql, 2);
  assert.equal(calls.products, 3);
});

test('reuses exact products when GraphQL returns their metadata as JSON', async () => {
  const calls = { graphql: 0, products: 0 };
  const plan = buildWaffoCreditPackageProvisioningPlan(STORE_ID);
  const catalog = {
    onetimeProducts: plan.products.map((product, index) => {
      const existing = productFromInput(
        product.createInput,
        `PROD_${index + 1}`
      );
      existing.metadata = JSON.stringify(existing.metadata);
      return existing;
    }),
  };

  const result = await provisionWaffoCreditPackageCatalog(
    fakeClient(calls, catalog),
    { environment: 'test', mode: 'apply', storeId: STORE_ID }
  );

  assert.deepEqual(result.created, { products: 0 });
  assert.deepEqual(result.productIds, {
    'credits-100': 'PROD_1',
    'credits-300': 'PROD_2',
    'credits-1000': 'PROD_3',
  });
  assert.deepEqual(calls, { graphql: 1, products: 0 });
});

test('fails closed on an ambiguous canonical package before it can create', async () => {
  const calls = { graphql: 0, products: 0 };
  const plan = buildWaffoCreditPackageProvisioningPlan(STORE_ID);
  const product = productFromInput(plan.products[0].createInput, 'PROD_1');
  const catalog = { onetimeProducts: [product, { ...product, id: 'PROD_2' }] };

  await assert.rejects(
    provisionWaffoCreditPackageCatalog(fakeClient(calls, catalog), {
      environment: 'test',
      mode: 'apply',
      storeId: STORE_ID,
    }),
    /ambiguous canonical product credits-100/i
  );

  assert.deepEqual(calls, { graphql: 1, products: 0 });
});

test('fails closed when the Waffo catalog does not return an onetime product array', async () => {
  const calls = { graphql: 0, products: 0 };
  const client: WaffoCreditPackageProvisioningClient = {
    graphql: {
      query: async () => {
        calls.graphql += 1;
        return { data: { onetimeProducts: null } as never };
      },
    },
    onetimeProducts: {
      create: async () => {
        calls.products += 1;
        return { product: { id: 'PROD_unexpected' } };
      },
    },
  };

  await assert.rejects(
    provisionWaffoCreditPackageCatalog(client, {
      environment: 'test',
      mode: 'apply',
      storeId: STORE_ID,
    }),
    /catalog response is malformed/i
  );

  assert.deepEqual(calls, { graphql: 1, products: 0 });
});

test('fails closed on price drift or a published package before it can create', async () => {
  for (const mutate of [
    (product: ProvisioningCatalog['onetimeProducts'][number]) => {
      product.prices[0]!.priceInfo.amount = '49.01';
    },
    (product: ProvisioningCatalog['onetimeProducts'][number]) => {
      product.hasProdVersion = true;
    },
  ]) {
    const calls = { graphql: 0, products: 0 };
    const plan = buildWaffoCreditPackageProvisioningPlan(STORE_ID);
    const product = productFromInput(plan.products[0].createInput, 'PROD_1');
    mutate(product);

    await assert.rejects(
      provisionWaffoCreditPackageCatalog(
        fakeClient(calls, { onetimeProducts: [product] }),
        { environment: 'test', mode: 'apply', storeId: STORE_ID }
      ),
      /catalog drift for product credits-100/i
    );

    assert.deepEqual(calls, { graphql: 1, products: 0 });
  }
});

test('keeps unrelated legacy one-time products outside the canonical catalog', async () => {
  const calls = { graphql: 0, products: 0 };
  const plan = buildWaffoCreditPackageProvisioningPlan(STORE_ID);
  const legacy = productFromInput(plan.products[0].createInput, 'PROD_legacy');
  legacy.metadata = { commerceScene: 'legacy' };
  legacy.name = 'Legacy CNY Product';

  const result = await provisionWaffoCreditPackageCatalog(
    fakeClient(calls, { onetimeProducts: [legacy] }),
    { environment: 'test', mode: 'apply', storeId: STORE_ID }
  );

  assert.deepEqual(result.created, { products: 3 });
  assert.deepEqual(calls, { graphql: 1, products: 3 });
});

test('recovers a partial Test apply by creating only the missing packages', async () => {
  const calls = { graphql: 0, products: 0 };
  const catalog = emptyCatalog();
  let interrupted = true;
  const client = fakeClient(calls, catalog, {
    beforeCreate: async (_input, count) => {
      if (interrupted && count === 2) {
        interrupted = false;
        throw new Error('simulated package interruption');
      }
    },
  });
  const input = {
    environment: 'test' as const,
    mode: 'apply' as const,
    storeId: STORE_ID,
  };

  await assert.rejects(
    provisionWaffoCreditPackageCatalog(client, input),
    /simulated package interruption/
  );
  const recovered = await provisionWaffoCreditPackageCatalog(client, input);

  assert.deepEqual(recovered.created, { products: 2 });
  assert.equal(calls.graphql, 2);
  assert.equal(calls.products, 4);
});

function fakeClient(
  calls: { graphql: number; products: number; queries?: string[] },
  catalog: ProvisioningCatalog = emptyCatalog(),
  hooks: {
    beforeCreate?: (
      input: WaffoCreditPackageProvisioningPlan['products'][number]['createInput'],
      count: number
    ) => Promise<void>;
  } = {}
): WaffoCreditPackageProvisioningClient {
  return {
    graphql: {
      query: async <T>(input: {
        query: string;
        variables?: Record<string, unknown>;
      }) => {
        calls.graphql += 1;
        calls.queries?.push(input.query);
        return { data: structuredClone(catalog) as T };
      },
    },
    onetimeProducts: {
      create: async (input) => {
        calls.products += 1;
        await hooks.beforeCreate?.(input, calls.products);
        const id = `PROD_${calls.products}`;
        catalog.onetimeProducts.push(productFromInput(input, id));
        return { product: { id } };
      },
    },
  };
}

function emptyCatalog(): ProvisioningCatalog {
  return { onetimeProducts: [] };
}

function productFromInput(
  input: WaffoCreditPackageProvisioningPlan['products'][number]['createInput'],
  id: string
): ProvisioningCatalog['onetimeProducts'][number] {
  return {
    hasProdVersion: false,
    id,
    metadata: input.metadata ?? {},
    name: input.name,
    prices: Object.entries(input.prices).map(([currency, priceInfo]) => ({
      currency,
      priceInfo: {
        amount: priceInfo.amount,
        taxCategory: priceInfo.taxCategory,
      },
    })),
    status: 'active',
  };
}

type ProvisioningCatalog = {
  onetimeProducts: Array<{
    hasProdVersion: boolean;
    id: string;
    metadata: Record<string, unknown> | string | null;
    name: string;
    prices: Array<{
      currency: string;
      priceInfo: { amount: string; taxCategory: string };
    }>;
    status: string;
  }>;
};
