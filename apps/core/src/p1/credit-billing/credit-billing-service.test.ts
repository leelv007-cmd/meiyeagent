import assert from 'node:assert/strict';
import test from 'node:test';

import type { P1Context } from '../foundation/domain.js';
import {
  CreditBillingService,
  type CreditBillingLedgerPort,
} from './credit-billing-service.js';
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
    credits: 100,
    expireDays: 7,
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
    periodStartsAt: now.toISOString(),
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
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-1',
  });
  assert.equal((await subscriptions.get('subscription-1'))?.status, 'past_due');
  assert.equal((await scheduler.run(now.toISOString())).grantedCycles, 0);

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'renew',
    paymentEventId: 'payment-recovered',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
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
  const duplicateRenewal = await service.settlePayment(context, renewal);
  assert.equal(duplicateRenewal?.settlementStatus, 'duplicate');

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

test('a Waffo activation and payment success share one paid billing period', async () => {
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(
    ledger,
    subscriptions,
    () => new Date('2026-08-03T00:00:00.000Z'),
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
  const firstPeriod = {
    interval: 'monthly' as const,
    lifecycle: 'activate' as const,
    paymentEventId:
      'waffo:subscription:ORD_first_period:2026-08-03T00:00:00.000Z:2026-09-03T00:00:00.000Z',
    paymentProductId: 'PROD_growth_monthly',
    paymentProvider: 'waffo' as const,
    periodStartsAt: '2026-08-03T00:00:00.000Z',
    providerOccurredAt: '2026-08-03T00:00:01.000Z',
    subscriptionId: 'ORD_first_period',
  };

  await service.settlePayment(context, firstPeriod);
  await scheduler.run(firstPeriod.periodStartsAt);
  await service.settlePayment(context, {
    ...firstPeriod,
    lifecycle: 'renew',
    providerOccurredAt: '2026-08-03T00:00:02.000Z',
  });

  assert.equal(
    (await subscriptions.get(firstPeriod.subscriptionId))?.paidThroughCycle,
    1,
  );
  assert.equal(
    ledger
      .listLots(context.workspaceId)
      .filter(
        (lot) =>
          lot.grantIdempotencyKey ===
          `grant:sub:${firstPeriod.subscriptionId}:0`,
      ).length,
    1,
  );
  await assert.rejects(
    service.settlePayment(context, {
      ...firstPeriod,
      paymentProductId: 'PROD_pro_monthly',
    }),
    /different facts/i,
  );
});

test('uncancel_at_period_end clears a scheduled cancellation without using past-due resume', async () => {
  let now = new Date('2026-08-03T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const subscriptionId = 'subscription-uncancel-period-end';

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-uncancel-activate',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  now = new Date('2026-08-04T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'cancel_at_period_end',
    paymentEventId: 'payment-uncancel-schedule',
    paymentProductId: 'starter',
    periodStartsAt: '2026-08-03T00:00:00.000Z',
    subscriptionId,
  });
  assert.equal((await subscriptions.get(subscriptionId))?.pendingEffectiveCycle, 1);

  const uncanceled = await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'uncancel_at_period_end',
    paymentEventId: 'payment-uncancel-reverse',
    paymentProductId: 'starter',
    periodStartsAt: '2026-08-03T00:00:00.000Z',
    subscriptionId,
  });
  assert.equal(uncanceled?.status, 'active');
  assert.deepEqual((await subscriptions.get(subscriptionId))?.scheduledChanges, []);
});

test('replays a legacy Waffo paid-period receipt without widening its facts', async () => {
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(
    ledger,
    subscriptions,
    () => new Date('2026-08-03T00:00:00.000Z'),
  );
  const legacyWaffoRenewal = {
    interval: 'monthly' as const,
    lifecycle: 'renew' as const,
    paymentEventId:
      'waffo:subscription:ORD_legacy_period:2026-08-03T00:00:00.000Z:2026-09-03T00:00:00.000Z',
    paymentProductId: 'PROD_growth_monthly',
    paymentProvider: 'waffo' as const,
    periodStartsAt: '2026-08-03T00:00:00.000Z',
    subscriptionId: 'ORD_legacy_period',
  };
  await subscriptions.upsert({
    anchorAt: legacyWaffoRenewal.periodStartsAt,
    id: legacyWaffoRenewal.subscriptionId,
    interval: 'monthly',
    paidThroughCycle: 1,
    tier: 'growth',
    workspaceId: context.workspaceId,
  });
  await subscriptions.withPaymentEvent(
    {
      createdAt: legacyWaffoRenewal.periodStartsAt,
      paymentEventId: legacyWaffoRenewal.paymentEventId,
      // Older workers used the activation lifecycle in this receipt even
      // when the replaying delivery is a renewal. Both legacy lifecycle
      // hashes must remain compatible for the same Waffo paid period.
      payloadHash: '51a1792dc9b1e0456246ffbf5a23f5c40c26e9863aa1cdb17122b911ccfdcea1',
      workspaceId: context.workspaceId,
    },
    (store) => store.get(legacyWaffoRenewal.subscriptionId),
  );

  const replayed = await service.settlePayment(context, legacyWaffoRenewal);

  assert.equal(replayed?.id, legacyWaffoRenewal.subscriptionId);
  assert.equal(
    (await subscriptions.get(legacyWaffoRenewal.subscriptionId))?.paidThroughCycle,
    1,
  );
  await assert.rejects(
    service.settlePayment(context, {
      ...legacyWaffoRenewal,
      paymentProvider: undefined,
    }),
    /different facts/i,
  );
  await assert.rejects(
    service.settlePayment(context, {
      ...legacyWaffoRenewal,
      paymentProductId: 'PROD_pro_monthly',
    }),
    /different facts/i,
  );
});

test('one paid billing period adds coverage once and resume requires new paid coverage', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-period-initial',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-period',
  });
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'renew',
    paymentEventId: 'payment-period-initial-replay',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-period',
  });
  assert.equal(
    (await subscriptions.get('subscription-period'))?.paidThroughCycle,
    1,
  );
  now = new Date('2026-02-01T00:00:00.000Z');
  for (const paymentEventId of ['payment-period-a', 'payment-period-b']) {
    await service.settlePayment(context, {
      interval: 'month',
      lifecycle: 'renew',
      paymentEventId,
      paymentProductId: 'starter',
      periodStartsAt: now.toISOString(),
      subscriptionId: 'subscription-period',
    });
  }
  assert.equal(
    (await subscriptions.get('subscription-period'))?.paidThroughCycle,
    2,
  );

  now = new Date('2026-03-01T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'past_due',
    paymentEventId: 'payment-period-past-due',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-period',
  });
  await assert.rejects(
    service.settlePayment(context, {
      interval: 'month',
      lifecycle: 'resume',
      paymentEventId: 'payment-period-resume-without-coverage',
      paymentProductId: 'starter',
      subscriptionId: 'subscription-period',
    }),
    /periodStartsAt/i,
  );
  assert.equal(
    (await subscriptions.get('subscription-period'))?.status,
    'past_due',
  );

  now = new Date('2026-03-04T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'resume',
    paymentEventId: 'payment-period-resume',
    paymentProductId: 'starter',
    periodStartsAt: '2026-03-01T00:00:00.000Z',
    subscriptionId: 'subscription-period',
  });
  assert.equal(
    (await subscriptions.get('subscription-period'))?.paidThroughCycle,
    3,
  );
  assert.equal((await subscriptions.get('subscription-period'))?.status, 'active');
});

test('an upgrade with a replacement subscription id clears the old active cycle', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
    planFor(tier) {
      const plan = DEFAULT_CREDIT_PLAN_CATALOG.plans.find(
        (candidate) => candidate.id === tier,
      );
      if (!plan) throw new Error(`Missing ${tier} plan.`);
      return plan;
    },
  });

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-replace-starter',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-old',
  });
  await scheduler.run(now.toISOString());

  now = new Date('2026-01-03T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-replace-growth',
    paymentProductId: 'growth',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-new',
  });
  await scheduler.run(now.toISOString());

  assert.equal((await subscriptions.get('subscription-old'))?.status, 'cancelled');
  assert.equal((await subscriptions.get('subscription-new'))?.status, 'active');
  assert.equal(
    (await subscriptions.listForWorkspace(context.workspaceId)).filter(
      (subscription) => subscription.status !== 'cancelled',
    ).length,
    1,
  );
  assert.equal(
    ledger.listLots(context.workspaceId).find(
      (lot) => lot.grantIdempotencyKey === 'grant:sub:subscription-old:0',
    )?.remainingCredits,
    0,
  );
  assert.equal(
    ledger.listLots(context.workspaceId).find(
      (lot) => lot.grantIdempotencyKey === 'grant:sub:subscription-new:0',
    )?.originalCredits,
    1_300,
  );
});

test('a replacement subscription id keeps a downgrade pending for the next cycle', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-replacement-growth',
    paymentProductId: 'growth',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-growth-old',
  });
  now = new Date('2026-01-15T00:00:00.000Z');
  const replacement = await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-replacement-starter',
    paymentProductId: 'starter',
    periodStartsAt: '2026-02-01T00:00:00.000Z',
    subscriptionId: 'subscription-starter-new',
  });

  assert.equal(replacement, null);
  const persistedReplacement = await subscriptions.get('subscription-starter-new');
  assert.equal(persistedReplacement?.tier, 'growth');
  assert.equal(persistedReplacement?.pendingTier, 'starter');
  assert.equal(persistedReplacement?.pendingEffectiveCycle, 1);
  assert.equal((await subscriptions.get('subscription-growth-old'))?.status, 'cancelled');
  assert.equal(
    (await subscriptions.listForWorkspace(context.workspaceId)).filter(
      (subscription) => subscription.status !== 'cancelled',
    ).length,
    1,
  );
});

test('a replacement subscription id does not regrant the already-paid current cycle', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
    planFor(tier) {
      const plan = DEFAULT_CREDIT_PLAN_CATALOG.plans.find(
        (candidate) => candidate.id === tier,
      );
      if (!plan) throw new Error(`Missing ${tier} plan.`);
      return plan;
    },
  });

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-replacement-grant-growth',
    paymentProductId: 'growth',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-grant-old',
  });
  await scheduler.run(now.toISOString());

  now = new Date('2026-01-15T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-replacement-grant-starter',
    paymentProductId: 'starter',
    periodStartsAt: '2026-02-01T00:00:00.000Z',
    subscriptionId: 'subscription-grant-new',
  });

  assert.deepEqual(await scheduler.run(now.toISOString()), {
    cancelledSubscriptions: 0,
    grantedCycles: 0,
  });
  assert.deepEqual(
    ledger
      .listLots(context.workspaceId)
      .filter((lot) => lot.transactionType === 'SUBSCRIPTION_RENEWAL')
      .map((lot) => [lot.grantIdempotencyKey, lot.originalCredits]),
    [['grant:sub:subscription-grant-old:0', 1_300]],
  );
  assert.equal(
    (await ledger.project(context.workspaceId, now.toISOString())).availableCredits,
    1_300,
  );
});

test('a same-tier replacement subscription id does not regrant the already-paid current cycle', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
    planFor(tier) {
      const plan = DEFAULT_CREDIT_PLAN_CATALOG.plans.find(
        (candidate) => candidate.id === tier,
      );
      if (!plan) throw new Error(`Missing ${tier} plan.`);
      return plan;
    },
  });

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-same-tier-old',
    paymentProductId: 'growth',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-same-tier-old',
  });
  await scheduler.run(now.toISOString());

  now = new Date('2026-01-15T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-same-tier-new',
    paymentProductId: 'growth',
    periodStartsAt: '2026-02-01T00:00:00.000Z',
    subscriptionId: 'subscription-same-tier-new',
  });

  assert.deepEqual(await scheduler.run(now.toISOString()), {
    cancelledSubscriptions: 0,
    grantedCycles: 0,
  });
  assert.deepEqual(
    ledger
      .listLots(context.workspaceId)
      .filter((lot) => lot.transactionType === 'SUBSCRIPTION_RENEWAL')
      .map((lot) => [lot.grantIdempotencyKey, lot.originalCredits]),
    [['grant:sub:subscription-same-tier-old:0', 1_300]],
  );
});

test('a same-tier replacement changes billing interval only on the next paid cycle', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-interval-old',
    paymentProductId: 'growth',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-interval-old',
  });
  now = new Date('2026-01-15T00:00:00.000Z');
  const replacement = await service.settlePayment(context, {
    interval: 'year',
    lifecycle: 'activate',
    paymentEventId: 'payment-interval-new',
    paymentProductId: 'growth',
    periodStartsAt: '2026-02-01T00:00:00.000Z',
    subscriptionId: 'subscription-interval-new',
  });

  assert.equal(replacement, null);
  const persistedReplacement = await subscriptions.get('subscription-interval-new');
  assert.equal(persistedReplacement?.interval, 'monthly');
  assert.equal(persistedReplacement?.pendingInterval, 'yearly');
  assert.equal(persistedReplacement?.pendingEffectiveCycle, 1);
});

test('a renewal must match the subscription tier and interval frozen for its paid cycle', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const subscriptionId = 'subscription-renew-frozen-facts';

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-renew-frozen-activate',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  now = new Date('2026-02-01T00:00:00.000Z');

  await assert.rejects(
    service.settlePayment(context, {
      interval: 'year',
      lifecycle: 'renew',
      paymentEventId: 'payment-renew-frozen-mismatch',
      paymentProductId: 'pro',
      periodStartsAt: now.toISOString(),
      subscriptionId,
    }),
    /does not match the frozen credit subscription/i,
  );
  assert.equal((await subscriptions.get(subscriptionId))?.paidThroughCycle, 1);
});

test('an old paid period replay cannot clear a later past_due state', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const subscriptionId = 'subscription-old-paid-replay';

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-old-paid-activate',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  now = new Date('2026-02-01T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'past_due',
    paymentEventId: 'payment-old-paid-past-due',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'renew',
    paymentEventId: 'payment-old-paid-replay',
    paymentProductId: 'starter',
    periodStartsAt: '2026-01-01T00:00:00.000Z',
    subscriptionId,
  });

  assert.equal((await subscriptions.get(subscriptionId))?.status, 'past_due');
});

test('a terminal event for an already-paid billing period cannot regress active coverage', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const subscriptionId = 'subscription-paid-period-terminal-monotonic';

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-paid-period-activate',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  now = new Date('2026-02-01T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'renew',
    paymentEventId: 'payment-paid-period-renew',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'past_due',
    paymentEventId: 'payment-paid-period-late-terminal',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });

  assert.equal((await subscriptions.get(subscriptionId))?.status, 'active');
});

test('past_due requires an explicit billing period instead of inferring one from checkout state', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const subscriptionId = 'subscription-past-due-period-required';

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-past-due-period-activate',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });

  await assert.rejects(
    service.settlePayment(context, {
      interval: 'month',
      lifecycle: 'past_due',
      paymentEventId: 'payment-past-due-period-missing',
      paymentProductId: 'starter',
      subscriptionId,
    }),
    /periodStartsAt is required/i,
  );
  assert.equal((await subscriptions.get(subscriptionId))?.status, 'active');
});

test('a future renewal does not complete its receipt before it can be retried', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const subscriptionId = 'subscription-future-payment-retry';
  const renewal = {
    interval: 'month' as const,
    lifecycle: 'renew' as const,
    paymentEventId: 'payment-future-payment-retry',
    paymentProductId: 'starter',
    periodStartsAt: '2026-02-01T00:00:00.000Z',
    subscriptionId,
  };

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-future-payment-activate',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  assert.equal(await service.settlePayment(context, renewal), null);
  now = new Date('2026-02-01T00:00:00.000Z');
  await service.settlePayment(context, renewal);

  assert.equal((await subscriptions.get(subscriptionId))?.paidThroughCycle, 2);
});

test('a future same-tier replacement receipt remains retryable at its period start', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const replacement = {
    interval: 'month' as const,
    lifecycle: 'activate' as const,
    paymentEventId: 'payment-future-replacement',
    paymentProductId: 'starter',
    periodStartsAt: '2026-02-01T00:00:00.000Z',
    subscriptionId: 'subscription-future-replacement-new',
  };

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-future-replacement-old',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-future-replacement-old',
  });
  assert.equal(await service.settlePayment(context, replacement), null);

  now = new Date('2026-02-01T00:00:00.000Z');
  await service.settlePayment(context, replacement);

  assert.equal(
    (await subscriptions.get('subscription-future-replacement-new'))
      ?.paidThroughCycle,
    2,
  );
});

test('a future downgrade receipt records its paid coverage when the replacement becomes effective', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const replacement = {
    interval: 'month' as const,
    lifecycle: 'activate' as const,
    paymentEventId: 'payment-future-downgrade',
    paymentProductId: 'starter',
    periodStartsAt: '2026-02-01T00:00:00.000Z',
    subscriptionId: 'subscription-future-downgrade-new',
  };

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-future-downgrade-old',
    paymentProductId: 'growth',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-future-downgrade-old',
  });
  now = new Date('2026-02-01T00:00:00.000Z');
  await service.settlePayment(context, replacement);

  const subscription = await subscriptions.get(replacement.subscriptionId);
  assert.equal(subscription?.paidThroughCycle, 2);
  assert.equal(subscription?.pendingTier, 'starter');
  assert.equal(subscription?.pendingEffectiveCycle, 1);
});

test('a future interval replacement records annual paid coverage when it becomes effective', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const replacement = {
    interval: 'year' as const,
    lifecycle: 'activate' as const,
    paymentEventId: 'payment-future-interval',
    paymentProductId: 'starter-year',
    periodStartsAt: '2026-02-01T00:00:00.000Z',
    subscriptionId: 'subscription-future-interval-new',
  };

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-future-interval-old',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId: 'subscription-future-interval-old',
  });
  now = new Date('2026-02-01T00:00:00.000Z');
  await service.settlePayment(context, replacement);

  const subscription = await subscriptions.get(replacement.subscriptionId);
  assert.equal(subscription?.paidThroughCycle, 13);
  assert.equal(subscription?.pendingInterval, 'yearly');
  assert.equal(subscription?.pendingEffectiveCycle, 1);
});

test('future and old paid periods do not expand or regress current coverage', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const subscriptionId = 'subscription-monotonic-period';

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-monotonic-activate',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  now = new Date('2026-02-01T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'renew',
    paymentEventId: 'payment-monotonic-renew',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  for (const [paymentEventId, periodStartsAt] of [
    ['payment-monotonic-old', '2025-12-01T00:00:00.000Z'],
    ['payment-monotonic-future', '2026-04-01T00:00:00.000Z'],
  ] as const) {
    await service.settlePayment(context, {
      interval: 'month',
      lifecycle: 'renew',
      paymentEventId,
      paymentProductId: 'starter',
      periodStartsAt,
      subscriptionId,
    });
  }
  assert.equal((await subscriptions.get(subscriptionId))?.paidThroughCycle, 2);

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'past_due',
    paymentEventId: 'payment-monotonic-old-failure',
    paymentProductId: 'starter',
    periodStartsAt: '2026-01-01T00:00:00.000Z',
    subscriptionId,
  });
  const staleExpire = await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'expire',
    paymentEventId: 'payment-monotonic-old-expire',
    paymentProductId: 'starter',
    periodStartsAt: '2026-01-01T00:00:00.000Z',
    subscriptionId,
  });
  assert.equal(staleExpire?.settlementStatus, 'ignored_stale');
  assert.equal((await subscriptions.get(subscriptionId))?.status, 'active');
});

test('out-of-order paid periods fill the missing coverage cycle without minting a gap', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const subscriptionId = 'subscription-out-of-order-periods';

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-out-of-order-activate',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  now = new Date('2026-03-01T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'renew',
    paymentEventId: 'payment-out-of-order-march',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  assert.equal((await subscriptions.get(subscriptionId))?.paidThroughCycle, 1);

  now = new Date('2026-03-02T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'renew',
    paymentEventId: 'payment-out-of-order-february',
    paymentProductId: 'starter',
    periodStartsAt: '2026-02-01T00:00:00.000Z',
    subscriptionId,
  });

  assert.equal((await subscriptions.get(subscriptionId))?.paidThroughCycle, 3);
});

test('out-of-order terminal events remain retryable after subscription activation', async () => {
  for (const lifecycle of [
    'past_due',
    'cancel_at_period_end',
    'expire',
  ] as const) {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const ledger = new MemoryCreditLedger();
    const subscriptions = new MemoryCreditSubscriptionStore();
    const service = creditBillingService(ledger, subscriptions, () => now);
    const subscriptionId = `subscription-out-of-order-${lifecycle}`;
    const terminalEvent = {
      interval: 'month' as const,
      lifecycle,
      paymentEventId: `payment-out-of-order-${lifecycle}`,
      paymentProductId: 'starter',
      ...(lifecycle === 'past_due'
        ? { periodStartsAt: '2026-02-01T00:00:00.000Z' }
        : {}),
      subscriptionId,
    };

    await assert.rejects(
      service.settlePayment(context, terminalEvent),
      /before activation|not found/i,
    );
    await service.settlePayment(context, {
      interval: 'month',
      lifecycle: 'activate',
      paymentEventId: `payment-activate-${lifecycle}`,
      paymentProductId: 'starter',
      periodStartsAt: now.toISOString(),
      subscriptionId,
    });
    await service.settlePayment(context, terminalEvent);

    const subscription = await subscriptions.get(subscriptionId);
    if (lifecycle === 'past_due') {
      assert.equal(subscription?.status, 'past_due');
    } else if (lifecycle === 'expire') {
      assert.equal(subscription?.status, 'cancelled');
    } else {
      assert.equal(subscription?.pendingEffectiveCycle, 1);
    }
  }
});

test('a grace-window resume that leaves an earlier unpaid cycle still clears past_due', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const subscriptionId = 'subscription-resume-coverage-gap';

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-resume-gap-activate',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  now = new Date('2026-02-01T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'renew',
    paymentEventId: 'payment-resume-gap-renew',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  assert.equal((await subscriptions.get(subscriptionId))?.paidThroughCycle, 2);
  const grantsAfterRenew = ledger.listLots(context.workspaceId).length;

  now = new Date('2026-03-05T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'past_due',
    paymentEventId: 'payment-resume-gap-past-due',
    paymentProductId: 'starter',
    periodStartsAt: '2026-03-01T00:00:00.000Z',
    subscriptionId,
  });
  assert.equal((await subscriptions.get(subscriptionId))?.status, 'past_due');

  // The merchant pays April while March stays unpaid, so contiguous coverage
  // cannot advance past cycle 2 — but the subscription is paid, not delinquent.
  now = new Date('2026-04-02T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'resume',
    paymentEventId: 'payment-resume-gap-catch-up',
    paymentProductId: 'starter',
    periodStartsAt: '2026-04-01T00:00:00.000Z',
    subscriptionId,
  });

  const resumed = await subscriptions.get(subscriptionId);
  assert.equal(resumed?.status, 'active');
  assert.equal(resumed?.pastDueAt, null);
  assert.equal(resumed?.paidThroughCycle, 2);
  assert.equal(ledger.listLots(context.workspaceId).length, grantsAfterRenew);
});

test('a resumed subscription with a coverage gap survives the grace-period sweeper', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
    planFor(tier) {
      const plan = DEFAULT_CREDIT_PLAN_CATALOG.plans.find(
        (candidate) => candidate.id === tier,
      );
      if (!plan) throw new Error(`Missing ${tier} plan.`);
      return plan;
    },
  });
  const subscriptionId = 'subscription-resume-gap-sweeper';

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-sweeper-activate',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  now = new Date('2026-03-05T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'past_due',
    paymentEventId: 'payment-sweeper-past-due',
    paymentProductId: 'starter',
    periodStartsAt: '2026-03-01T00:00:00.000Z',
    subscriptionId,
  });
  now = new Date('2026-04-02T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'resume',
    paymentEventId: 'payment-sweeper-catch-up',
    paymentProductId: 'starter',
    periodStartsAt: '2026-04-01T00:00:00.000Z',
    subscriptionId,
  });

  await scheduler.run('2026-04-20T00:00:00.000Z');

  assert.notEqual(
    (await subscriptions.get(subscriptionId))?.status,
    'cancelled',
  );
});

test('a resume for a future billing period leaves past_due untouched', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  const subscriptionId = 'subscription-resume-future-period';

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-resume-future-activate',
    paymentProductId: 'starter',
    periodStartsAt: now.toISOString(),
    subscriptionId,
  });
  now = new Date('2026-02-05T00:00:00.000Z');
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'past_due',
    paymentEventId: 'payment-resume-future-past-due',
    paymentProductId: 'starter',
    periodStartsAt: '2026-02-01T00:00:00.000Z',
    subscriptionId,
  });
  assert.equal((await subscriptions.get(subscriptionId))?.status, 'past_due');

  // A deferred future period is parked, not settled: it must not clear past_due.
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'resume',
    paymentEventId: 'payment-resume-future-catch-up',
    paymentProductId: 'starter',
    periodStartsAt: '2026-06-01T00:00:00.000Z',
    subscriptionId,
  });

  assert.equal((await subscriptions.get(subscriptionId))?.status, 'past_due');
});

test('credit detail reads transactions before lots to avoid a grant-read race', async () => {
  const reads: string[] = [];
  const ledger: CreditBillingLedgerPort = {
    expireSubscriptionLots() {},
    grant() {
      throw new Error('not used');
    },
    listLots() {
      reads.push('lots');
      return [];
    },
    listTransactions() {
      reads.push('transactions');
      return [];
    },
    project() {
      return {
        availableCredits: 0,
        expiredCredits: 0,
        grantedCredits: 0,
        refundedCredits: 0,
        usedCredits: 0,
      };
    },
  };
  const service = new CreditBillingService(
    ledger,
    new MemoryCreditSubscriptionStore(),
    { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
    { async getPaymentMapping() { return null; } },
    () => new Date('2026-08-01T00:00:00.000Z'),
  );

  assert.deepEqual(await service.detail(context.workspaceId), {
    billing: null,
    lots: [],
    transactions: [],
  });
  assert.deepEqual(reads, ['transactions', 'lots']);
});

test('credit detail keeps immutable paid coverage while the scheduler grant is pending', async () => {
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  let catalog = structuredClone(DEFAULT_CREDIT_PLAN_CATALOG);
  const service = new CreditBillingService(
    ledger,
    subscriptions,
    { async get() { return structuredClone(catalog); } },
    {
      async getPaymentMapping() {
        return {
          mappings: [
            {
              interval: 'month' as const,
              paymentProductId: 'starter',
              tier: 'starter' as const,
            },
          ],
        };
      },
    },
    () => new Date('2026-08-01T00:00:00.000Z'),
  );

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'activate',
    paymentEventId: 'payment-awaiting-credit-grant',
    paymentProductId: 'starter',
    periodStartsAt: '2026-08-01T00:00:00.000Z',
    subscriptionId: 'subscription-awaiting-credit-grant',
  });
  catalog = {
    ...catalog,
    plans: catalog.plans.map((plan) =>
      plan.id === 'starter' ? { ...plan, credits: 9_999 } : plan,
    ),
  };

  assert.deepEqual(await service.detail(context.workspaceId), {
    billing: {
      creditsThisPeriod: 500,
      interval: 'monthly',
      periodEndsAt: '2026-09-01T00:00:00.000Z',
      tier: 'starter',
    },
    lots: [],
    transactions: [],
  });
  const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
    planFor(tier) {
      const plan = catalog.plans.find((candidate) => candidate.id === tier);
      if (!plan) throw new Error(`Missing ${tier} plan.`);
      return plan;
    },
  });
  await scheduler.run('2026-08-01T00:00:00.000Z');
  assert.equal(
    ledger
      .listLots(context.workspaceId)
      .find(
        (lot) =>
          lot.grantIdempotencyKey ===
          'grant:sub:subscription-awaiting-credit-grant:0',
      )?.originalCredits,
    500,
  );
});

test('credit detail keeps an add-on and expired prior grant while a scheduled upgrade is current', async () => {
  const now = new Date('2026-09-05T00:00:00.000Z');
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const service = creditBillingService(ledger, subscriptions, () => now);
  await subscriptions.upsert({
    anchorAt: '2026-08-01T00:00:00.000Z',
    id: 'subscription-detail-schedule',
    interval: 'monthly',
    paidThroughCycle: 2,
    scheduledChanges: [
      { effectiveCycle: 1, interval: 'monthly', tier: 'growth' },
      { effectiveCycle: 2, interval: 'monthly', tier: 'starter' },
    ],
    tier: 'starter',
    workspaceId: context.workspaceId,
  });
  ledger.grant({
    createdAt: '2026-08-01T00:00:00.000Z',
    credits: 500,
    expirationDate: '2026-09-01T00:00:00.000Z',
    grantIdempotencyKey: 'grant:sub:subscription-detail-schedule:0',
    id: 'subscription-detail-0',
    transactionType: 'SUBSCRIPTION_RENEWAL',
    workspaceId: context.workspaceId,
  });
  ledger.grant({
    createdAt: '2026-08-15T00:00:00.000Z',
    credits: 100,
    expirationDate: '2026-12-01T00:00:00.000Z',
    id: 'package-detail-survives',
    transactionType: 'PURCHASE_PACKAGE',
    workspaceId: context.workspaceId,
  });
  ledger.grant({
    createdAt: '2026-09-01T00:00:00.000Z',
    credits: 1_300,
    expirationDate: '2026-10-01T00:00:00.000Z',
    grantIdempotencyKey: 'grant:sub:subscription-detail-schedule:1',
    id: 'subscription-detail-1',
    transactionType: 'SUBSCRIPTION_RENEWAL',
    workspaceId: context.workspaceId,
  });
  ledger.expireLots({
    actorId: 'system',
    correlationId: 'internal',
    now: '2026-09-01T00:00:00.000Z',
    workspaceId: context.workspaceId,
  });

  const detail = await service.detail(context.workspaceId);

  assert.deepEqual(detail.billing, {
    creditsThisPeriod: 1_300,
    interval: 'monthly',
    periodEndsAt: '2026-10-01T00:00:00.000Z',
    tier: 'growth',
  });
  assert.equal(detail.lots.length, 3);
  assert.ok(
    detail.lots.some(
      (lot) =>
        lot.transactionType === 'PURCHASE_PACKAGE' &&
        lot.remainingCredits === 100,
    ),
  );
  assert.ok(
    detail.transactions.some((transaction) => transaction.transactionType === 'EXPIRE'),
  );
});

function creditBillingService(
  ledger: MemoryCreditLedger,
  subscriptions: MemoryCreditSubscriptionStore,
  clock: () => Date,
) {
  return new CreditBillingService(
    ledger,
    subscriptions,
    { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
    {
      async getPaymentMapping() {
        return {
          mappings: [
            { interval: 'month' as const, paymentProductId: 'starter', tier: 'starter' as const },
            { interval: 'year' as const, paymentProductId: 'starter-year', tier: 'starter' as const },
            { interval: 'month' as const, paymentProductId: 'growth', tier: 'growth' as const },
            { interval: 'year' as const, paymentProductId: 'pro', tier: 'pro' as const },
            ...WAFFO_TEST_MAPPINGS,
          ],
        };
      },
    },
    clock,
  );
}

const WAFFO_TEST_MAPPINGS = [
  { interval: 'single_month' as const, paymentProductId: 'PROD_starter_single_month', tier: 'starter' as const },
  { interval: 'monthly' as const, paymentProductId: 'PROD_starter_monthly', tier: 'starter' as const },
  { interval: 'yearly' as const, paymentProductId: 'PROD_starter_yearly', tier: 'starter' as const },
  { interval: 'single_month' as const, paymentProductId: 'PROD_growth_single_month', tier: 'growth' as const },
  { interval: 'monthly' as const, paymentProductId: 'PROD_growth_monthly', tier: 'growth' as const },
  { interval: 'yearly' as const, paymentProductId: 'PROD_growth_yearly', tier: 'growth' as const },
  { interval: 'single_month' as const, paymentProductId: 'PROD_pro_single_month', tier: 'pro' as const },
  { interval: 'monthly' as const, paymentProductId: 'PROD_pro_monthly', tier: 'pro' as const },
  { interval: 'yearly' as const, paymentProductId: 'PROD_pro_yearly', tier: 'pro' as const },
];
