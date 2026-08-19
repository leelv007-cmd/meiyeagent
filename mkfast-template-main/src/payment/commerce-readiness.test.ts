import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CommercePlanCatalogSnapshot,
  PublicPlanCatalog,
} from '@meiye/contracts';

import {
  executeCommerceReadyPlanCheckout,
  evaluateCommerceReadiness,
  type CommerceReadinessPorts,
  type WaffoSubscriptionProductFacts,
} from './commerce-readiness';

const catalog: PublicPlanCatalog = {
  addOns: [
    {
      amountMicros: 57_000_000,
      credits: 100,
      currency: 'HKD',
      expireDays: 7,
      id: 'credits-100',
    },
  ],
  plans: [
    plan('trial', 0, 0, 0),
    plan('starter', 231, 208, 2_081),
    plan('growth', 580, 522, 5_217),
    plan('pro', 1_044, 940, 9_400),
  ],
};

const mappings = (['starter', 'growth', 'pro'] as const).flatMap((tier) =>
  (['single_month', 'monthly', 'yearly'] as const).map((interval) => ({
    interval,
    paymentProductId: `product-${tier}-${interval}`,
    tier,
  }))
);

const snapshot: CommercePlanCatalogSnapshot = {
  catalog,
  paymentMapping: { mappings, revision: 3 },
  planRevision:
    'plan.credits.trial@1|plan.credits.starter@4|plan.credits.growth@5|plan.credits.pro@2|plan.credits.addons@3|plan.credits.cycle_coefficients@6|plan.credits.reference_numbers@2|plan.credits.trial.enabled@1',
};

test('an updated published Core price is the amount checked before checkout', async () => {
  const changed = structuredClone(snapshot);
  const growth = changed.catalog.plans.find(
    (candidate) => candidate.id === 'growth'
  );
  assert.ok(growth);
  growth.cyclePrices = growth.cyclePrices.map((price) =>
    price.cycle === 'monthly' ? { ...price, amountMicros: 555_000_000 } : price
  );
  changed.planRevision = changed.planRevision.replace(
    'plan.credits.cycle_coefficients@6',
    'plan.credits.cycle_coefficients@7'
  );
  const facts = providerFacts(changed.catalog);
  let checkoutCalls = 0;
  const changedPorts = ports({ snapshot: changed, facts });
  const displayProjection = await evaluateCommerceReadiness(changedPorts);
  assert.equal(
    displayProjection.catalog.plans
      .find((candidate) => candidate.id === 'growth')
      ?.cyclePrices.find((candidate) => candidate.cycle === 'monthly')
      ?.amountMicros,
    555_000_000
  );

  const result = await executeCommerceReadyPlanCheckout(
    { cycle: 'monthly', planId: 'growth' },
    changedPorts,
    async (selection) => {
      checkoutCalls += 1;
      assert.equal(selection.amountMicros, 555_000_000);
      assert.equal(selection.productId, 'product-growth-monthly');
      assert.equal(selection.planRevision, changed.planRevision);
      return 'checkout-created';
    }
  );

  assert.equal(result, 'checkout-created');
  assert.equal(checkoutCalls, 1);
});

test('complete Waffo Test configuration exposes one shared ready projection', async () => {
  const readiness = await evaluateCommerceReadiness(
    ports({ snapshot, facts: providerFacts(catalog) })
  );

  assert.equal(readiness.ready, true);
  assert.equal(readiness.planRevision, snapshot.planRevision);
  assert.equal(readiness.planCheckoutReady, true);
  assert.equal(readiness.addOnCheckoutReady, true);
  assert.equal(readiness.portalReady, true);
});

for (const scenario of [
  {
    name: 'missing payment mapping',
    mutate: (input: TestPortsInput) => {
      input.snapshot.paymentMapping = null;
    },
  },
  {
    name: 'provider amount drift',
    mutate: (input: TestPortsInput) => {
      input.facts[0] = { ...input.facts[0], amount: '999.00' };
    },
  },
  {
    name: 'provider currency drift',
    mutate: (input: TestPortsInput) => {
      input.facts[0] = { ...input.facts[0], currency: 'USD' };
    },
  },
  {
    name: 'provider status drift',
    mutate: (input: TestPortsInput) => {
      input.facts[0] = { ...input.facts[0], status: 'draft' };
    },
  },
  {
    name: 'server secret absent',
    mutate: (input: TestPortsInput) => {
      input.privateKey = '';
    },
  },
  {
    name: 'environment not allowed',
    mutate: (input: TestPortsInput) => {
      input.environment = 'production';
    },
  },
] as const) {
  test(`${scenario.name} fails closed before checkout`, async () => {
    const input: TestPortsInput = {
      environment: 'test',
      facts: providerFacts(catalog),
      merchantId: 'merchant-test',
      privateKey: 'test-private-key',
      snapshot: structuredClone(snapshot),
      storeId: 'store-test',
      testCheckoutEnabled: true,
    };
    scenario.mutate(input);
    let checkoutCalls = 0;

    await assert.rejects(
      executeCommerceReadyPlanCheckout(
        { cycle: 'single_month', planId: 'starter' },
        ports(input),
        async () => {
          checkoutCalls += 1;
          return 'must-not-run';
        }
      ),
      /commerce.*not ready/i
    );
    assert.equal(checkoutCalls, 0);
  });
}

function plan(
  id: PublicPlanCatalog['plans'][number]['id'],
  singleMonth: number,
  monthly: number,
  yearly: number
): PublicPlanCatalog['plans'][number] {
  return {
    id,
    credits: id === 'trial' ? 100 : 500,
    concurrencyLimit: 1,
    currency: 'HKD',
    cyclePrices: [
      { amountMicros: singleMonth * 1_000_000, cycle: 'single_month' },
      { amountMicros: monthly * 1_000_000, cycle: 'monthly' },
      { amountMicros: yearly * 1_000_000, cycle: 'yearly' },
    ],
    monthlyPriceMicros: singleMonth * 1_000_000,
    referenceOutputs: { copy: 100, image: 20, video: 2 },
  };
}

function providerFacts(
  governedCatalog: PublicPlanCatalog
): WaffoSubscriptionProductFacts[] {
  return mappings.map((mapping) => {
    const plan = governedCatalog.plans.find(
      (candidate) => candidate.id === mapping.tier
    );
    const price = plan?.cyclePrices.find(
      (candidate) => candidate.cycle === mapping.interval
    );
    assert.ok(price);
    return {
      amount: (price.amountMicros / 1_000_000).toFixed(2),
      currency: 'HKD',
      productId: mapping.paymentProductId,
      status: 'active',
    };
  });
}

interface TestPortsInput {
  environment: 'test' | 'production';
  facts: WaffoSubscriptionProductFacts[];
  merchantId: string;
  privateKey: string;
  snapshot: CommercePlanCatalogSnapshot;
  storeId: string;
  testCheckoutEnabled: boolean;
}

function ports(
  overrides: Partial<TestPortsInput> = {}
): CommerceReadinessPorts {
  const input: TestPortsInput = {
    environment: 'test',
    facts: providerFacts(catalog),
    merchantId: 'merchant-test',
    privateKey: 'test-private-key',
    snapshot: structuredClone(snapshot),
    storeId: 'store-test',
    testCheckoutEnabled: true,
    ...overrides,
  };
  return {
    checkoutAuthority: {
      creditPackageProductMapping: JSON.stringify({
        'credits-100': 'product-addon-100',
      }),
      environment: input.environment,
      merchantId: input.merchantId,
      privateKey: input.privateKey,
      provider: 'waffo',
      storeId: input.storeId,
      testCheckoutEnabled: input.testCheckoutEnabled,
    },
    readCoreSnapshot: async () => input.snapshot,
    readCreditPackageProductFacts: async () => [
      {
        amount: '57.00',
        currency: 'HKD',
        metadata: {
          commerceSku: 'credits-100',
          credits: 100,
          expireDays: 7,
        },
        productId: 'product-addon-100',
        status: 'active',
      },
    ],
    readSubscriptionProductFacts: async () => input.facts,
  };
}
