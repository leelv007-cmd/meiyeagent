import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { DiagnosticRun } from '@meiye/contracts';
import type { DiagnosticRepository } from '../../diagnostics/repository.js';
import { createCoreServer } from '../../server.js';
import {
  AdminConfigCreditPlanCatalogSource,
  ensureCreditPlanCatalogDefaults,
} from '../admin-config/credit-plan-catalog-source.js';
import { MemoryAdminConfigRepository } from '../admin-config/foundation-module.js';
import { DEFAULT_CREDIT_PLAN_CATALOG } from './credit-plan-catalog.js';

const diagnostics: DiagnosticRepository = {
  async create(run: DiagnosticRun) {
    return run;
  },
  async get() {
    return null;
  },
  async save(run: DiagnosticRun) {
    return run;
  },
};

test('published plan prices reach the service-token-gated Core read contract', async (t) => {
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    planCatalog: {
      async get() {
        return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG);
      },
    },
    serviceToken: 'plan-catalog-test-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/public/plan-catalog`;

  assert.equal((await fetch(url)).status, 401);

  const response = await fetch(url, {
    headers: { 'x-service-token': 'plan-catalog-test-token' },
  });
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: {
      addOns: Array<{ credits: number; expireDays: number }>;
      plans: Array<{
        cyclePrices: Array<{ amountMicros: number; cycle: string }>;
        id: string;
        monthlyPriceMicros: number;
        referenceOutputs: { copy: number; image: number; video: number };
      }>;
    };
  };
  const growth = payload.data.plans.find((plan) => plan.id === 'growth');
  const trial = payload.data.plans.find((plan) => plan.id === 'trial');
  assert.deepEqual(
    payload.data.plans.map((plan) => plan.id),
    ['trial', 'starter', 'growth', 'pro']
  );
  assert.deepEqual(trial?.cyclePrices, [
    { amountMicros: 0, cycle: 'single_month' },
    { amountMicros: 0, cycle: 'monthly' },
    { amountMicros: 0, cycle: 'yearly' },
  ]);
  assert.deepEqual(trial?.referenceOutputs, {
    copy: 100,
    image: 20,
    video: 2,
  });
  assert.equal(growth?.monthlyPriceMicros, 579_700_809);
  assert.deepEqual(growth?.cyclePrices, [
    { amountMicros: 580_000_000, cycle: 'single_month' },
    { amountMicros: 522_000_000, cycle: 'monthly' },
    { amountMicros: 5_217_000_000, cycle: 'yearly' },
  ]);
  assert.deepEqual(growth?.referenceOutputs, {
    copy: 1_300,
    image: 260,
    video: 26,
  });
  assert.deepEqual(
    payload.data.addOns.map((offer) => [offer.credits, offer.expireDays]),
    [[100, 7], [300, 7], [1_000, 7]]
  );
  assert.equal(JSON.stringify(payload).includes('token'), false);
  assert.equal(JSON.stringify(payload).includes('provider'), false);
  assert.equal(JSON.stringify(payload).includes('referenceModels'), false);
});

test('the public plan catalog keeps reference outputs unchanged until the admin revision is confirmed', async (t) => {
  const repository = new MemoryAdminConfigRepository();
  await ensureCreditPlanCatalogDefaults(repository);
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    planCatalog: new AdminConfigCreditPlanCatalogSource(repository),
    serviceToken: 'plan-catalog-test-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/public/plan-catalog`;
  const readGrowthImage = async () => {
    const response = await fetch(url, {
      headers: { 'x-service-token': 'plan-catalog-test-token' },
    });
    const payload = (await response.json()) as {
      data: {
        plans: Array<{ id: string; referenceOutputs: { image: number } }>;
      };
    };
    return payload.data.plans.find((plan) => plan.id === 'growth')
      ?.referenceOutputs.image;
  };

  assert.equal(await readGrowthImage(), 260);
  const current = await repository.get(
    'global',
    '__global__',
    'plan.credits.reference_numbers'
  );
  assert.ok(current);
  const unconfirmedDraft = structuredClone(current.value) as {
    published: Record<string, { image: number }>;
  };
  const growthDraft = unconfirmedDraft.published.growth;
  assert.ok(growthDraft);
  growthDraft.image = 130;
  assert.equal(await readGrowthImage(), 260);

  await repository.apply({
    actorId: 'platform-admin',
    correlationId: 'confirm-reference-numbers',
    expectedRevision: current.revision,
    key: 'plan.credits.reference_numbers',
    reason: 'Confirm updated reference outputs.',
    scope: 'global',
    value: unconfirmedDraft,
    workspaceId: '__global__',
  });
  assert.equal(await readGrowthImage(), 130);
});
