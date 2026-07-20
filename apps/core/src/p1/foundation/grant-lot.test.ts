import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MemoryGrantLotLedger,
  allocateFifoConsumption,
  compareGrantLotsForFifo,
  type GrantLot,
} from './grant-lot.js';
import { P1DomainError } from './domain.js';

describe('grant-lot FIFO ledger', () => {
  it('orders by expirationDate ASC NULLS LAST', () => {
    const lots: GrantLot[] = [
      {
        id: 'never',
        workspaceId: 'ws',
        resource: 'copy',
        originalAmount: 10,
        remainingAmount: 10,
        expirationDate: null,
        transactionType: 'PURCHASE_PACKAGE',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'soon',
        workspaceId: 'ws',
        resource: 'copy',
        originalAmount: 5,
        remainingAmount: 5,
        expirationDate: '2026-07-10T00:00:00.000Z',
        transactionType: 'REGISTER_GIFT',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'later',
        workspaceId: 'ws',
        resource: 'copy',
        originalAmount: 5,
        remainingAmount: 5,
        expirationDate: '2026-08-01T00:00:00.000Z',
        transactionType: 'SUBSCRIPTION_RENEWAL',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ];
    const ordered = [...lots].sort(compareGrantLotsForFifo).map((lot) => lot.id);
    assert.deepEqual(ordered, ['soon', 'later', 'never']);
    assert.deepEqual(
      allocateFifoConsumption(lots, 7).map((item) => item.lotId),
      ['soon', 'later']
    );
  });

  it('compares offset timestamps by instant and keeps identical lot ids workspace-scoped', () => {
    const ledger = new MemoryGrantLotLedger();
    for (const workspaceId of ['ws-a', 'ws-b']) {
      ledger.grant({
        id: 'shared-lot-id',
        workspaceId,
        resource: 'copy',
        amount: 2,
        expirationDate: '2026-07-19T10:00:00+08:00',
        transactionType: 'REGISTER_GIFT',
        createdAt: '2026-07-19T00:30:00Z',
      });
    }

    ledger.consume({
      workspaceId: 'ws-b',
      resource: 'copy',
      amount: 1,
      transactionId: 'usage-offset',
      actorId: 'owner',
      correlationId: 'corr-offset',
      createdAt: '2026-07-19T01:00:00Z',
    });
    assert.equal(ledger.listLots('ws-a')[0]?.remainingAmount, 2);
    assert.equal(ledger.listLots('ws-b')[0]?.remainingAmount, 1);

    assert.equal(
      ledger.expireLots({
        workspaceId: 'ws-b',
        now: '2026-07-19T02:00:00Z',
        actorId: 'system',
        correlationId: 'corr-expire-offset',
      }).length,
      1
    );
  });

  it('consumes FIFO and refunds USAGE via relatedTransactionId without double refund', () => {
    const ledger = new MemoryGrantLotLedger();
    ledger.grant({
      id: 'lot-gift',
      workspaceId: 'ws',
      resource: 'copy',
      amount: 10,
      expirationDate: '2026-07-20T00:00:00.000Z',
      transactionType: 'REGISTER_GIFT',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    ledger.grant({
      id: 'lot-pack',
      workspaceId: 'ws',
      resource: 'copy',
      amount: 20,
      expirationDate: null,
      transactionType: 'PURCHASE_PACKAGE',
      createdAt: '2026-07-02T00:00:00.000Z',
    });

    const usage = ledger.consume({
      workspaceId: 'ws',
      resource: 'copy',
      amount: 12,
      transactionId: 'usage-1',
      actorId: 'owner',
      correlationId: 'corr',
      createdAt: '2026-07-05T00:00:00.000Z',
    });
    assert.equal(usage.length, 2);
    assert.equal(usage[0]?.lotId, 'lot-gift');
    assert.equal(usage[0]?.amount, 10);
    assert.equal(usage[1]?.lotId, 'lot-pack');
    assert.equal(usage[1]?.amount, 2);

    const refund = ledger.refundUsage({
      workspaceId: 'ws',
      usageTransactionId: usage[0]!.id,
      refundTransactionId: 'refund-1',
      actorId: 'system',
      correlationId: 'corr-refund',
      createdAt: '2026-07-05T01:00:00.000Z',
    });
    assert.equal(refund?.transactionType, 'REFUND');
    assert.equal(refund?.relatedTransactionId, usage[0]!.id);
    assert.equal(
      ledger.listLots('ws', 'copy').find((lot) => lot.id === 'lot-gift')
        ?.remainingAmount,
      10
    );

    const replay = ledger.refundUsage({
      workspaceId: 'ws',
      usageTransactionId: usage[0]!.id,
      refundTransactionId: 'refund-1-replay',
      actorId: 'system',
      correlationId: 'corr-refund',
      createdAt: '2026-07-05T02:00:00.000Z',
    });
    assert.equal(replay?.id, refund?.id);
    assert.equal(
      ledger
        .listTransactions('ws')
        .filter((tx) => tx.transactionType === 'REFUND').length,
      1
    );
  });

  it('skips expired lots, rejects an underfunded consume atomically, and replays by operation id', () => {
    const ledger = new MemoryGrantLotLedger();
    ledger.grant({
      id: 'lot-expired',
      workspaceId: 'ws',
      resource: 'video',
      amount: 3,
      expirationDate: '2026-07-18T00:00:00.000Z',
      transactionType: 'REGISTER_GIFT',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    ledger.grant({
      id: 'lot-active',
      workspaceId: 'ws',
      resource: 'video',
      amount: 5,
      expirationDate: '2026-07-20T00:00:00.000Z',
      transactionType: 'SUBSCRIPTION_RENEWAL',
      createdAt: '2026-07-02T00:00:00.000Z',
    });

    const usage = ledger.consume({
      workspaceId: 'ws',
      resource: 'video',
      amount: 4,
      transactionId: 'usage-expiry-aware',
      actorId: 'owner',
      correlationId: 'corr',
      createdAt: '2026-07-19T00:00:00.000Z',
    });
    assert.deepEqual(usage.map(({ lotId, amount }) => ({ lotId, amount })), [
      { lotId: 'lot-active', amount: 4 },
    ]);

    const replay = ledger.consume({
      workspaceId: 'ws',
      resource: 'video',
      amount: 4,
      transactionId: 'usage-expiry-aware',
      actorId: 'owner',
      correlationId: 'corr-replay',
      createdAt: '2026-07-19T00:01:00.000Z',
    });
    assert.deepEqual(replay, usage);

    const before = ledger.listLots('ws', 'video');
    assert.throws(
      () =>
        ledger.consume({
          workspaceId: 'ws',
          resource: 'video',
          amount: 2,
          transactionId: 'usage-underfunded',
          actorId: 'owner',
          correlationId: 'corr-underfunded',
          createdAt: '2026-07-19T00:02:00.000Z',
        }),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === 'INSUFFICIENT_ENTITLEMENT'
    );
    assert.deepEqual(ledger.listLots('ws', 'video'), before);
    assert.equal(
      ledger
        .listTransactions('ws')
        .some((transaction) => transaction.id.startsWith('usage-underfunded')),
      false
    );
  });

  it('expires remaining allowance once and rebuilds the resource projection from transactions', () => {
    const ledger = new MemoryGrantLotLedger();
    ledger.grant({
      id: 'lot-trial',
      workspaceId: 'ws',
      resource: 'copy',
      amount: 10,
      expirationDate: '2026-07-19T00:00:00.000Z',
      transactionType: 'REGISTER_GIFT',
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    ledger.consume({
      workspaceId: 'ws',
      resource: 'copy',
      amount: 4,
      transactionId: 'usage-before-expiry',
      actorId: 'owner',
      correlationId: 'corr-usage',
      createdAt: '2026-07-18T00:00:00.000Z',
    });

    const expired = ledger.expireLots({
      workspaceId: 'ws',
      now: '2026-07-19T00:00:00.000Z',
      actorId: 'system',
      correlationId: 'corr-expire',
    });
    assert.equal(expired.length, 1);
    assert.equal(expired[0]?.transactionType, 'EXPIRE');
    assert.equal(expired[0]?.amount, 6);
    assert.equal(
      ledger.expireLots({
        workspaceId: 'ws',
        now: '2026-07-20T00:00:00.000Z',
        actorId: 'system',
        correlationId: 'corr-expire-replay',
      }).length,
      0
    );

    assert.deepEqual(
      ledger.rebuildProjection({
        workspaceId: 'ws',
        asOf: '2026-07-20T00:00:00.000Z',
        actorId: 'system',
        correlationId: 'corr-rebuild',
      }),
      [
        {
          resource: 'copy',
          grantedAmount: 10,
          usedAmount: 4,
          refundedAmount: 0,
          expiredAmount: 6,
          remainingAmount: 0,
        },
      ]
    );
  });

  it('caps a refund at the downgraded entitlement after prior usage', () => {
    const ledger = new MemoryGrantLotLedger();
    ledger.grant({
      id: 'lot-downgraded-refund',
      workspaceId: 'ws-downgraded-refund',
      resource: 'copy',
      amount: 10,
      expirationDate: '2026-08-01T00:00:00.000Z',
      transactionType: 'SUBSCRIPTION_RENEWAL',
      createdAt: '2026-07-19T00:00:00.000Z',
    });
    const [usage] = ledger.consume({
      workspaceId: 'ws-downgraded-refund',
      resource: 'copy',
      amount: 8,
      transactionId: 'usage-before-downgrade',
      actorId: 'owner',
      correlationId: 'corr-usage-before-downgrade',
      createdAt: '2026-07-19T01:00:00.000Z',
    });
    const expired = ledger.reconcileEntitlementLots({
      workspaceId: 'ws-downgraded-refund',
      resource: 'copy',
      lotIds: ['lot-downgraded-refund'],
      targetAmount: 5,
      expirationDate: '2026-08-01T00:00:00.000Z',
      operationId: 'downgrade-to-five',
      actorId: 'system',
      correlationId: 'corr-downgrade-to-five',
      asOf: '2026-07-19T02:00:00.000Z',
    });
    assert.equal(expired[0]?.amount, 2);
    assert.ok(usage);
    ledger.refundUsage({
      workspaceId: 'ws-downgraded-refund',
      usageTransactionId: usage.id,
      refundTransactionId: 'refund-after-downgrade',
      actorId: 'system',
      correlationId: 'corr-refund-after-downgrade',
      createdAt: '2026-07-19T03:00:00.000Z',
    });
    assert.equal(
      ledger.listLots('ws-downgraded-refund', 'copy')[0]?.remainingAmount,
      5
    );
  });

  it('carries usage debt across a same-period downgrade, upgrade, and partial refunds', () => {
    const ledger = new MemoryGrantLotLedger();
    const workspaceId = 'ws-period-debt';
    const expirationDate = '2026-08-01T00:00:00.000Z';
    ledger.grant({
      id: 'lot-period-opening',
      workspaceId,
      resource: 'copy',
      amount: 10,
      expirationDate,
      transactionType: 'SUBSCRIPTION_RENEWAL',
      createdAt: '2026-07-19T00:00:00.000Z',
    });
    const usages = Array.from({ length: 8 }, (_, index) =>
      ledger.consume({
        workspaceId,
        resource: 'copy',
        amount: 1,
        transactionId: `period-usage-${index}`,
        actorId: 'owner',
        correlationId: 'corr-period-usage',
        createdAt: `2026-07-19T0${index + 1}:00:00.000Z`,
      })[0]!
    );
    ledger.reconcileEntitlementLots({
      workspaceId,
      resource: 'copy',
      lotIds: ['lot-period-opening'],
      targetAmount: 5,
      expirationDate,
      operationId: 'period-downgrade-five',
      actorId: 'system',
      correlationId: 'corr-period-downgrade',
      asOf: '2026-07-19T10:00:00.000Z',
    });
    ledger.refundUsage({
      workspaceId,
      usageTransactionId: usages[0]!.id,
      refundTransactionId: 'period-partial-refund',
      actorId: 'system',
      correlationId: 'corr-period-partial-refund',
      createdAt: '2026-07-19T11:00:00.000Z',
    });
    assert.equal(ledger.listLots(workspaceId, 'copy')[0]?.remainingAmount, 0);

    ledger.grant({
      id: 'lot-period-upgrade',
      workspaceId,
      resource: 'copy',
      amount: 15,
      expirationDate,
      transactionType: 'SUBSCRIPTION_RENEWAL',
      createdAt: '2026-07-19T12:00:00.000Z',
    });
    ledger.reconcileEntitlementLots({
      workspaceId,
      resource: 'copy',
      lotIds: ['lot-period-opening', 'lot-period-upgrade'],
      targetAmount: 20,
      expirationDate,
      operationId: 'period-upgrade-twenty',
      actorId: 'system',
      correlationId: 'corr-period-upgrade',
      asOf: '2026-07-19T13:00:00.000Z',
    });
    assert.equal(
      ledger
        .listLots(workspaceId, 'copy')
        .reduce((total, lot) => total + lot.remainingAmount, 0),
      13
    );
  });

  it('closes an expired entitlement cap even when usage already consumed its balance', () => {
    const ledger = new MemoryGrantLotLedger();
    ledger.grant({
      id: 'lot-consumed-before-expiry',
      workspaceId: 'ws-consumed-before-expiry',
      resource: 'copy',
      amount: 1,
      expirationDate: '2026-07-20T00:00:00.000Z',
      transactionType: 'SUBSCRIPTION_RENEWAL',
      createdAt: '2026-07-19T00:00:00.000Z',
    });
    ledger.consume({
      workspaceId: 'ws-consumed-before-expiry',
      resource: 'copy',
      amount: 1,
      transactionId: 'consumed-before-expiry',
      actorId: 'owner',
      correlationId: 'corr-consumed-before-expiry',
      createdAt: '2026-07-19T01:00:00.000Z',
    });

    assert.deepEqual(
      ledger.expireLots({
        workspaceId: 'ws-consumed-before-expiry',
        now: '2026-07-20T00:00:00.000Z',
        actorId: 'system',
        correlationId: 'corr-expire-consumed',
      }),
      []
    );
    assert.equal(
      ledger.listLots('ws-consumed-before-expiry', 'copy')[0]
        ?.entitlementAmount,
      0
    );
  });

  it('serializes memory resource fences without self-locking inner lot writes', async () => {
    const ledger = new MemoryGrantLotLedger();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let signalFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      signalFirstEntered = resolve;
    });
    const first = ledger.withResourceLocks(
      'ws-memory-fence',
      ['image'],
      async () => {
        order.push('first-entered');
        signalFirstEntered();
        await firstRelease;
        ledger.grant({
          id: 'lot-memory-fence-first',
          workspaceId: 'ws-memory-fence',
          resource: 'image',
          amount: 1,
          expirationDate: null,
          transactionType: 'PURCHASE_PACKAGE',
          createdAt: '2026-07-19T00:00:00.000Z',
        });
        order.push('first-completed');
      }
    );
    await firstEntered;
    const second = ledger.withResourceLocks(
      'ws-memory-fence',
      ['image'],
      async () => {
        order.push('second-entered');
        ledger.grant({
          id: 'lot-memory-fence-second',
          workspaceId: 'ws-memory-fence',
          resource: 'image',
          amount: 1,
          expirationDate: null,
          transactionType: 'PURCHASE_PACKAGE',
          createdAt: '2026-07-19T01:00:00.000Z',
        });
      }
    );
    await Promise.resolve();
    assert.deepEqual(order, ['first-entered']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, [
      'first-entered',
      'first-completed',
      'second-entered',
    ]);
    assert.equal(ledger.listLots('ws-memory-fence', 'image').length, 2);
  });
});
