import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductUsageRecord } from '@meiye/contracts';

import {
  productUsageRefundLanded,
  projectActionUsage,
} from './action-usage.js';

function usage(
  overrides: Partial<ProductUsageRecord> = {},
): ProductUsageRecord {
  return {
    id: 'usage-record-248',
    taskId: 'task-248',
    workspaceId: 'workspace-248',
    quoteId: 'quote-248',
    status: 'committed',
    reservedQuantity: 3,
    reservedUnits: [{ resource: 'copy', quantity: 3 }],
    settledQuantity: 2,
    settledUnits: [{ resource: 'copy', quantity: 2 }],
    refundedQuantity: 1,
    refundedUnits: [{ resource: 'copy', quantity: 1 }],
    billingMode: 'per_request',
    settlementStatus: 'reconciled',
    createdAt: '2026-07-29T08:00:00.000Z',
    updatedAt: '2026-07-29T08:01:00.000Z',
    ...overrides,
  };
}

test('projects completed action usage from the final product settlement', () => {
  assert.deepEqual(projectActionUsage(usage(), 'completed'), {
    actionId: 'usage-record-248',
    taskId: 'task-248',
    status: 'completed',
    settlementStatus: 'reconciled',
    settledUnits: 2,
    refundedUnits: 1,
  });
});

test('projects rejected usage only when final merchant settlement is zero', () => {
  assert.deepEqual(
    projectActionUsage(
      usage({
        status: 'refunded',
        settledQuantity: 0,
        settledUnits: [],
        refundedQuantity: 3,
        refundedUnits: [{ resource: 'copy', quantity: 3 }],
      }),
      'rejected',
    ),
    {
      actionId: 'usage-record-248',
      taskId: 'task-248',
      status: 'rejected',
      settlementStatus: 'reconciled',
      settledUnits: 0,
      refundedUnits: 3,
    },
  );

  assert.throws(
    () => projectActionUsage(usage(), 'rejected'),
    /Rejected actions must settle zero merchant units/u,
  );
});

test('does not expose reserved usage as final action usage', () => {
  assert.equal(
    projectActionUsage(
      usage({
        status: 'reserved',
        settledQuantity: 0,
        settledUnits: [],
        refundedQuantity: 0,
        refundedUnits: [],
        settlementStatus: 'estimated',
      }),
      'completed',
    ),
    null,
  );
});

test('credit-era full refund lands without unit quantity', () => {
  assert.equal(
    productUsageRefundLanded(
      usage({
        status: 'refunded',
        reservedQuantity: 0,
        reservedUnits: [],
        settledQuantity: 0,
        settledUnits: [],
        refundedQuantity: 0,
        refundedUnits: [],
        reservedCredits: 12,
        settledCredits: 0,
        refundedCredits: 12,
      }),
    ),
    true,
  );
  assert.equal(
    productUsageRefundLanded(
      usage({
        status: 'reserved',
        settledQuantity: 0,
        settledUnits: [],
        refundedQuantity: 0,
        refundedUnits: [],
        reservedCredits: 12,
        settlementStatus: 'estimated',
      }),
    ),
    false,
  );
});
