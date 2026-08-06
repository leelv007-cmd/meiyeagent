import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminOperationsTodoItems,
  countExceptionEvents,
  countPendingActions,
  countPendingRefundReviews,
  sumAdminOperationsTodoCounts,
} from './admin-operations-todo-model';
import type { PaymentRefundReviewItem } from '@/payment/payment-refunds';
import type { PendingAction } from '@meiye/contracts';
import { Routes } from '@/lib/routes';

const pendingActions: PendingAction[] = [
  {
    createdAt: '2026-08-06T01:00:00.000Z',
    kind: 'question',
    nodeId: 'node-1',
    questionOrApprovalRef: 'q-1',
    taskId: 'task-1',
    workflowId: 'workflow-1',
    workflowRevision: 1,
  },
  {
    createdAt: '2026-08-06T01:05:00.000Z',
    kind: 'question',
    nodeId: 'node-2',
    questionOrApprovalRef: 'q-2',
    taskId: 'task-2',
    workflowId: 'workflow-2',
    workflowRevision: 1,
  },
];

const refundReviews: PaymentRefundReviewItem[] = [
  {
    amount: '10.00',
    currency: 'HKD',
    dispositionActorUserId: null,
    dispositionNote: null,
    dispositionStatus: 'pending_review',
    eventStatus: 'succeeded',
    orderId: 'order-pending',
    provider: 'waffo',
    providerEventId: 'evt-pending',
    providerOccurredAt: '2026-08-06T00:00:00.000Z',
    receivedAt: '2026-08-06T00:00:01.000Z',
    resolvedAt: null,
  },
  {
    amount: '5.00',
    currency: 'HKD',
    dispositionActorUserId: 'admin',
    dispositionNote: 'ok',
    dispositionStatus: 'resolved',
    eventStatus: 'succeeded',
    orderId: 'order-resolved',
    provider: 'waffo',
    providerEventId: 'evt-resolved',
    providerOccurredAt: '2026-08-05T00:00:00.000Z',
    receivedAt: '2026-08-05T00:00:01.000Z',
    resolvedAt: '2026-08-05T01:00:00.000Z',
  },
];

test('todo counts project from the same payloads the pages already use', () => {
  const exceptionView = {
    exceptions: [{ rootCauseKey: 'a' }, { rootCauseKey: 'b' }],
  } as never;

  assert.equal(countPendingActions(pendingActions), 2);
  assert.equal(countPendingRefundReviews(refundReviews), 1);
  assert.equal(countExceptionEvents(exceptionView), 2);

  const items = buildAdminOperationsTodoItems({
    exceptionView,
    pendingActions,
    refundReviews,
  });

  assert.deepEqual(
    items.map((item) => [item.id, item.count, item.href]),
    [
      ['pending-actions', 2, Routes.Admin],
      ['refund-review', 1, Routes.AdminRefundReview],
      ['exceptions', 2, Routes.Admin],
    ]
  );
  assert.equal(sumAdminOperationsTodoCounts(items), 5);
});

test('missing payloads count as zero rather than inventing work', () => {
  const items = buildAdminOperationsTodoItems({});
  assert.equal(sumAdminOperationsTodoCounts(items), 0);
});
