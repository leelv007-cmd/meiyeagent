import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { CreditBillingService } from './credit-billing-service.js';
import { MemoryCreditLedger } from './credit-ledger.js';
import { DEFAULT_CREDIT_PLAN_CATALOG } from './credit-plan-catalog.js';
import { PostgresCreditLedger } from './postgres-credit-ledger.js';
import {
  CreditSubscriptionCycleScheduler,
  PostgresCreditSubscriptionStore,
  type CreditSubscriptionStore,
} from './credit-subscription-scheduler.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres credit subscription state cold-starts and persists past_due recovery',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const schema = `credit_subscription_${randomUUID().replaceAll('-', '')}`;
    const pool = new Pool({
      connectionString,
      options: `-c search_path=${schema},public`,
    });
    const workspaceId = `credit-subscription-workspace-${randomUUID()}`;
    const subscriptionId = `credit-subscription-${randomUUID()}`;
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      await pool.query(`
        CREATE TABLE workspaces (
          id text PRIMARY KEY,
          name text NOT NULL
        )
      `);
      const store = new PostgresCreditSubscriptionStore(pool);
      const client = await pool.connect();
      try {
        await store.migrate(client);
      } finally {
        client.release();
      }
      await pool.query(
        "INSERT INTO workspaces (id, name) VALUES ($1, 'Credit subscription test')",
        [workspaceId],
      );

      await store.upsert({
        anchorAt: '2026-01-01T00:00:00.000Z',
        id: subscriptionId,
        interval: 'yearly',
        paidThroughCycle: 12,
        tier: 'pro',
        workspaceId,
      });
      await store.markPastDue(subscriptionId, '2026-02-01T00:00:00.000Z');
      assert.equal((await store.get(subscriptionId))?.status, 'past_due');

      const resumed = await store.recordPaidCoverage(
        subscriptionId,
        13,
        '2026-02-04T00:00:00.000Z',
      );
      assert.equal(resumed.status, 'active');
      assert.equal(resumed.paidThroughCycle, 13);
      assert.equal(resumed.pastDueAt, null);

      let settlementCalls = 0;
      const paymentEvent = {
        workspaceId,
        paymentEventId: 'payment-renew-once',
        payloadHash: 'a'.repeat(64),
        createdAt: '2026-02-04T00:00:00.000Z',
      };
      const settle = (subscriptions: CreditSubscriptionStore) => {
        settlementCalls += 1;
        return subscriptions.recordPaidCoverage(
          subscriptionId,
          14,
          '2026-02-04T00:00:00.000Z',
        );
      };
      await store.withPaymentEvent(paymentEvent, settle);
      await store.withPaymentEvent(paymentEvent, settle);
      assert.equal(settlementCalls, 1);
      assert.equal((await store.get(subscriptionId))?.paidThroughCycle, 14);
      await assert.rejects(
        store.withPaymentEvent(
          { ...paymentEvent, payloadHash: 'b'.repeat(64) },
          settle,
        ),
        /different facts/i,
      );

      for (const [paymentEventId, payloadHash] of [
        ['payment-same-period-a', 'c'.repeat(64)],
        ['payment-same-period-b', 'd'.repeat(64)],
      ] as const) {
        await store.withPaymentEvent(
          {
            workspaceId,
            paymentEventId,
            payloadHash,
            createdAt: '2026-03-01T00:00:00.000Z',
          },
          (subscriptions) =>
            subscriptions.recordPaidPeriod({
              subscriptionId,
              periodStartsAt: '2026-03-01T00:00:00.000Z',
              coverageCycles: 1,
              at: '2026-03-01T00:00:00.000Z',
            }),
        );
      }
      assert.equal((await store.get(subscriptionId))?.paidThroughCycle, 14);

      await assert.rejects(
        store.upsert({
          anchorAt: '2026-03-01T00:00:00.000Z',
          id: `${subscriptionId}-second`,
          interval: 'monthly',
          paidThroughCycle: 1,
          tier: 'starter',
          workspaceId,
        }),
        /one_active_per_workspace|unique/i,
      );

      const foreignWorkspaceId = `${workspaceId}-foreign`;
      await pool.query(
        "INSERT INTO workspaces (id, name) VALUES ($1, 'Foreign workspace')",
        [foreignWorkspaceId],
      );
      await assert.rejects(
        store.upsert({
          anchorAt: '2026-01-01T00:00:00.000Z',
          id: subscriptionId,
          interval: 'yearly',
          paidThroughCycle: 12,
          tier: 'pro',
          workspaceId: foreignWorkspaceId,
        }),
        /different workspace/i,
      );
      assert.equal((await store.get(subscriptionId))?.workspaceId, workspaceId);

      await store.markPastDue(subscriptionId, '2026-03-01T00:00:00.000Z');
      const cancelled = await store.cancelPastDue(
        subscriptionId,
        '2026-03-08T00:00:00.000Z',
      );
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.pastDueAt, null);
      await assert.rejects(
        store.recordPaidCoverage(subscriptionId, 16, '2026-03-08T00:00:00.000Z'),
        /cancelled/i,
      );
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  'Postgres credit payment periods stay monotonic across replacements and annual replay',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const schema = `credit_period_${randomUUID().replaceAll('-', '')}`;
    const pool = new Pool({
      connectionString,
      options: `-c search_path=${schema},public`,
    });
    let now = new Date('2026-01-01T00:00:00.000Z');
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      await pool.query('CREATE TABLE workspaces (id text PRIMARY KEY, name text NOT NULL)');
      const store = new PostgresCreditSubscriptionStore(pool);
      const client = await pool.connect();
      try {
        await store.migrate(client);
      } finally {
        client.release();
      }
      for (const workspaceId of [
        'workspace-period-pg',
        'workspace-annual-pg',
        'workspace-period-gap-pg',
        'workspace-resume-gap-pg',
        'workspace-state-machine-pg',
        'workspace-future-retry-pg',
        'workspace-terminal-monotonic-pg',
      ]) {
        await pool.query(
          "INSERT INTO workspaces (id, name) VALUES ($1, 'Credit period test')",
          [workspaceId],
        );
      }
      const serviceFor = (workspaceId: string) => ({
        context: {
          correlationId: `period-${workspaceId}`,
          userId: 'owner-pg',
          workspaceId,
        },
        service: new CreditBillingService(
          new MemoryCreditLedger(),
          store,
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
          () => now,
        ),
      });
      const monthly = serviceFor('workspace-period-pg');
      await monthly.service.settlePayment(monthly.context, {
        interval: 'month',
        lifecycle: 'activate',
        paymentEventId: 'pg-period-activate',
        paymentProductId: 'growth',
        periodStartsAt: now.toISOString(),
        subscriptionId: 'pg-subscription-old',
      });
      await monthly.service.settlePayment(monthly.context, {
        interval: 'month',
        lifecycle: 'renew',
        paymentEventId: 'pg-period-same',
        paymentProductId: 'growth',
        periodStartsAt: now.toISOString(),
        subscriptionId: 'pg-subscription-old',
      });
      now = new Date('2026-02-01T00:00:00.000Z');
      for (const [paymentEventId, periodStartsAt] of [
        ['pg-period-future', '2026-04-01T00:00:00.000Z'],
        ['pg-period-current', '2026-02-01T00:00:00.000Z'],
        ['pg-period-old', '2025-12-01T00:00:00.000Z'],
      ] as const) {
        await monthly.service.settlePayment(monthly.context, {
          interval: 'month',
          lifecycle: 'renew',
          paymentEventId,
          paymentProductId: 'growth',
          periodStartsAt,
          subscriptionId: 'pg-subscription-old',
        });
      }
      assert.equal((await store.get('pg-subscription-old'))?.paidThroughCycle, 2);
      await monthly.service.settlePayment(monthly.context, {
        interval: 'month',
        lifecycle: 'past_due',
        paymentEventId: 'pg-period-old-terminal',
        paymentProductId: 'growth',
        periodStartsAt: '2026-01-01T00:00:00.000Z',
        subscriptionId: 'pg-subscription-old',
      });
      assert.equal((await store.get('pg-subscription-old'))?.status, 'active');
      const replacement = {
        interval: 'month' as const,
        lifecycle: 'activate' as const,
        paymentEventId: 'pg-period-replacement',
        paymentProductId: 'starter',
        periodStartsAt: '2026-03-01T00:00:00.000Z',
        subscriptionId: 'pg-subscription-new',
      };
      assert.equal(
        await monthly.service.settlePayment(monthly.context, replacement),
        null,
      );
      assert.equal((await store.get('pg-subscription-new')), null);
      now = new Date('2026-03-01T00:00:00.000Z');
      const replayedReplacement = await monthly.service.settlePayment(
        monthly.context,
        replacement,
      );
      assert.equal(replayedReplacement?.pendingTier, 'starter');
      assert.equal(replayedReplacement?.pendingEffectiveCycle, 2);
      assert.equal((await store.get('pg-subscription-old'))?.status, 'cancelled');

      const annual = serviceFor('workspace-annual-pg');
      now = new Date('2026-01-01T00:00:00.000Z');
      await annual.service.settlePayment(annual.context, {
        interval: 'year',
        lifecycle: 'activate',
        paymentEventId: 'pg-annual-activate',
        paymentProductId: 'pro',
        periodStartsAt: now.toISOString(),
        subscriptionId: 'pg-subscription-annual',
      });
      await annual.service.settlePayment(annual.context, {
        interval: 'year',
        lifecycle: 'renew',
        paymentEventId: 'pg-annual-same-period',
        paymentProductId: 'pro',
        periodStartsAt: now.toISOString(),
        subscriptionId: 'pg-subscription-annual',
      });
      assert.equal((await store.get('pg-subscription-annual'))?.paidThroughCycle, 12);

      await store.upsert({
        anchorAt: '2026-01-01T00:00:00.000Z',
        id: 'pg-subscription-period-gap',
        interval: 'monthly',
        paidThroughCycle: 1,
        tier: 'starter',
        workspaceId: 'workspace-period-gap-pg',
      });
      await store.recordInitialPaidPeriod({
        subscriptionId: 'pg-subscription-period-gap',
        periodStartsAt: '2026-01-01T00:00:00.000Z',
        coverageCycles: 1,
        at: '2026-01-01T00:00:00.000Z',
      });
      await store.recordPaidPeriod({
        subscriptionId: 'pg-subscription-period-gap',
        periodStartsAt: '2026-03-01T00:00:00.000Z',
        coverageCycles: 1,
        at: '2026-03-01T00:00:00.000Z',
      });
      assert.equal(
        (await store.get('pg-subscription-period-gap'))?.paidThroughCycle,
        1,
      );
      await store.recordPaidPeriod({
        subscriptionId: 'pg-subscription-period-gap',
        periodStartsAt: '2026-02-01T00:00:00.000Z',
        coverageCycles: 1,
        at: '2026-03-02T00:00:00.000Z',
      });
      assert.equal(
        (await store.get('pg-subscription-period-gap'))?.paidThroughCycle,
        3,
      );

      const gapResume = serviceFor('workspace-resume-gap-pg');
      now = new Date('2026-01-01T00:00:00.000Z');
      await gapResume.service.settlePayment(gapResume.context, {
        interval: 'month',
        lifecycle: 'activate',
        paymentEventId: 'pg-resume-gap-activate',
        paymentProductId: 'starter',
        periodStartsAt: now.toISOString(),
        subscriptionId: 'pg-subscription-resume-gap',
      });
      now = new Date('2026-03-05T00:00:00.000Z');
      await gapResume.service.settlePayment(gapResume.context, {
        interval: 'month',
        lifecycle: 'past_due',
        paymentEventId: 'pg-resume-gap-past-due',
        paymentProductId: 'starter',
        periodStartsAt: '2026-03-01T00:00:00.000Z',
        subscriptionId: 'pg-subscription-resume-gap',
      });
      assert.equal(
        (await store.get('pg-subscription-resume-gap'))?.status,
        'past_due',
      );
      // April settles while March stays unpaid: contiguous coverage cannot
      // advance, but the subscription is paid and must leave past_due.
      now = new Date('2026-04-02T00:00:00.000Z');
      await gapResume.service.settlePayment(gapResume.context, {
        interval: 'month',
        lifecycle: 'resume',
        paymentEventId: 'pg-resume-gap-catch-up',
        paymentProductId: 'starter',
        periodStartsAt: '2026-04-01T00:00:00.000Z',
        subscriptionId: 'pg-subscription-resume-gap',
      });
      const pgResumed = await store.get('pg-subscription-resume-gap');
      assert.equal(pgResumed?.status, 'active');
      assert.equal(pgResumed?.pastDueAt, null);
      assert.equal(pgResumed?.paidThroughCycle, 1);

      now = new Date('2026-01-01T00:00:00.000Z');
      const stateMachine = serviceFor('workspace-state-machine-pg');
      await stateMachine.service.settlePayment(stateMachine.context, {
        interval: 'month',
        lifecycle: 'activate',
        paymentEventId: 'pg-state-machine-activate',
        paymentProductId: 'growth',
        periodStartsAt: now.toISOString(),
        subscriptionId: 'pg-state-machine-old',
      });
      now = new Date('2026-01-15T00:00:00.000Z');
      const intervalReplacement = {
        interval: 'year' as const,
        lifecycle: 'activate' as const,
        paymentEventId: 'pg-state-machine-interval-replacement',
        paymentProductId: 'growth',
        periodStartsAt: '2026-02-01T00:00:00.000Z',
        subscriptionId: 'pg-state-machine-new',
      };
      assert.equal(
        await stateMachine.service.settlePayment(
          stateMachine.context,
          intervalReplacement,
        ),
        null,
      );
      assert.equal((await store.get(intervalReplacement.subscriptionId)), null);
      now = new Date('2026-02-01T00:00:00.000Z');
      await stateMachine.service.settlePayment(
        stateMachine.context,
        intervalReplacement,
      );
      assert.equal(
        (await store.get(intervalReplacement.subscriptionId))?.pendingInterval,
        'yearly',
      );
      await stateMachine.service.settlePayment(stateMachine.context, {
        interval: 'year',
        lifecycle: 'renew',
        paymentEventId: 'pg-state-machine-yearly-renewal',
        paymentProductId: 'growth',
        periodStartsAt: now.toISOString(),
        subscriptionId: intervalReplacement.subscriptionId,
      });
      assert.equal(
        (await store.get('pg-state-machine-new'))?.paidThroughCycle,
        13,
      );
      await store.scheduleChange({
        subscriptionId: 'pg-state-machine-new',
        tier: 'starter',
        interval: 'monthly',
        effectiveCycle: 14,
        at: now.toISOString(),
      });
      await store.scheduleChange({
        subscriptionId: 'pg-state-machine-new',
        tier: 'pro',
        interval: 'yearly',
        effectiveCycle: 15,
        at: now.toISOString(),
      });
      assert.deepEqual(
        (await store.get('pg-state-machine-new'))?.scheduledChanges.map(
          (change) => [change.tier, change.interval, change.effectiveCycle],
        ),
        [
          ['growth', 'yearly', 1],
          ['starter', 'monthly', 14],
          ['pro', 'yearly', 15],
        ],
      );
      await assert.rejects(
        stateMachine.service.settlePayment(stateMachine.context, {
          interval: 'year',
          lifecycle: 'renew',
          paymentEventId: 'pg-state-machine-mismatched-renewal',
          paymentProductId: 'pro',
          periodStartsAt: now.toISOString(),
          subscriptionId: 'pg-state-machine-new',
        }),
        /does not match the frozen credit subscription/i,
      );

      now = new Date('2026-01-01T00:00:00.000Z');
      const futureRetry = serviceFor('workspace-future-retry-pg');
      const futureRenewal = {
        interval: 'month' as const,
        lifecycle: 'renew' as const,
        paymentEventId: 'pg-future-retry-renewal',
        paymentProductId: 'starter',
        periodStartsAt: '2026-02-01T00:00:00.000Z',
        subscriptionId: 'pg-future-retry',
      };
      await futureRetry.service.settlePayment(futureRetry.context, {
        interval: 'month',
        lifecycle: 'activate',
        paymentEventId: 'pg-future-retry-activate',
        paymentProductId: 'starter',
        periodStartsAt: now.toISOString(),
        subscriptionId: futureRenewal.subscriptionId,
      });
      assert.equal(
        await futureRetry.service.settlePayment(
          futureRetry.context,
          futureRenewal,
        ),
        null,
      );
      now = new Date('2026-02-01T00:00:00.000Z');
      await futureRetry.service.settlePayment(futureRetry.context, futureRenewal);
      assert.equal(
        (await store.get(futureRenewal.subscriptionId))?.paidThroughCycle,
        2,
      );

      now = new Date('2026-01-01T00:00:00.000Z');
      const terminalMonotonic = serviceFor('workspace-terminal-monotonic-pg');
      const terminalSubscriptionId = 'pg-terminal-monotonic';
      await terminalMonotonic.service.settlePayment(terminalMonotonic.context, {
        interval: 'month',
        lifecycle: 'activate',
        paymentEventId: 'pg-terminal-monotonic-activate',
        paymentProductId: 'growth',
        periodStartsAt: now.toISOString(),
        subscriptionId: terminalSubscriptionId,
      });
      now = new Date('2026-02-01T00:00:00.000Z');
      await terminalMonotonic.service.settlePayment(terminalMonotonic.context, {
        interval: 'month',
        lifecycle: 'renew',
        paymentEventId: 'pg-terminal-monotonic-renew',
        paymentProductId: 'growth',
        periodStartsAt: now.toISOString(),
        subscriptionId: terminalSubscriptionId,
      });
      for (const lifecycle of [
        'past_due',
        'cancel_at_period_end',
        'expire',
      ] as const) {
        await terminalMonotonic.service.settlePayment(terminalMonotonic.context, {
          interval: 'month',
          lifecycle,
          paymentEventId: `pg-terminal-monotonic-${lifecycle}`,
          paymentProductId: 'growth',
          periodStartsAt: now.toISOString(),
          subscriptionId: terminalSubscriptionId,
        });
        const subscription = await store.get(terminalSubscriptionId);
        assert.equal(subscription?.status, 'active');
        assert.deepEqual(subscription?.scheduledChanges, []);
      }
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  'Postgres replacement ids preserve the current cycle grant lineage under replay',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const schema = `credit_grant_lineage_${randomUUID().replaceAll('-', '')}`;
    const pool = new Pool({
      connectionString,
      options: `-c search_path=${schema},public`,
    });
    let now = new Date('2026-01-01T00:00:00.000Z');
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      await pool.query('CREATE TABLE workspaces (id text PRIMARY KEY, name text NOT NULL)');
      const subscriptions = new PostgresCreditSubscriptionStore(pool);
      const ledger = new PostgresCreditLedger(pool);
      const client = await pool.connect();
      try {
        await subscriptions.migrate(client);
        await ledger.migrate(client);
      } finally {
        client.release();
      }
      const scheduler = new CreditSubscriptionCycleScheduler(
        subscriptions,
        ledger,
        {
          planFor(tier) {
            const plan = DEFAULT_CREDIT_PLAN_CATALOG.plans.find(
              (candidate) => candidate.id === tier,
            );
            if (!plan) throw new Error(`Missing ${tier} plan.`);
            return plan;
          },
        },
      );

      for (const replacement of [
        { label: 'same-tier', paymentProductId: 'growth' },
        { label: 'downgrade', paymentProductId: 'starter' },
      ] as const) {
        const workspaceId = `workspace-grant-lineage-${replacement.label}`;
        const context = {
          correlationId: `credit-grant-lineage-${replacement.label}`,
          userId: 'owner-pg',
          workspaceId,
        };
        await pool.query(
          "INSERT INTO workspaces (id, name) VALUES ($1, 'Credit grant lineage test')",
          [workspaceId],
        );
        const service = new CreditBillingService(
          ledger,
          subscriptions,
          { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
          {
            async getPaymentMapping() {
              return {
                mappings: [
                  { interval: 'month' as const, paymentProductId: 'starter', tier: 'starter' as const },
                  { interval: 'month' as const, paymentProductId: 'growth', tier: 'growth' as const },
                ],
              };
            },
          },
          () => now,
        );
        const oldId = `subscription-grant-lineage-${replacement.label}-old`;
        const newId = `subscription-grant-lineage-${replacement.label}-new`;
        await service.settlePayment(context, {
          interval: 'month',
          lifecycle: 'activate',
          paymentEventId: `payment-grant-lineage-${replacement.label}-old`,
          paymentProductId: 'growth',
          periodStartsAt: now.toISOString(),
          subscriptionId: oldId,
        });
        assert.equal((await scheduler.run(now.toISOString())).grantedCycles, 1);

        now = new Date('2026-01-15T00:00:00.000Z');
        const replacementInput = {
          interval: 'month' as const,
          lifecycle: 'activate' as const,
          paymentEventId: `payment-grant-lineage-${replacement.label}-new`,
          paymentProductId: replacement.paymentProductId,
          periodStartsAt: '2026-02-01T00:00:00.000Z',
          subscriptionId: newId,
        };
        assert.equal(
          await service.settlePayment(context, replacementInput),
          null,
        );

        const replayed = await Promise.all([
          scheduler.run(now.toISOString()),
          scheduler.run(now.toISOString()),
          scheduler.run(now.toISOString()),
        ]);
        assert.equal(
          replayed.reduce((total, result) => total + result.grantedCycles, 0),
          0,
        );
        const lots = await ledger.listLots(workspaceId);
        assert.deepEqual(
          lots
            .filter((lot) => lot.transactionType === 'SUBSCRIPTION_RENEWAL')
            .map((lot) => [lot.grantIdempotencyKey, lot.originalCredits]),
          [[`grant:sub:${oldId}:0`, 1_300]],
        );
        assert.equal(
          (await ledger.project(workspaceId, now.toISOString())).availableCredits,
          1_300,
        );
        now = new Date('2026-02-01T00:00:00.000Z');
        await service.settlePayment(context, replacementInput);
        assert.equal((await subscriptions.get(newId))?.grantLineageId, oldId);
        now = new Date('2026-01-01T00:00:00.000Z');
      }
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
      await pool.end();
    }
  },
);
