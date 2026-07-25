import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { P1DomainError } from '../foundation/domain.js';
import { MemoryProductUsageLedger } from './product-usage-ledger.js';

describe('MemoryProductUsageLedger product units', () => {
  it('reserves and settles whole video seconds', () => {
    const ledger = new MemoryProductUsageLedger();
    const reserved = ledger.reserve({
      id: 'usage-1',
      taskId: 'task-1',
      workspaceId: 'ws-1',
      quoteId: 'quote-1',
      units: [{ resource: 'video', quantity: 10 }],
      billingMode: 'per_output_second',
      createdAt: '2026-07-20T12:00:00.000Z',
    });
    assert.equal(reserved.reservedQuantity, 10);
    assert.equal(reserved.status, 'reserved');

    const settled = ledger.settle({
      taskId: 'task-1',
      settledUnits: [{ resource: 'video', quantity: 4 }],
      settlementStatus: 'reconciled',
      updatedAt: '2026-07-20T12:01:00.000Z',
    });
    assert.equal(settled.settledQuantity, 4);
    assert.equal(settled.refundedQuantity, 6);
    assert.equal(settled.status, 'partially_refunded');
  });

  it('rejects settle above reserved ceiling (no silent surcharge)', () => {
    const ledger = new MemoryProductUsageLedger();
    ledger.reserve({
      id: 'usage-2',
      taskId: 'task-2',
      workspaceId: 'ws-1',
      quoteId: 'quote-2',
      units: [{ resource: 'copy', quantity: 1 }],
      billingMode: 'per_request',
      createdAt: '2026-07-20T12:00:00.000Z',
    });
    assert.throws(
      () =>
        ledger.settle({
          taskId: 'task-2',
          settledUnits: [{ resource: 'copy', quantity: 2 }],
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
      units: [{ resource: 'copy', quantity: 1 }],
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
          units: [{ resource: 'copy', quantity: 2 }],
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
      units: [],
      billingMode: 'per_request',
      createdAt: '2026-07-20T12:00:00.000Z',
    });
    const zeroSettled = ledger.settle({
      taskId: 'task-0',
      settledUnits: [],
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
      units: [{ resource: 'copy', quantity: 1 }],
      billingMode: 'per_request',
      createdAt: '2026-07-20T12:00:00.000Z',
    });
    const oneSettled = ledger.settle({
      taskId: 'task-1unit',
      settledUnits: [{ resource: 'copy', quantity: 1 }],
      settlementStatus: 'reconciled',
      updatedAt: '2026-07-20T12:01:00.000Z',
    });
    assert.equal(oneSettled.status, 'committed');
    assert.equal(oneSettled.settledQuantity, 1);
  });
});
