import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CompositeProductEntitlementPolicy,
  type ProductEntitlementPolicy,
} from './entitlement-policy.js';

const productPolicy: ProductEntitlementPolicy = {
  addOns: [],
  allowance: { audio: 0, copy: 100, image: 40, video: 20 },
  autoTopUp: {
    enabled: false,
    monthlyCapMicros: 0,
    spentThisMonthMicros: 0,
  },
  concurrencyLimit: 4,
  queuePriority: 5,
  revision: 'product-entitlement:growth:payment-event-1',
  supportLabel: 'priority',
  tier: 'growth',
};

const recordedPolicy: ProductEntitlementPolicy = {
  ...productPolicy,
  allowance: { audio: 0, copy: 300, image: 120, video: 60 },
  concurrencyLimit: 8,
  queuePriority: 10,
  revision: 'recorded-pro-2026-07',
  tier: 'pro',
};

const supplement = {
  addOns: [{ purchaseId: 'image-addon-1', quantity: 10, resource: 'image' as const }],
  autoTopUp: {
    enabled: true,
    monthlyCapMicros: 5_000_000,
    spentThisMonthMicros: 1_000_000,
  },
  policy: recordedPolicy,
  revision: 'foundation-supplement-r1',
};

test('composite entitlement keeps real ProductState plan truth and merges Foundation supplements', async () => {
  const composite = new CompositeProductEntitlementPolicy(
    { async resolve() { return productPolicy; } },
    { async resolveSupplement() { return supplement; } },
    { allowFoundationSupplements: true },
  );

  const resolved = await composite.resolve('workspace-a');

  assert.equal(resolved?.tier, 'growth');
  assert.deepEqual(resolved?.allowance, productPolicy.allowance);
  assert.deepEqual(resolved?.addOns, supplement.addOns);
  assert.deepEqual(resolved?.autoTopUp, supplement.autoTopUp);
  assert.match(resolved?.revision ?? '', /product-entitlement:growth/);
  assert.match(resolved?.revision ?? '', /foundation-supplement-r1/);
});

test('composite entitlement lets an explicit Foundation plan replace only ProductState bootstrap', async () => {
  const composite = new CompositeProductEntitlementPolicy(
    {
      async resolve() {
        return {
          ...productPolicy,
          revision: 'product-entitlement:starter:bootstrap',
          tier: 'starter' as const,
        };
      },
    },
    { async resolveSupplement() { return supplement; } },
    {
      allowFoundationPlan: true,
      allowFoundationSupplements: true,
    },
  );

  const resolved = await composite.resolve('workspace-a');

  assert.equal(resolved?.tier, 'pro');
  assert.deepEqual(resolved?.allowance, recordedPolicy.allowance);
});

test('composite entitlement ignores recorded Foundation grants when the production gate is off', async () => {
  const composite = new CompositeProductEntitlementPolicy(
    { async resolve() { return productPolicy; } },
    { async resolveSupplement() { return supplement; } },
  );

  const resolved = await composite.resolve('workspace-a');

  assert.deepEqual(resolved?.addOns, []);
  assert.equal(resolved?.autoTopUp.enabled, false);
  assert.match(resolved?.revision ?? '', /foundation-supplements-disabled/);
});
