import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { P1DomainError } from '../foundation/domain.js';
import { MemoryProductUsageLedger } from './product-usage-ledger.js';

describe('MemoryProductUsageLedger fractional units', () => {
  it('reserves and settles fractional product units for per_output_second', () => {
    const ledger = new MemoryProductUsageLedger();
    const reserved = ledger.reserve({
      id: 'usage-1',
      taskId: 'task-1',
      workspaceId: 'ws-1',
      quoteId: 'quote-1',
      quantity: 5.5,
      billingMode: 'per_output_second',
      resource: 'video',
      createdAt: '2026-07-20T12:00:00.000Z',
    });
    assert.equal(reserved.reservedQuantity, 5.5);
    assert.equal(reserved.status, 'reserved');

    const settled = ledger.settle({
      taskId: 'task-1',
      settledQuantity: 3.25,
      settlementStatus: 'reconciled',
      updatedAt: '2026-07-20T12:01:00.000Z',
    });
    assert.equal(settled.settledQuantity, 3.25);
    assert.equal(settled.refundedQuantity, 2.25);
    assert.equal(settled.status, 'partially_refunded');
  });

  it('rejects settle above reserved ceiling (no silent surcharge)', () => {
    const ledger = new MemoryProductUsageLedger();
    ledger.reserve({
      id: 'usage-2',
      taskId: 'task-2',
      workspaceId: 'ws-1',
      quoteId: 'quote-2',
      quantity: 1,
      billingMode: 'per_request',
      createdAt: '2026-07-20T12:00:00.000Z',
    });
    assert.throws(
      () =>
        ledger.settle({
          taskId: 'task-2',
          settledQuantity: 2,
          settlementStatus: 'reconciled',
          updatedAt: '2026-07-20T12:01:00.000Z',
        }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE',
    );
  });

  it('one task one reserve — conflict on different quantity', () => {
    const ledger = new MemoryProductUsageLedger();
    ledger.reserve({
      id: 'usage-3',
      taskId: 'task-3',
      workspaceId: 'ws-1',
      quoteId: 'quote-3',
      quantity: 1,
      billingMode: 'per_request',
      createdAt: '2026-07-20T12:00:00.000Z',
    });
    assert.throws(
      () =>
        ledger.reserve({
          id: 'usage-3b',
          taskId: 'task-3',
          workspaceId: 'ws-1',
          quoteId: 'quote-3',
          quantity: 2,
          billingMode: 'per_request',
          createdAt: '2026-07-20T12:00:00.000Z',
        }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'IDEMPOTENCY_CONFLICT',
    );
  });

  it('supports legacy 0|1 per_request units', () => {
    const ledger = new MemoryProductUsageLedger();
    // quantity 0 (probe / delegated settle) → settle 0 is committed, not a refund
    ledger.reserve({
      id: 'usage-0',
      taskId: 'task-0',
      workspaceId: 'ws-1',
      quoteId: 'quote-0',
      quantity: 0,
      billingMode: 'per_request',
      createdAt: '2026-07-20T12:00:00.000Z',
    });
    const zeroSettled = ledger.settle({
      taskId: 'task-0',
      settledQuantity: 0,
      settlementStatus: 'reconciled',
      updatedAt: '2026-07-20T12:01:00.000Z',
    });
    assert.equal(zeroSettled.status, 'committed');
    assert.equal(zeroSettled.settledQuantity, 0);

    ledger.reserve({
      id: 'usage-1',
      taskId: 'task-1unit',
      workspaceId: 'ws-1',
      quoteId: 'quote-1unit',
      quantity: 1,
      billingMode: 'per_request',
      createdAt: '2026-07-20T12:00:00.000Z',
    });
    const oneSettled = ledger.settle({
      taskId: 'task-1unit',
      settledQuantity: 1,
      settlementStatus: 'reconciled',
      updatedAt: '2026-07-20T12:01:00.000Z',
    });
    assert.equal(oneSettled.status, 'committed');
    assert.equal(oneSettled.settledQuantity, 1);
  });
});
