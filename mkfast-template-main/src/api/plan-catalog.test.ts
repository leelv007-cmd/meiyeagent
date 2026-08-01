import assert from 'node:assert/strict';
import test from 'node:test';

import { PUBLIC_PLAN_CREDIT_SEED } from '@meiye/contracts';

import { fetchPublicPlanCatalog } from './plan-catalog';

test('public plan catalog fails closed on Core HTTP, schema, and transport failures', async () => {
  await assert.rejects(
    fetchPublicPlanCatalog(async () => new Response(null, { status: 503 })),
    /503/u,
  );
  await assert.rejects(
    fetchPublicPlanCatalog(
      async () =>
        new Response(JSON.stringify({ data: { plans: [{ id: 'starter' }] } }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    ),
    /invalid|validation|parse/i,
  );
  await assert.rejects(
    fetchPublicPlanCatalog(async () => {
      throw new Error('core offline');
    }),
    /core offline/u,
  );
});

test('public plan catalog returns the ops-published credit revision', async () => {
  const catalog = { plans: [...PUBLIC_PLAN_CREDIT_SEED] };
  assert.deepEqual(
    await fetchPublicPlanCatalog(
      async () =>
        new Response(JSON.stringify({ data: catalog }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    ),
    catalog,
  );
});
