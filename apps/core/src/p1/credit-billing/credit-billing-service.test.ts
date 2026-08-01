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

test('one paid billing period adds coverage once and resume adds no cycle', async () => {
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

  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'past_due',
    paymentEventId: 'payment-period-past-due',
    paymentProductId: 'starter',
    subscriptionId: 'subscription-period',
  });
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'resume',
    paymentEventId: 'payment-period-resume',
    paymentProductId: 'starter',
    subscriptionId: 'subscription-period',
  });
  assert.equal(
    (await subscriptions.get('subscription-period'))?.paidThroughCycle,
    2,
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

  assert.equal(replacement?.id, 'subscription-starter-new');
  assert.equal(replacement?.tier, 'growth');
  assert.equal(replacement?.pendingTier, 'starter');
  assert.equal(replacement?.pendingEffectiveCycle, 1);
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

  assert.equal(replacement?.interval, 'monthly');
  assert.equal(replacement?.pendingInterval, 'yearly');
  assert.equal(replacement?.pendingEffectiveCycle, 1);
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
  await service.settlePayment(context, {
    interval: 'month',
    lifecycle: 'expire',
    paymentEventId: 'payment-monotonic-old-expire',
    paymentProductId: 'starter',
    periodStartsAt: '2026-01-01T00:00:00.000Z',
    subscriptionId,
  });
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
            { interval: 'month' as const, paymentProductId: 'growth', tier: 'growth' as const },
            { interval: 'year' as const, paymentProductId: 'pro', tier: 'pro' as const },
          ],
        };
      },
    },
    clock,
  );
}
