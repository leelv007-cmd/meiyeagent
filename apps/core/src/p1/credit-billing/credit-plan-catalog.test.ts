import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminConfigCreditPlanCatalogSource,
  type CreditPlanConfigRepository,
} from '../admin-config/credit-plan-catalog-source.js';
import {
  creditPlanConcurrencyTiers,
  DEFAULT_CREDIT_PLAN_CATALOG,
  MAX_CREDIT_PLAN_CONCURRENCY,
} from './credit-plan-catalog.js';

test('job runtime registers every publishable credit plan concurrency tier', () => {
  assert.deepEqual(creditPlanConcurrencyTiers(),
    Array.from({ length: MAX_CREDIT_PLAN_CONCURRENCY }, (_, index) => index + 1));
});

test('plan.credits is the only operator override source for plan and package credits', async () => {
  const reads: string[] = [];
  const repository: CreditPlanConfigRepository = {
    async get(_scope, _workspaceId, key) {
      reads.push(key);
      if (key === 'plan.credits.growth') {
        return {
          value: {
            credits: 1_500,
            concurrencyLimit: 4,
            queuePriority: 5,
            supportLabel: 'priority',
          },
        };
      }
      return null;
    },
  };

  const catalog = await new AdminConfigCreditPlanCatalogSource(repository).get();

  assert.deepEqual(reads, [
    'plan.credits.trial',
    'plan.credits.starter',
    'plan.credits.growth',
    'plan.credits.pro',
    'plan.credits.addons',
    'plan.credits.trial.enabled',
  ]);
  assert.equal(catalog.plans.find((plan) => plan.id === 'growth')?.credits, 1_500);
  assert.deepEqual(catalog.addOns, DEFAULT_CREDIT_PLAN_CATALOG.addOns);
  assert.equal(catalog.trialEnabled, true);
});

test('credit plan seeds match the approved trial, subscription and seven-day package values', () => {
  assert.deepEqual(DEFAULT_CREDIT_PLAN_CATALOG.plans, [
    { id: 'trial', credits: 100, concurrencyLimit: 1, queuePriority: 1, supportLabel: 'standard' },
    { id: 'starter', credits: 500, concurrencyLimit: 1, queuePriority: 1, supportLabel: 'standard' },
    { id: 'growth', credits: 1_300, concurrencyLimit: 4, queuePriority: 5, supportLabel: 'priority' },
    { id: 'pro', credits: 2_800, concurrencyLimit: 8, queuePriority: 10, supportLabel: 'priority' },
  ]);
  assert.deepEqual(
    DEFAULT_CREDIT_PLAN_CATALOG.addOns.map((offer) => [offer.credits, offer.expireDays]),
    [[100, 7], [300, 7], [1_000, 7]],
  );
});
