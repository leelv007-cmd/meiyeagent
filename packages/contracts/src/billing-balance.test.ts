import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUBLIC_PLAN_CREDIT_SEED,
  publicBillingBalanceSchema,
  publicCreditBalanceSchema,
  publicPlanCatalogSchema,
} from './billing-balance.js';
import { CREDIT_PLAN_CONFIG_DEFAULTS } from './credit-plan-config.js';

test('public billing balance is an exact copy/image/video projection', () => {
  const balance = publicBillingBalanceSchema.parse({
    copy: {
      allowance: 12,
      available: 9,
      committed: 2,
      released: 1,
      reserved: 1,
    },
    image: {
      allowance: 7,
      available: 7,
      committed: 0,
      released: 0,
      reserved: 0,
    },
    video: {
      allowance: 2,
      available: 1,
      committed: 1,
      released: 0,
      reserved: 0,
    },
  });

  assert.deepEqual(Object.keys(balance), ['copy', 'image', 'video']);
  assert.equal(
    publicBillingBalanceSchema.safeParse({
      ...balance,
      audio: balance.copy,
    }).success,
    false,
  );
});

test('public credit balance is a strict single-credit projection', () => {
  const balance = publicCreditBalanceSchema.parse({
    grantedCredits: 500,
    usedCredits: 120,
    refundedCredits: 20,
    expiredCredits: 30,
    availableCredits: 370,
    soonestExpiringLot: {
      remainingCredits: 42,
      expiresAt: '2026-08-10T00:00:00.000Z',
    },
  });

  assert.deepEqual(Object.keys(balance), [
    'grantedCredits',
    'usedCredits',
    'refundedCredits',
    'expiredCredits',
    'availableCredits',
    'soonestExpiringLot',
  ]);
  assert.equal(
    publicCreditBalanceSchema.safeParse({ ...balance, copy: 1 }).success,
    false,
  );
});

test('public credit balance exposes only a nullable merchant-safe expiring lot', () => {
  const noExpiringLot = publicCreditBalanceSchema.parse({
    grantedCredits: 500,
    usedCredits: 500,
    refundedCredits: 0,
    expiredCredits: 0,
    availableCredits: 0,
    soonestExpiringLot: null,
  });

  assert.equal(noExpiringLot.soonestExpiringLot, null);
  assert.equal(
    publicCreditBalanceSchema.safeParse({
      ...noExpiringLot,
      soonestExpiringLot: {
        remainingCredits: 42,
        expiresAt: '2026-08-10T00:00:00.000Z',
        lotId: 'internal-lot-id',
      },
    }).success,
    false,
  );
  assert.equal(
    publicCreditBalanceSchema.safeParse({
      ...noExpiringLot,
      soonestExpiringLot: {
        remainingCredits: 42,
        expiresAt: 'not-an-iso-date',
      },
    }).success,
    false,
  );
});

test('the public plan catalog accepts HKD and rejects legacy CNY pricing', () => {
  const catalog = {
    addOns: CREDIT_PLAN_CONFIG_DEFAULTS['plan.credits.addons'],
    plans: PUBLIC_PLAN_CREDIT_SEED,
  };
  assert.equal(publicPlanCatalogSchema.safeParse(catalog).success, true);
  assert.equal(
    publicPlanCatalogSchema.safeParse({
      ...catalog,
      plans: catalog.plans.map((plan) => ({ ...plan, currency: 'CNY' })),
    }).success,
    false,
  );
});
