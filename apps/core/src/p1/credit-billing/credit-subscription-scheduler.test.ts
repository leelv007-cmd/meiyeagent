import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemoryCreditLedger } from './credit-ledger.js';
import {
  CREDIT_SUBSCRIPTION_CYCLE_JOB_KIND,
  CREDIT_SUBSCRIPTION_CYCLE_SCHEDULE_ID,
  CREDIT_SUBSCRIPTION_RECONCILIATION_JOB_KIND,
  CREDIT_SUBSCRIPTION_RECONCILIATION_SCHEDULE_ID,
  CreditSubscriptionCycleScheduler,
  MemoryCreditSubscriptionStore,
  createCreditSubscriptionCycleJobHandler,
  createCreditSubscriptionReconciliationJobHandler,
  registerCreditSubscriptionSchedules,
  type CreditSubscriptionAlert,
} from './credit-subscription-scheduler.js';

const plans = {
  trial: { credits: 100 },
  starter: { credits: 500 },
  growth: { credits: 1_300 },
  pro: { credits: 2_800 },
} as const;

describe('CreditSubscriptionCycleScheduler', () => {
  it('grants one annual subscription cycle at each UTC monthly anchor', async () => {
    const ledger = new MemoryCreditLedger();
    const subscriptions = new MemoryCreditSubscriptionStore();
    await subscriptions.upsert({
      anchorAt: '2026-01-15T08:30:00.000Z',
      id: 'sub-annual',
      interval: 'yearly',
      paidThroughCycle: 12,
      tier: 'growth',
      workspaceId: 'workspace-annual',
    });
    const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
      planFor: (tier) => plans[tier],
    });

    for (let cycleIndex = 0; cycleIndex < 12; cycleIndex += 1) {
      await scheduler.run(
        new Date(Date.UTC(2026, cycleIndex, 15, 8, 30)).toISOString(),
      );
    }

    const lots = ledger.listLots('workspace-annual');
    assert.equal(lots.length, 12);
    assert.deepEqual(
      lots.map((lot) => lot.grantIdempotencyKey),
      Array.from(
        { length: 12 },
        (_, cycleIndex) => `grant:sub:sub-annual:${cycleIndex}`,
      ),
    );
    assert.ok(lots.every((lot) => lot.originalCredits === 1_300));
    assert.equal(lots[0]?.expirationDate, '2026-02-15T08:30:00.000Z');
    assert.equal(lots[11]?.expirationDate, '2027-01-15T08:30:00.000Z');
  });

  it('backfills missed paid cycles without duplicating existing grants after a restart', async () => {
    const ledger = new MemoryCreditLedger();
    const subscriptions = new MemoryCreditSubscriptionStore();
    await subscriptions.upsert({
      anchorAt: '2026-01-31T12:00:00.000Z',
      id: 'sub-restart',
      interval: 'monthly',
      paidThroughCycle: 3,
      tier: 'starter',
      workspaceId: 'workspace-restart',
    });
    const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
      planFor: (tier) => plans[tier],
    });

    assert.deepEqual(await scheduler.run('2026-01-31T12:00:00.000Z'), {
      cancelledSubscriptions: 0,
      grantedCycles: 1,
    });
    assert.deepEqual(await scheduler.run('2026-04-01T00:00:00.000Z'), {
      cancelledSubscriptions: 0,
      grantedCycles: 2,
    });
    assert.deepEqual(await scheduler.run('2026-04-01T00:00:00.000Z'), {
      cancelledSubscriptions: 0,
      grantedCycles: 0,
    });

    assert.deepEqual(
      ledger
        .listLots('workspace-restart')
        .map((lot) => [lot.grantIdempotencyKey, lot.expirationDate]),
      [
        ['grant:sub:sub-restart:0', '2026-02-28T12:00:00.000Z'],
        ['grant:sub:sub-restart:1', '2026-03-31T12:00:00.000Z'],
        ['grant:sub:sub-restart:2', '2026-04-30T12:00:00.000Z'],
      ],
    );
  });

  it('alerts for paid, due cycles that do not have a credit grant', async () => {
    const ledger = new MemoryCreditLedger();
    const subscriptions = new MemoryCreditSubscriptionStore();
    const alerts: CreditSubscriptionAlert[] = [];
    await subscriptions.upsert({
      anchorAt: '2026-01-01T00:00:00.000Z',
      id: 'sub-reconcile',
      interval: 'monthly',
      paidThroughCycle: 2,
      tier: 'pro',
      workspaceId: 'workspace-reconcile',
    });
    const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
      alerts: { async notify(alert) { alerts.push(alert); } },
      planFor: (tier) => plans[tier],
    });

    await ledger.grant({
      createdAt: '2026-01-01T00:00:00.000Z',
      credits: 2_800,
      expirationDate: '2026-02-01T00:00:00.000Z',
      grantIdempotencyKey: 'grant:sub:sub-reconcile:0',
      id: 'sub:sub-reconcile:0',
      transactionType: 'SUBSCRIPTION_RENEWAL',
      workspaceId: 'workspace-reconcile',
    });

    const result = await scheduler.reconcile('2026-02-01T00:00:00.000Z');

    assert.deepEqual(result, { alertedCycles: 1, checkedCycles: 2 });
    assert.deepEqual(alerts, [
      {
        code: 'CREDIT_SUBSCRIPTION_GRANT_MISSING',
        cycleIndex: 1,
        subscriptionId: 'sub-reconcile',
        workspaceId: 'workspace-reconcile',
      },
    ]);
  });

  it('fails closed when a paid subscription tier has no valid credit amount', async () => {
    const ledger = new MemoryCreditLedger();
    const subscriptions = new MemoryCreditSubscriptionStore();
    await subscriptions.upsert({
      anchorAt: '2026-01-01T00:00:00.000Z',
      id: 'sub-invalid-plan',
      interval: 'monthly',
      paidThroughCycle: 1,
      tier: 'starter',
      workspaceId: 'workspace-invalid-plan',
    });
    const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
      planFor: () => ({ credits: 0 }),
    });

    await assert.rejects(scheduler.run('2026-01-01T00:00:00.000Z'), /positive integer/i);
    assert.equal(ledger.listLots('workspace-invalid-plan').length, 0);
  });

  it('withholds grants during past_due, restores them after payment, and cancels after seven days', async () => {
    const ledger = new MemoryCreditLedger();
    const subscriptions = new MemoryCreditSubscriptionStore();
    await subscriptions.upsert({
      anchorAt: '2026-01-01T00:00:00.000Z',
      id: 'sub-past-due',
      interval: 'monthly',
      paidThroughCycle: 1,
      tier: 'starter',
      workspaceId: 'workspace-past-due',
    });
    await subscriptions.markPastDue('sub-past-due', '2026-02-01T00:00:00.000Z');
    const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
      planFor: (tier) => plans[tier],
    });

    await scheduler.run('2026-02-04T00:00:00.000Z');
    assert.equal(ledger.listLots('workspace-past-due').length, 0);

    await subscriptions.recordPaidCoverage('sub-past-due', 2, '2026-02-04T00:00:00.000Z');
    await scheduler.run('2026-02-04T00:00:00.000Z');
    assert.deepEqual(
      ledger
        .listLots('workspace-past-due')
        .map((lot) => lot.grantIdempotencyKey),
      ['grant:sub:sub-past-due:0', 'grant:sub:sub-past-due:1'],
    );

    await subscriptions.markPastDue('sub-past-due', '2026-03-01T00:00:00.000Z');
    await scheduler.run('2026-03-08T00:00:00.000Z');
    assert.equal((await subscriptions.get('sub-past-due'))?.status, 'cancelled');
    assert.equal((await subscriptions.get('sub-past-due'))?.pastDueAt, null);
    await assert.rejects(
      subscriptions.recordPaidCoverage('sub-past-due', 3, '2026-03-08T00:00:00.000Z'),
      /cancelled/i,
    );
    await assert.rejects(
      subscriptions.upsert({
        anchorAt: '2026-03-08T00:00:00.000Z',
        cancelledAt: '2026-03-08T00:00:00.000Z',
        id: 'active-with-cancelled-at',
        interval: 'monthly',
        paidThroughCycle: 1,
        tier: 'starter',
        workspaceId: 'workspace-past-due',
      }),
      /cancelledAt/i,
    );
    await subscriptions.upsert({
      anchorAt: '2026-03-08T00:00:00.000Z',
      id: 'single-month-coverage',
      interval: 'single_month',
      paidThroughCycle: 1,
      tier: 'starter',
      workspaceId: 'workspace-past-due',
    });
    assert.equal(
      (
        await subscriptions.recordPaidCoverage(
          'single-month-coverage',
          2,
          '2026-03-08T00:00:00.000Z',
        )
      ).paidThroughCycle,
      2,
    );
  });

  it('registers repeatable grant and reconciliation jobs and delegates both handlers', async () => {
    const schedules: Array<{
      cron: string;
      kind: string;
      payload: Record<string, unknown>;
      scheduleId: string;
      timezone?: string;
      workspaceId: string;
    }> = [];
    await registerCreditSubscriptionSchedules({
      async scheduleRecurring(input) {
        schedules.push(input);
      },
    });
    assert.deepEqual(schedules, [
      {
        cron: '*/5 * * * *',
        kind: CREDIT_SUBSCRIPTION_CYCLE_JOB_KIND,
        payload: {},
        scheduleId: CREDIT_SUBSCRIPTION_CYCLE_SCHEDULE_ID,
        timezone: 'UTC',
        workspaceId: '__system__',
      },
      {
        cron: '17 0 * * *',
        kind: CREDIT_SUBSCRIPTION_RECONCILIATION_JOB_KIND,
        payload: {},
        scheduleId: CREDIT_SUBSCRIPTION_RECONCILIATION_SCHEDULE_ID,
        timezone: 'UTC',
        workspaceId: '__system__',
      },
    ]);

    const cycleHandler = createCreditSubscriptionCycleJobHandler({
      async run(at) {
        return { cancelledSubscriptions: 0, grantedCycles: at === '2026-01-01T00:00:00.000Z' ? 1 : 0 };
      },
    });
    const reconcileHandler = createCreditSubscriptionReconciliationJobHandler({
      async reconcile() {
        return { alertedCycles: 0, checkedCycles: 1 };
      },
    });
    const context = {
      attempt: 1,
      claimedAt: '2026-01-01T00:00:00.000Z',
      recovered: false,
      renewLease: async () => {},
      transportId: 'job-1',
    };
    const envelope = (kind: string) => ({
      enqueuedAt: context.claimedAt,
      fingerprint: 'fingerprint',
      jobId: kind,
      kind,
      payload: {},
      workspaceId: '__system__',
    });
    assert.deepEqual(
      await cycleHandler(envelope(CREDIT_SUBSCRIPTION_CYCLE_JOB_KIND), context),
      { output: { cancelledSubscriptions: 0, grantedCycles: 1 }, status: 'completed' },
    );
    assert.deepEqual(
      await reconcileHandler(
        envelope(CREDIT_SUBSCRIPTION_RECONCILIATION_JOB_KIND),
        context,
      ),
      { output: { alertedCycles: 0, checkedCycles: 1 }, status: 'completed' },
    );
  });
});
