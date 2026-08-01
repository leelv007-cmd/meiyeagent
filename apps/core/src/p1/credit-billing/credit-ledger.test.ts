import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryCreditLedger,
  creditUsageOperationId,
} from './credit-ledger.js';

const now = '2026-08-01T00:00:00.000Z';

function grant(
  ledger: MemoryCreditLedger,
  input: {
    id: string;
    credits: number;
    expirationDate: string | null;
    transactionType?: 'SUBSCRIPTION_RENEWAL' | 'PURCHASE_PACKAGE';
  },
) {
  return ledger.grant({
    ...input,
    workspaceId: 'workspace-credit',
    transactionType: input.transactionType ?? 'SUBSCRIPTION_RENEWAL',
    createdAt: now,
  });
}

test('credits use FEFO across subscription and package lots', () => {
  const ledger = new MemoryCreditLedger();
  grant(ledger, {
    id: 'subscription',
    credits: 10,
    expirationDate: '2026-08-31T00:00:00.000Z',
  });
  grant(ledger, {
    id: 'package-first',
    credits: 5,
    expirationDate: '2026-08-05T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
  });
  grant(ledger, {
    id: 'package-second',
    credits: 4,
    expirationDate: '2026-08-10T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
  });

  const firstUsage = ledger.consume({
    workspaceId: 'workspace-credit',
    credits: 8,
    transactionId: creditUsageOperationId('task-fefo-first'),
    actorId: 'owner',
    correlationId: 'test',
    createdAt: '2026-08-02T00:00:00.000Z',
  });
  const secondUsage = ledger.consume({
    workspaceId: 'workspace-credit',
    credits: 6,
    transactionId: creditUsageOperationId('task-fefo-second'),
    actorId: 'owner',
    correlationId: 'test',
    createdAt: '2026-08-03T00:00:00.000Z',
  });

  assert.deepEqual(
    [...firstUsage, ...secondUsage].map((transaction) => [
      transaction.lotId,
      transaction.credits,
    ]),
    [
      ['package-first', 5],
      ['package-second', 3],
      ['package-second', 1],
      ['subscription', 5],
    ],
  );
  assert.equal(
    ledger.project('workspace-credit', '2026-08-03T00:00:00.000Z')
      .availableCredits,
    5,
  );
});

test('a refund after source-lot expiry remains visible but cannot revive credits', () => {
  const ledger = new MemoryCreditLedger();
  grant(ledger, {
    id: 'short-package',
    credits: 5,
    expirationDate: '2026-08-02T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
  });
  ledger.consume({
    workspaceId: 'workspace-credit',
    credits: 5,
    transactionId: creditUsageOperationId('task-expired-refund'),
    actorId: 'owner',
    correlationId: 'test',
    createdAt: '2026-08-01T12:00:00.000Z',
  });

  const [refund] = ledger.refundUsageOperation({
    workspaceId: 'workspace-credit',
    usageOperationId: creditUsageOperationId('task-expired-refund'),
    refundOperationId: 'refund:task-expired-refund',
    actorId: 'worker',
    correlationId: 'test',
    createdAt: '2026-08-03T00:00:00.000Z',
  });

  assert.equal(refund?.credited, false);
  assert.equal(ledger.project('workspace-credit').availableCredits, 0);
  assert.equal(
    ledger.listTransactions('workspace-credit').find(
      (transaction) => transaction.transactionType === 'REFUND',
    )?.credits,
    5,
  );
});

test('workspace lock prevents concurrent reservations from exceeding one balance', async () => {
  const ledger = new MemoryCreditLedger();
  grant(ledger, { id: 'balance', credits: 5, expirationDate: null });

  const results = await Promise.allSettled(
    Array.from({ length: 4 }, (_, index) =>
      ledger.withWorkspaceCreditLock('workspace-credit', () =>
        ledger.consume({
          workspaceId: 'workspace-credit',
          credits: 2,
          transactionId: creditUsageOperationId(`task-${index}`),
          actorId: 'owner',
          correlationId: 'test',
          createdAt: now,
        }),
      ),
    ),
  );

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);
  assert.equal(ledger.project('workspace-credit').availableCredits, 1);
});

test('trial grants are idempotent per workspace key across delayed retries', () => {
  const ledger = new MemoryCreditLedger();
  const input = {
    id: 'trial-workspace-credit',
    workspaceId: 'workspace-credit',
    credits: 100,
    expirationDate: null,
    transactionType: 'REGISTER_GIFT' as const,
    sourceRef: 'trial:workspace-credit',
    grantIdempotencyKey: 'grant:trial:workspace-credit',
    createdAt: now,
  };

  ledger.grant(input);
  ledger.grant({ ...input, createdAt: '2026-08-02T00:00:00.000Z' });

  assert.equal(ledger.listLots('workspace-credit').length, 1);
});

test('balance projection excludes expired lots before a later consume writes EXPIRE', () => {
  const ledger = new MemoryCreditLedger();
  grant(ledger, {
    id: 'expired-package',
    credits: 5,
    expirationDate: '2026-08-02T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
  });

  const projection = ledger.project(
    'workspace-credit',
    '2026-08-03T00:00:00.000Z',
  );

  assert.equal(projection.availableCredits, 0);
  assert.equal(projection.expiredCredits, 5);
  assert.equal(
    ledger.listTransactions('workspace-credit').filter(
      (transaction) => transaction.transactionType === 'EXPIRE',
    ).length,
    0,
  );
});
