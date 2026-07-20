import assert from 'node:assert/strict';
import test from 'node:test';
import { REGISTER_GIFT_GRANT_KEY } from './domain.js';
import { GrantLotAwareProductEntitlementService } from './grant-lot-entitlement-service.js';
import { MemoryGrantLotLedger } from './grant-lot.js';
import { MemoryFoundationRepository } from './memory-repository.js';
import { ProductEntitlementApplicationService } from './entitlement-service.js';

test('entitlement projection reads available usage from the authoritative grant lots', async () => {
  const repository = new MemoryFoundationRepository();
  const grantLots = new MemoryGrantLotLedger();
  const context = {
    workspaceId: 'workspace-grant-projection',
    userId: 'owner-grant-projection',
    correlationId: 'grant-projection',
  };
  repository.grantOwner(context.workspaceId, context.userId);
  const now = new Date('2026-07-19T12:00:00.000Z');
  const service = new GrantLotAwareProductEntitlementService(
    repository,
    grantLots,
    undefined,
    () => now,
  );
  await service.activatePlan(
    context,
    {
      paymentEventId: 'projection-trial',
      grantKey: REGISTER_GIFT_GRANT_KEY,
      policy: {
        revision: 'projection-trial',
        tier: 'trial',
        periodId: '2026-07',
        periodStartsAt: '2026-07-01T00:00:00.000Z',
        periodEndsAt: '2026-08-01T00:00:00.000Z',
        periodStrategy: 'fixed_days',
        allowance: { audio: 0, copy: 2, image: 0, video: 0 },
        concurrencyLimit: 1,
        queuePriority: 1,
        supportLabel: 'standard',
      },
    },
    'projection-trial',
  );

  assert.equal((await service.getProjection(context)).usage.copy.available, 2);
  grantLots.consume({
    workspaceId: context.workspaceId,
    resource: 'copy',
    amount: 1,
    transactionId: 'projection-usage',
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt: now.toISOString(),
  });
  assert.deepEqual((await service.getProjection(context)).usage.copy, {
    allowance: 2,
    reserved: 0,
    committed: 1,
    released: 0,
    available: 1,
  });

  grantLots.refundUsageOperation({
    workspaceId: context.workspaceId,
    usageOperationId: 'projection-usage',
    refundOperationId: 'projection-refund',
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt: now.toISOString(),
  });
  assert.deepEqual((await service.getProjection(context)).usage.copy, {
    allowance: 2,
    reserved: 0,
    committed: 0,
    released: 0,
    available: 2,
  });
});

test('migrates a legacy-only positive balance once before projection and consumption', async () => {
  const repository = new MemoryFoundationRepository();
  const grantLots = new MemoryGrantLotLedger();
  const context = {
    workspaceId: 'workspace-legacy-balance',
    userId: 'owner-legacy-balance',
    correlationId: 'legacy-balance',
  };
  repository.grantOwner(context.workspaceId, context.userId);
  await repository.appendUsageEvent({
    id: 'legacy-opening-copy',
    workspaceId: context.workspaceId,
    resource: 'copy',
    action: 'adjust',
    amount: 2,
    reason: 'legacy opening balance',
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt: '2026-07-18T00:00:00+08:00',
  });
  const now = new Date('2026-07-19T12:00:00.000Z');
  const service = new GrantLotAwareProductEntitlementService(
    repository,
    grantLots,
    undefined,
    () => now,
  );

  assert.equal((await service.getProjection(context)).usage.copy.available, 2);
  assert.equal(grantLots.listLots(context.workspaceId, 'copy').length, 1);
  grantLots.consume({
    workspaceId: context.workspaceId,
    resource: 'copy',
    amount: 1,
    transactionId: 'legacy-balance-consume',
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt: now.toISOString(),
  });
  assert.equal((await service.getProjection(context)).usage.copy.available, 1);
  assert.equal(grantLots.listLots(context.workspaceId, 'copy').length, 1);
});

test('migrates historical committed usage into an existing entitlement lot', async () => {
  const repository = new MemoryFoundationRepository();
  const grantLots = new MemoryGrantLotLedger();
  const context = {
    workspaceId: 'workspace-legacy-committed',
    userId: 'owner-legacy-committed',
    correlationId: 'legacy-committed',
  };
  repository.grantOwner(context.workspaceId, context.userId);
  const now = new Date('2026-07-19T12:00:00.000Z');
  const legacyService = new ProductEntitlementApplicationService(
    repository,
    undefined,
    () => now,
  );
  await legacyService.activatePlan(
    context,
    {
      paymentEventId: 'legacy-plan',
      policy: {
        revision: 'legacy-plan',
        tier: 'growth',
        periodId: '2026-07',
        periodStartsAt: '2026-07-01T00:00:00.000Z',
        periodEndsAt: '2026-08-01T00:00:00.000Z',
        periodStrategy: 'calendar_month',
        allowance: { audio: 0, copy: 10, image: 0, video: 0 },
        concurrencyLimit: 1,
        queuePriority: 1,
        supportLabel: 'standard',
      },
    },
    'legacy-plan',
  );
  await repository.appendUsageEvent({
    id: 'legacy-reserve-three',
    workspaceId: context.workspaceId,
    resource: 'copy',
    action: 'reserve',
    amount: 3,
    reservationId: 'legacy-three',
    reason: 'legacy generation',
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt: '2026-07-19T10:00:00.000Z',
  });
  await repository.appendUsageEvent({
    id: 'legacy-commit-three',
    workspaceId: context.workspaceId,
    resource: 'copy',
    action: 'commit',
    amount: 3,
    reservationId: 'legacy-three',
    reason: 'legacy generation delivered',
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt: '2026-07-19T10:01:00.000Z',
  });
  grantLots.grant({
    id: 'legacy-committed-redemption',
    workspaceId: context.workspaceId,
    resource: 'copy',
    amount: 1,
    expirationDate: null,
    transactionType: 'REDEMPTION_CODE',
    sourceRef: 'legacy-committed-redemption-code',
    createdAt: '2026-07-19T11:00:00.000Z',
  });
  await repository.appendUsageEvent({
    id: 'legacy-committed-redemption-compatibility',
    workspaceId: context.workspaceId,
    resource: 'copy',
    action: 'adjust',
    amount: 1,
    reason: 'redemption_code:legacy-committed-redemption-code',
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt: '2026-07-19T11:00:00.000Z',
  });
  const service = new GrantLotAwareProductEntitlementService(
    repository,
    grantLots,
    undefined,
    () => now,
  );

  assert.equal((await service.getProjection(context)).usage.copy.available, 8);
  assert.equal(
    grantLots
      .listTransactions(context.workspaceId)
      .filter((transaction) => transaction.transactionType === 'USAGE')
      .reduce((total, transaction) => total + transaction.amount, 0),
    3
  );
  assert.equal(
    grantLots
      .listLots(context.workspaceId, 'copy')
      .find((lot) => lot.id === 'legacy-committed-redemption')?.remainingAmount,
    1
  );
});

test('defers the migration marker until a legacy reservation reaches a terminal', async () => {
  const repository = new MemoryFoundationRepository();
  const grantLots = new MemoryGrantLotLedger();
  const context = {
    workspaceId: 'workspace-legacy-pending',
    userId: 'owner-legacy-pending',
    correlationId: 'legacy-pending',
  };
  repository.grantOwner(context.workspaceId, context.userId);
  const now = new Date('2026-07-19T12:00:00.000Z');
  const legacyService = new ProductEntitlementApplicationService(
    repository,
    undefined,
    () => now,
  );
  await legacyService.activatePlan(
    context,
    {
      paymentEventId: 'legacy-pending-plan',
      policy: {
        revision: 'legacy-pending-plan',
        tier: 'growth',
        periodId: '2026-07',
        periodStartsAt: '2026-07-01T00:00:00.000Z',
        periodEndsAt: '2026-08-01T00:00:00.000Z',
        periodStrategy: 'calendar_month',
        allowance: { audio: 0, copy: 10, image: 2, video: 0 },
        concurrencyLimit: 1,
        queuePriority: 1,
        supportLabel: 'standard',
      },
    },
    'legacy-pending-plan',
  );
  await repository.appendUsageEvent({
    id: 'legacy-pending-reserve',
    workspaceId: context.workspaceId,
    resource: 'copy',
    action: 'reserve',
    amount: 3,
    reservationId: 'legacy-pending-reservation',
    reason: 'legacy in-flight generation',
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt: '2026-07-19T10:00:00.000Z',
  });
  const service = new GrantLotAwareProductEntitlementService(
    repository,
    grantLots,
    undefined,
    () => now,
  );

  assert.equal((await service.getProjection(context)).usage.copy.available, 0);
  assert.equal((await service.getProjection(context)).usage.image.available, 2);
  assert.equal(
    grantLots.isLegacyBalanceMigrated(context.workspaceId, 'copy'),
    false
  );
  assert.equal(
    grantLots.isLegacyBalanceMigrated(context.workspaceId, 'image'),
    true
  );
  await repository.appendUsageEvent({
    id: 'legacy-pending-refund',
    workspaceId: context.workspaceId,
    resource: 'copy',
    action: 'refund',
    amount: 3,
    reservationId: 'legacy-pending-reservation',
    reason: 'legacy in-flight generation refunded',
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt: '2026-07-19T11:00:00.000Z',
  });

  assert.equal((await service.getProjection(context)).usage.copy.available, 10);
  assert.equal(
    grantLots.isLegacyBalanceMigrated(context.workspaceId, 'copy'),
    true
  );
});
