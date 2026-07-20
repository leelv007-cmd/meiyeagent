import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REGISTER_GIFT_GRANT_KEY } from './domain.js';
import { GrantLotAwareProductEntitlementService } from './grant-lot-entitlement-service.js';
import { MemoryGrantLotLedger } from './grant-lot.js';
import { MemoryFoundationRepository } from './memory-repository.js';

describe('GrantLotAwareProductEntitlementService', () => {
  it('expires excess same-period allowance when a plan is downgraded', async () => {
    const repository = new MemoryFoundationRepository();
    const grantLots = new MemoryGrantLotLedger();
    const workspaceId = 'workspace-grant-downgrade';
    const context = {
      workspaceId,
      userId: 'owner-grant-downgrade',
      correlationId: 'corr-grant-downgrade',
    };
    repository.grantOwner(workspaceId, context.userId);
    const now = new Date('2026-07-19T12:00:00.000Z');
    const service = new GrantLotAwareProductEntitlementService(
      repository,
      grantLots,
      undefined,
      () => now
    );
    const policy = {
      revision: 'growth-july',
      tier: 'growth' as const,
      periodId: '2026-07',
      periodStartsAt: '2026-07-01T00:00:00.000Z',
      periodEndsAt: '2026-08-01T00:00:00.000Z',
      periodStrategy: 'provider_period' as const,
      allowance: { audio: 0, copy: 10, image: 0, video: 0 },
      concurrencyLimit: 4,
      queuePriority: 20,
      supportLabel: 'standard' as const,
    };
    await service.activatePlan(
      context,
      { paymentEventId: 'growth-july-10', policy },
      'growth-july-10'
    );
    grantLots.consume({
      workspaceId,
      resource: 'copy',
      amount: 3,
      transactionId: 'copy-before-downgrade',
      actorId: context.userId,
      correlationId: context.correlationId,
      createdAt: now.toISOString(),
    });

    await service.activatePlan(
      context,
      {
        paymentEventId: 'growth-july-5',
        policy: {
          ...policy,
          revision: 'growth-july-downgraded',
          allowance: { ...policy.allowance, copy: 5 },
        },
      },
      'growth-july-5'
    );

    assert.equal(
      grantLots.listLots(workspaceId, 'copy').reduce(
        (total, lot) => total + lot.remainingAmount,
        0
      ),
      2
    );
    assert.equal(
      grantLots
        .listTransactions(workspaceId)
        .filter((transaction) => transaction.transactionType === 'EXPIRE')
        .reduce((total, transaction) => total + transaction.amount, 0),
      5
    );
  });

  it('closes old-period lots before granting an early replacement period', async () => {
    const repository = new MemoryFoundationRepository();
    const grantLots = new MemoryGrantLotLedger();
    const workspaceId = 'workspace-grant-period-switch';
    const context = {
      workspaceId,
      userId: 'owner-grant-period-switch',
      correlationId: 'corr-grant-period-switch',
    };
    repository.grantOwner(workspaceId, context.userId);
    let now = new Date('2026-07-19T12:00:00.000Z');
    const service = new GrantLotAwareProductEntitlementService(
      repository,
      grantLots,
      undefined,
      () => now
    );
    const july = planPolicy({
      revision: 'growth-july-switch',
      periodId: '2026-07-switch',
      periodStartsAt: '2026-07-01T00:00:00.000Z',
      periodEndsAt: '2026-08-01T00:00:00.000Z',
      copy: 10,
    });
    await service.activatePlan(
      context,
      { paymentEventId: 'switch-july', policy: july },
      'switch-july'
    );

    now = new Date('2026-07-20T12:00:00.000Z');
    await service.activatePlan(
      context,
      {
        paymentEventId: 'switch-august-early',
        policy: planPolicy({
          revision: 'growth-august-early',
          periodId: '2026-08-switch',
          periodStartsAt: now.toISOString(),
          periodEndsAt: '2026-08-20T12:00:00.000Z',
          copy: 6,
        }),
      },
      'switch-august-early'
    );

    const lots = grantLots.listLots(workspaceId, 'copy');
    assert.equal(lots[0]?.remainingAmount, 0);
    assert.equal(lots[1]?.remainingAmount, 6);
    assert.equal(
      grantLots
        .listTransactions(workspaceId)
        .filter((transaction) => transaction.transactionType === 'EXPIRE')
        .reduce((total, transaction) => total + transaction.amount, 0),
      10
    );
  });

  it('shortens a cancellation boundary and records EXPIRE before later usage', async () => {
    const repository = new MemoryFoundationRepository();
    const grantLots = new MemoryGrantLotLedger();
    const workspaceId = 'workspace-grant-cancel-boundary';
    const context = {
      workspaceId,
      userId: 'owner-grant-cancel-boundary',
      correlationId: 'corr-grant-cancel-boundary',
    };
    repository.grantOwner(workspaceId, context.userId);
    let now = new Date('2026-07-19T12:00:00.000Z');
    const service = new GrantLotAwareProductEntitlementService(
      repository,
      grantLots,
      undefined,
      () => now
    );
    const policy = planPolicy({
      revision: 'growth-cancel-original',
      periodId: '2026-07-cancel',
      periodStartsAt: '2026-07-01T00:00:00.000Z',
      periodEndsAt: '2026-08-01T00:00:00.000Z',
      copy: 10,
    });
    await service.activatePlan(
      context,
      { paymentEventId: 'cancel-original', policy },
      'cancel-original'
    );
    const cancelBoundary = '2026-07-25T00:00:00.000Z';
    await service.activatePlan(
      context,
      {
        paymentEventId: 'cancel-shortened',
        policy: {
          ...policy,
          revision: 'growth-cancel-shortened',
          periodEndsAt: cancelBoundary,
        },
      },
      'cancel-shortened'
    );
    assert.equal(
      grantLots.listLots(workspaceId, 'copy')[0]?.expirationDate,
      cancelBoundary
    );

    now = new Date('2026-07-26T00:00:00.000Z');
    assert.throws(
      () =>
        grantLots.consume({
          workspaceId,
          resource: 'copy',
          amount: 1,
          transactionId: 'usage-after-cancel-boundary',
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: now.toISOString(),
        }),
      { code: 'INSUFFICIENT_ENTITLEMENT' }
    );
    assert.equal(
      grantLots
        .listTransactions(workspaceId)
        .filter((transaction) => transaction.transactionType === 'EXPIRE')
        .reduce((total, transaction) => total + transaction.amount, 0),
      10
    );
  });

  it('expires the active period immediately when payment lifecycle ends it', async () => {
    const repository = new MemoryFoundationRepository();
    const grantLots = new MemoryGrantLotLedger();
    const workspaceId = 'workspace-grant-immediate-expire';
    const context = {
      workspaceId,
      userId: 'owner-grant-immediate-expire',
      correlationId: 'corr-grant-immediate-expire',
    };
    repository.grantOwner(workspaceId, context.userId);
    const now = new Date('2026-07-19T12:00:00.000Z');
    const service = new GrantLotAwareProductEntitlementService(
      repository,
      grantLots,
      undefined,
      () => now
    );
    await service.activatePlan(
      context,
      {
        paymentEventId: 'expire-original',
        policy: planPolicy({
          revision: 'growth-expire-original',
          periodId: '2026-07-expire',
          periodStartsAt: '2026-07-01T00:00:00.000Z',
          periodEndsAt: '2026-08-01T00:00:00.000Z',
          copy: 10,
        }),
      },
      'expire-original'
    );
    await service.activatePlan(
      context,
      {
        paymentEventId: 'expire-now',
        policy: planPolicy({
          revision: 'starter-expired-now',
          periodId: 'expired-now',
          periodStartsAt: '2026-07-19T11:59:59.000Z',
          periodEndsAt: now.toISOString(),
          copy: 0,
          tier: 'starter',
        }),
      },
      'expire-now'
    );

    assert.equal(grantLots.listLots(workspaceId, 'copy')[0]?.remainingAmount, 0);
    assert.equal(
      grantLots
        .listTransactions(workspaceId)
        .filter((transaction) => transaction.transactionType === 'EXPIRE')
        .reduce((total, transaction) => total + transaction.amount, 0),
      10
    );
  });

  it('synchronizes gift, renewal, and package events into idempotent grant lots', async () => {
    const repository = new MemoryFoundationRepository();
    const grantLots = new MemoryGrantLotLedger();
    const workspaceId = 'workspace-grant-sync';
    const userId = 'owner-grant-sync';
    const context = {
      workspaceId,
      userId,
      correlationId: 'corr-grant-sync',
    };
    repository.grantOwner(workspaceId, userId);
    let now = new Date('2026-07-19T12:00:00.000Z');
    const service = new GrantLotAwareProductEntitlementService(
      repository,
      grantLots,
      undefined,
      () => now
    );
    const trial = {
      revision: 'trial-july',
      tier: 'trial' as const,
      periodId: '2026-07',
      periodStartsAt: '2026-07-01T00:00:00.000Z',
      periodEndsAt: '2026-08-01T00:00:00.000Z',
      periodStrategy: 'fixed_days' as const,
      allowance: { audio: 0, copy: 10, image: 2, video: 1 },
      concurrencyLimit: 1,
      queuePriority: 1,
      supportLabel: 'standard' as const,
    };
    await service.activatePlan(
      context,
      {
        paymentEventId: 'gift-trial',
        policy: trial,
        grantKey: REGISTER_GIFT_GRANT_KEY,
      },
      'activate-gift'
    );

    const paid = {
      ...trial,
      revision: 'growth-july',
      tier: 'growth' as const,
      periodStrategy: 'provider_period' as const,
      allowance: { audio: 0, copy: 20, image: 4, video: 2 },
      concurrencyLimit: 4,
      queuePriority: 20,
    };
    await service.activatePlan(
      context,
      { paymentEventId: 'paid-growth', policy: paid },
      'activate-paid'
    );
    await service.recordAddOnPurchase(
      context,
      {
        paymentEventId: 'package-payment',
        purchaseId: 'package-copy-1',
        resource: 'copy',
        quantity: 5,
        amountMicros: 100,
        currency: 'CNY',
      },
      'purchase-package'
    );

    const beforeReplay = grantLots.listLots(workspaceId);
    await service.activatePlan(
      context,
      { paymentEventId: 'paid-growth', policy: paid },
      'activate-paid-replay'
    );
    assert.deepEqual(grantLots.listLots(workspaceId), beforeReplay);

    const copyLots = grantLots.listLots(workspaceId, 'copy');
    assert.deepEqual(
      copyLots.map((lot) => ({
        amount: lot.originalAmount,
        expiresAt: lot.expirationDate,
        type: lot.transactionType,
      })),
      [
        {
          amount: 10,
          expiresAt: '2026-08-01T00:00:00.000Z',
          type: 'REGISTER_GIFT',
        },
        {
          amount: 10,
          expiresAt: '2026-08-01T00:00:00.000Z',
          type: 'SUBSCRIPTION_RENEWAL',
        },
        {
          amount: 5,
          expiresAt: null,
          type: 'PURCHASE_PACKAGE',
        },
      ]
    );

    now = new Date('2026-08-02T00:00:00.000Z');
    await service.resolveSupplement(workspaceId);
    assert.ok(
      grantLots
        .listTransactions(workspaceId)
        .some((transaction) => transaction.transactionType === 'EXPIRE')
    );
    assert.equal(
      grantLots.listLots(workspaceId, 'copy').reduce(
        (total, lot) => total + lot.remainingAmount,
        0
      ),
      5
    );
  });
});

function planPolicy(input: {
  revision: string;
  periodId: string;
  periodStartsAt: string;
  periodEndsAt: string;
  copy: number;
  tier?: 'starter' | 'growth';
}) {
  return {
    revision: input.revision,
    tier: input.tier ?? ('growth' as const),
    periodId: input.periodId,
    periodStartsAt: input.periodStartsAt,
    periodEndsAt: input.periodEndsAt,
    periodStrategy: 'provider_period' as const,
    allowance: { audio: 0, copy: input.copy, image: 0, video: 0 },
    concurrencyLimit: 4,
    queuePriority: 20,
    supportLabel: 'standard' as const,
  };
}
