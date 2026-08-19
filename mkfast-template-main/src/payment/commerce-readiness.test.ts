import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CommercePlanCatalogSnapshot,
  PublicPlanCatalog,
} from '@meiye/contracts';

import {
  assertFrozenPlanCommerceAuthority,
  executeCommerceReadyAddOnCheckout,
  executeCommerceReadyPlanCheckout,
  evaluateCommerceReadiness,
  toPublicCommerceReadiness,
  type CommerceReadinessPorts,
  type WaffoSubscriptionProductFacts,
} from './commerce-readiness';
import {
  planGrantCommandFromIntent,
  planSettlementIntentFromEvent,
} from './plan-commerce';

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

test('checkout authority remains the settlement truth after the admin mapping changes', async () => {
  const selection = await executeCommerceReadyPlanCheckout(
    { cycle: 'monthly', planId: 'growth' },
    ports(),
    async (frozen) => frozen
  );
  const changed = structuredClone(snapshot);
  changed.catalog.plans.find((plan) => plan.id === 'growth')!.credits = 9_999;
  changed.paymentMapping!.mappings.find(
    (mapping) =>
      mapping.paymentProductId === 'product-growth-monthly' &&
      mapping.interval === 'monthly'
  )!.tier = 'pro';

  const intent = planSettlementIntentFromEvent(
    {
      eventType: 'checkout.completed',
      provider: 'waffo',
      providerEventId: 'PAY_frozen_growth',
      reference: { id: 'checkout-frozen-growth', kind: 'checkout' },
    },
    {
      commerceAuthority: {
        amountMicros: selection.amountMicros,
        billingPeriod: 'monthly',
        credits: selection.credits,
        currency: selection.currency,
        paymentMappingRevision: selection.paymentMappingRevision,
        period: selection.cycle,
        planRevision: selection.planRevision,
        tier: selection.planId,
      },
      interval: selection.cycle,
      ownerUserId: 'owner-frozen-growth',
      periodEndsAt: '2026-09-19T00:00:00.000Z',
      periodStartsAt: '2026-08-19T00:00:00.000Z',
      priceId: selection.productId,
      subscriptionId: 'ORD_frozen_growth',
      workspaceId: 'workspace-frozen-growth',
    }
  );
  assert.ok(intent);
  assert.deepEqual(
    planGrantCommandFromIntent(intent).payload.settlementAuthority,
    {
      amountMicros: 522_000_000,
      billingPeriod: 'monthly',
      credits: 500,
      currency: 'HKD',
      paymentMappingRevision: 3,
      paymentProductId: 'product-growth-monthly',
      paymentProvider: 'waffo',
      period: 'monthly',
      planRevision: snapshot.planRevision,
      tier: 'growth',
    }
  );
  assert.equal(
    changed.catalog.plans.find((plan) => plan.id === 'growth')?.credits,
    9_999
  );
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
  const publicProjection = toPublicCommerceReadiness(readiness);
  assert.deepEqual(Object.keys(publicProjection), ['catalog', 'ready']);
  assert.deepEqual(Object.keys(publicProjection.ready).sort(), [
    'addOnCheckout',
    'planCheckout',
    'portal',
  ]);
  assert.equal(JSON.stringify(publicProjection).includes('Revision'), false);
  assert.equal(JSON.stringify(publicProjection).includes('reasonCodes'), false);
});

test('plan checkout rejects provider drift on the final read before mutation', async () => {
  const stableFacts = providerFacts(catalog);
  let providerReads = 0;
  let mutationCalls = 0;
  const racePorts = ports({ snapshot, facts: stableFacts });
  racePorts.readSubscriptionProductFacts = async () => {
    providerReads += 1;
    return providerReads === 1
      ? stableFacts
      : stableFacts.map((fact, index) =>
          index === 0 ? { ...fact, amount: '999.00' } : fact
        );
  };

  await assert.rejects(
    executeCommerceReadyPlanCheckout(
      { cycle: 'single_month', planId: 'starter' },
      racePorts,
      async () => {
        mutationCalls += 1;
        return 'must-not-run';
      }
    ),
    /commerce.*changed|not ready/i
  );
  assert.equal(providerReads, 2);
  assert.equal(mutationCalls, 0);
});

test('add-on checkout rejects Core drift before binding or provider mutation', async () => {
  let coreReads = 0;
  let mutationCalls = 0;
  const racePorts = ports();
  racePorts.readCoreSnapshot = async () => {
    coreReads += 1;
    if (coreReads === 1) return structuredClone(snapshot);
    const changed = structuredClone(snapshot);
    changed.planRevision = changed.planRevision.replace(
      'plan.credits.addons@3',
      'plan.credits.addons@4'
    );
    return changed;
  };

  await assert.rejects(
    executeCommerceReadyAddOnCheckout(
      { offerId: 'credits-100' },
      racePorts,
      async () => {
        mutationCalls += 1;
        return 'must-not-run';
      }
    ),
    /commerce.*changed|not ready/i
  );
  assert.equal(coreReads, 2);
  assert.equal(mutationCalls, 0);
});

test('plan checkout rejects Core mapping drift before mutation', async () => {
  let coreReads = 0;
  let mutationCalls = 0;
  const racePorts = ports();
  racePorts.readCoreSnapshot = async () => {
    coreReads += 1;
    const current = structuredClone(snapshot);
    if (coreReads === 2 && current.paymentMapping) {
      current.paymentMapping.revision += 1;
    }
    return current;
  };
  await assert.rejects(
    executeCommerceReadyPlanCheckout(
      { cycle: 'monthly', planId: 'growth' },
      racePorts,
      async () => {
        mutationCalls += 1;
        return 'must-not-run';
      }
    ),
    /mapping revision changed/i
  );
  assert.equal(mutationCalls, 0);
});

test('add-on checkout rejects provider drift before mutation', async () => {
  const racePorts = ports();
  let providerReads = 0;
  let mutationCalls = 0;
  racePorts.readCreditPackageProductFacts = async () => {
    providerReads += 1;
    return [
      {
        amount: providerReads === 1 ? '57.00' : '58.00',
        currency: 'HKD',
        metadata: {
          commerceSku: 'credits-100',
          credits: 100,
          expireDays: 7,
        },
        productId: 'product-addon-100',
        status: 'active',
      },
    ];
  };
  await assert.rejects(
    executeCommerceReadyAddOnCheckout(
      { offerId: 'credits-100' },
      racePorts,
      async () => {
        mutationCalls += 1;
        return 'must-not-run';
      }
    ),
    /commerce authority changed/i
  );
  assert.equal(providerReads, 2);
  assert.equal(mutationCalls, 0);
});

test('webhook settlement rejects provider facts outside the frozen checkout authority', () => {
  const binding = {
    commerceAuthority: {
      amountMicros: 522_000_000,
      billingPeriod: 'monthly' as const,
      credits: 1_300,
      currency: 'HKD' as const,
      paymentMappingRevision: 3,
      period: 'monthly' as const,
      planRevision: snapshot.planRevision,
      tier: 'growth' as const,
    },
    priceId: 'product-growth-monthly',
  };
  const facts = providerFacts(catalog).filter(
    (fact) => fact.productId === binding.priceId
  );
  assert.doesNotThrow(() => assertFrozenPlanCommerceAuthority(binding, facts));
  assert.throws(
    () =>
      assertFrozenPlanCommerceAuthority(binding, [
        {
          ...facts[0],
          metadata: { commercePeriod: 'yearly', commerceTier: 'growth' },
        },
      ]),
    /frozen commerce authority/i
  );
});

test('a provider timeout disables only its CTA scope and keeps the catalog public', async () => {
  const scopedPorts = ports();
  scopedPorts.checkoutAuthority.deadlineMs = 5;
  scopedPorts.readSubscriptionProductFacts = async () =>
    new Promise(() => undefined);
  const readiness = await evaluateCommerceReadiness(scopedPorts, 'display');
  assert.equal(readiness.planCheckoutReady, false);
  assert.equal(readiness.addOnCheckoutReady, true);
  assert.equal(readiness.portalReady, true);
  assert.equal(readiness.catalog.plans.length, 4);
});

test('portal scope does not read plan or add-on provider products', async () => {
  const scopedPorts = ports();
  let productReads = 0;
  scopedPorts.readSubscriptionProductFacts = async () => {
    productReads += 1;
    return [];
  };
  scopedPorts.readCreditPackageProductFacts = async () => {
    productReads += 1;
    return [];
  };
  const readiness = await evaluateCommerceReadiness(scopedPorts, 'portal');
  assert.equal(readiness.portalReady, true);
  assert.equal(productReads, 0);
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
    name: 'provider billing period drift',
    mutate: (input: TestPortsInput) => {
      input.facts[0] = { ...input.facts[0], billingPeriod: 'yearly' };
    },
  },
  {
    name: 'provider commerce metadata drift',
    mutate: (input: TestPortsInput) => {
      input.facts[0] = {
        ...input.facts[0],
        metadata: {
          commercePeriod: 'yearly',
          commerceTier: 'starter',
        },
      };
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
      billingPeriod: mapping.interval === 'yearly' ? 'yearly' : 'monthly',
      currency: 'HKD',
      metadata: {
        commercePeriod: mapping.interval,
        commerceTier: mapping.tier,
      },
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
    readSubscriptionProductFacts: async (productIds) =>
      input.facts.filter((fact) => productIds.includes(fact.productId)),
  };
}
