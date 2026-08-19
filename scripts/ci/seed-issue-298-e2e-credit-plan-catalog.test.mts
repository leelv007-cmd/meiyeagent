import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminConfigCreditPlanCatalogSource } from '../../apps/core/src/p1/admin-config/credit-plan-catalog-source.js';
import { MemoryAdminConfigRepository } from '../../apps/core/src/p1/admin-config/foundation-module.js';
import { seedIssue298E2eCreditPlanCatalog } from './seed-issue-298-e2e-credit-plan-catalog.mts';

const STARTUP_KEYS = [
  'plan.credits.trial',
  'plan.credits.starter',
  'plan.credits.growth',
  'plan.credits.pro',
  'plan.credits.addons',
  'plan.credits.cycle_coefficients',
  'plan.credits.reference_numbers',
  'plan.credits.trial.enabled',
] as const;

test('issue 298 E2E seed publishes every startup catalog key', async () => {
  const repository = new MemoryAdminConfigRepository();
  await seedIssue298E2eCreditPlanCatalog(repository);

  for (const key of STARTUP_KEYS) {
    const current = await repository.get('global', '__global__', key);
    assert.ok(current, `missing published key ${key}`);
  }

  const catalog = await new AdminConfigCreditPlanCatalogSource(repository).get();
  assert.equal(catalog.plans.length, 4);
  assert.equal(catalog.cycleCoefficientBasisPoints.monthly, 9_000);
  assert.equal(catalog.referenceNumbers.published.starter.copy, 500);
  assert.equal(catalog.trialEnabled, true);
});
