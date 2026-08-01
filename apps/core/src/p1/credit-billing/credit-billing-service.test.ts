import assert from 'node:assert/strict';
import test from 'node:test';

import type { P1Context } from '../foundation/domain.js';
import { CreditBillingService } from './credit-billing-service.js';
import { MemoryCreditLedger } from './credit-ledger.js';
import { DEFAULT_CREDIT_PLAN_CATALOG } from './credit-plan-catalog.js';
import {
  CreditSubscriptionCycleScheduler,
  MemoryCreditSubscriptionStore,
} from './credit-subscription-scheduler.js';

const context: P1Context = {
  correlationId: 'credit-billing-test',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
};

test('credit payment settlement preserves package lots across upgrades and applies a downgrade next cycle', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = new CreditBillingService(
    ledger,
    subscriptions,
    { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
    {
      async getPaymentMapping() {
        return {
          mappings: [
            { interval: 'month', paymentProductId: 'starter', tier: 'starter' },
            { interval: 'month', paymentProductId: 'growth', tier: 'growth' },
          ],
        };
      },
    },
    () => now,
  );
  const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
    planFor(tier) {
      const plan = DEFAULT_CREDIT_PLAN_CATALOG.plans.find(
        (candidate) => candidate.id === tier,
      );
      if (!plan) throw new Error(`Missing ${tier} plan.`);
      return plan;
    },
  });

  await service.grantTrial(context);
  await service.grantTrial(context);
  assert.equal(
    ledger
      .listLots(context.workspaceId)
      .filter((lot) => lot.grantIdempotencyKey === 'grant:trial:workspace-1')
      .length,
    1,
  );

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-starter',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-1',
  });
  await scheduler.run(now.toISOString());

  now = new Date('2026-01-02T00:00:00.000Z');
  await service.grantAddOn(context, {
    offerId: 'credits-100',
    paymentEventId: 'payment-package',
  });

  now = new Date('2026-01-03T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-upgrade',
    paymentProductId: 'growth',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-1',
  });
  await scheduler.run(now.toISOString());

  const afterUpgrade = ledger.listLots(context.workspaceId);
  assert.equal(
    afterUpgrade.find(
      (lot) => lot.grantIdempotencyKey === 'grant:sub:subscription-1:0',
    )?.remainingCredits,
    0,
  );
  assert.equal(
    afterUpgrade.find((lot) => lot.sourceRef === 'credits-100')?.remainingCredits,
    100,
  );
  assert.ok(
    afterUpgrade.some(
      (lot) => lot.grantIdempotencyKey === 'grant:sub:subscription-1:1',
    ),
  );

  now = new Date('2026-01-04T00:00:00.000Z');
  const scheduledDowngrade = await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-downgrade',
    paymentProductId: 'starter',
    subscriptionId: 'subscription-1',
  });
  assert.equal(scheduledDowngrade?.tier, 'growth');
  assert.equal(scheduledDowngrade?.pendingTier, 'starter');
  assert.equal(scheduledDowngrade?.pendingEffectiveCycle, 1);

  now = new Date('2026-02-03T00:00:00.000Z');
  const renewed = await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'renew',
    paymentEventId: 'payment-renewal',
    paymentProductId: 'starter',
    subscriptionId: 'subscription-1',
  });
  assert.equal(renewed?.tier, 'growth');
  assert.equal(renewed?.pendingTier, 'starter');
  await scheduler.run(now.toISOString());
  assert.equal(
    ledger
      .listLots(context.workspaceId)
      .find(
        (lot) => lot.grantIdempotencyKey === 'grant:sub:subscription-1:2',
      )?.originalCredits,
    500,
  );

  now = new Date('2026-03-03T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'past_due',
    paymentEventId: 'payment-failed',
    paymentProductId: 'starter',
    subscriptionId: 'subscription-1',
  });
  assert.equal((await subscriptions.get('subscription-1'))?.status, 'past_due');
  assert.equal((await scheduler.run(now.toISOString())).grantedCycles, 0);

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'renew',
    paymentEventId: 'payment-recovered',
    paymentProductId: 'starter',
    subscriptionId: 'subscription-1',
  });
  assert.equal((await subscriptions.get('subscription-1'))?.status, 'active');
  assert.equal((await scheduler.run(now.toISOString())).grantedCycles, 1);
});

test('verified payment events replay once and reject conflicting facts', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = new CreditBillingService(
    ledger,
    subscriptions,
    { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
    {
      async getPaymentMapping() {
        return {
          mappings: [
            { interval: 'month', paymentProductId: 'starter', tier: 'starter' },
            { interval: 'month', paymentProductId: 'growth', tier: 'growth' },
          ],
        };
      },
    },
    () => now,
  );

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-activate-once',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-replay',
  });
  now = new Date('2026-02-01T00:00:00.000Z');
  const renewal = {
    interval: 'month' as const,
    lifecycle: 'renew' as const,
    paymentEventId: 'payment-renew-once',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-replay',
  };
  await service.settlePayment(context, renewal);
  now = new Date('2026-02-01T01:00:00.000Z');
  await service.settlePayment(context, renewal);

  assert.equal(
    (await subscriptions.get('subscription-replay'))?.paidThroughCycle,
    2,
  );
  await assert.rejects(
    service.settlePayment(context, {
      ...renewal,
      paymentProductId: 'growth',
    }),
    /different facts/i,
  );
});
