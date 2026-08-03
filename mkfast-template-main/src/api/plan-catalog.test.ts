import assert from 'node:assert/strict';
import test from 'node:test';

import { PUBLIC_PLAN_CREDIT_SEED } from '@meiye/contracts';

import { fetchPublicPlanCatalog } from './plan-catalog';

test('public plan catalog fails closed on Core HTTP, schema, and transport failures', async () => {
  await assert.rejects(
    fetchPublicPlanCatalog(async () => new Response(null, { status: 503 })),
    /503/u
  );
  await assert.rejects(
    fetchPublicPlanCatalog(
      async () =>
        new Response(JSON.stringify({ data: { plans: [{ id: 'starter' }] } }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
    ),
    /invalid|validation|parse/i
  );
  await assert.rejects(
    fetchPublicPlanCatalog(async () => {
      throw new Error('core offline');
    }),
    /core offline/u
  );
});

test('public plan catalog returns the ops-published credit revision', async () => {
  const catalog = {
    addOns: [
      {
        amountMicros: 57_000_000,
        credits: 100,
        currency: 'HKD',
        expireDays: 7,
        id: 'credits-100',
      },
    ],
    plans: PUBLIC_PLAN_CREDIT_SEED.map((plan) => ({
      ...plan,
      cyclePrices: [
        { amountMicros: 231_000_000, cycle: 'single_month' },
        { amountMicros: 208_000_000, cycle: 'monthly' },
        { amountMicros: 2_081_000_000, cycle: 'yearly' },
      ],
      monthlyPriceMicros: 231_183_288,
    })),
  };
  assert.deepEqual(
    await fetchPublicPlanCatalog(
      async () =>
        new Response(JSON.stringify({ data: catalog }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
    ),
    catalog
  );
});

test('public plan catalog rejects a legacy CNY revision', async () => {
  const legacyCatalog = {
    addOns: [
      {
        amountMicros: 49_000_000,
        credits: 100,
        currency: 'CNY',
        expireDays: 7,
        id: 'credits-100',
      },
    ],
    plans: PUBLIC_PLAN_CREDIT_SEED.map((plan) => ({
      ...plan,
      currency: 'CNY',
    })),
  };

  await assert.rejects(
    fetchPublicPlanCatalog(
      async () =>
        new Response(JSON.stringify({ data: legacyCatalog }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
    ),
    /invalid/u
  );
});
