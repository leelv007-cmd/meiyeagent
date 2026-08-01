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
    id: 'package',
    credits: 5,
    expirationDate: '2026-08-05T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
  });

  const usage = ledger.consume({
    workspaceId: 'workspace-credit',
    credits: 8,
    transactionId: creditUsageOperationId('task-fefo'),
    actorId: 'owner',
    correlationId: 'test',
    createdAt: '2026-08-02T00:00:00.000Z',
  });

  assert.deepEqual(
    usage.map((transaction) => [transaction.lotId, transaction.credits]),
    [
      ['package', 5],
      ['subscription', 3],
    ],
  );
  assert.equal(ledger.project('workspace-credit').availableCredits, 7);
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

test('trial grants are idempotent per workspace key', () => {
  const ledger = new MemoryCreditLedger();
  const input = {
    id: 'trial-workspace-credit',
    workspaceId: 'workspace-credit',
    credits: 100,
    expirationDate: '2026-08-08T00:00:00.000Z',
    transactionType: 'REGISTER_GIFT' as const,
    sourceRef: 'trial:workspace-credit',
    grantIdempotencyKey: 'grant:trial:workspace-credit',
    createdAt: now,
  };

  ledger.grant(input);
  ledger.grant(input);

  assert.equal(ledger.listLots('workspace-credit').length, 1);
});
