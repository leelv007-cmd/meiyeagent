import assert from 'node:assert/strict';
import test from 'node:test';

import { CreditSubscriptionEntitlementPolicy } from './credit-entitlement-policy.js';
import { MemoryCreditLedger } from './credit-ledger.js';
import { DEFAULT_CREDIT_PLAN_CATALOG } from './credit-plan-catalog.js';
import { MemoryCreditSubscriptionStore } from './credit-subscription-scheduler.js';

test('booster-only credits never restore paid non-credit entitlements', async () => {
  let now = new Date('2026-08-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const policy = new CreditSubscriptionEntitlementPolicy(
    subscriptions,
    { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
    () => now,
  );

  ledger.grant({
    id: 'booster-only',
    workspaceId: 'workspace-booster',
    credits: 100,
    expirationDate: '2026-08-08T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
    sourceRef: 'credits-100',
    createdAt: now.toISOString(),
  });
  ledger.consume({
    workspaceId: 'workspace-booster',
    credits: 5,
    transactionId: 'consume:booster-only-quote',
    actorId: 'owner-1',
    correlationId: 'booster-only-test',
    createdAt: now.toISOString(),
  });

  assert.equal(ledger.project('workspace-booster').availableCredits, 95);
  assert.deepEqual(
    await policy.resolve('workspace-booster'),
    defaultPolicy('trial', 'credit-entitlement:default:workspace-booster'),
  );

  await subscriptions.upsert({
    id: 'subscription-growth',
    workspaceId: 'workspace-booster',
    tier: 'growth',
    interval: 'monthly',
    anchorAt: '2026-08-01T00:00:00.000Z',
    paidThroughCycle: 1,
  });
  assert.equal((await policy.resolve('workspace-booster'))?.tier, 'growth');
  assert.equal((await policy.resolve('workspace-booster'))?.concurrencyLimit, 4);

  now = new Date('2026-09-01T00:00:00.000Z');
  await subscriptions.markPastDue('subscription-growth', now.toISOString());
  assert.equal((await policy.resolve('workspace-booster'))?.tier, 'growth');

  now = new Date('2026-09-08T00:00:00.000Z');
  assert.deepEqual(
    await policy.resolve('workspace-booster'),
    defaultPolicy('trial', 'credit-entitlement:default:workspace-booster'),
  );
});

function defaultPolicy(
  tier: 'trial',
  revision: string,
) {
  return {
    addOns: [],
    allowance: { audio: 0, copy: 0, image: 0, video: 0 },
    autoTopUp: {
      enabled: false,
      monthlyCapMicros: 0,
      spentThisMonthMicros: 0,
    },
    concurrencyLimit: 1,
    queuePriority: 1,
    revision,
    supportLabel: 'standard' as const,
    tier,
  };
}
