import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessBillingCompensationWorker,
  type HarnessBillingCompensationTask,
} from './billing-compensation.js';

test('billing worker rebuilds orphan owners before claiming its batch', async () => {
  const order: string[] = [];
  const task: HarnessBillingCompensationTask = {
    action: 'refund',
    attempts: 1,
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    billingTaskId: 'task-1',
    billingIdentity: {
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      workId: 'work-1',
      workflowId: 'task-1',
      quoteRef: { id: 'quote-1', revision: 'revision-1' },
      reservationId: 'consume:task:task-1',
      carrierUnitId: 'single',
      carrierUnitIds: ['single'],
      carrierBillableUnits: 1,
    },
    quoteId: 'quote-1',
    quoteRevision: 'revision-1',
  };
  const worker = new HarnessBillingCompensationWorker(
    {
      async enqueue() {},
      async recoverOrphans(limit) {
        order.push(`recover:${limit}`);
        return 1;
      },
      async claimBatch(limit) {
        order.push(`claim:${limit}`);
        return [task];
      },
      async markCompleted() {
        order.push('completed');
      },
      async markFailed() {
        order.push('failed');
      },
    },
    {
      async commit() {},
      async refund() {
        order.push('refund');
      },
    },
    { batchSize: 7 },
  );

  assert.deepEqual(await worker.runOnce(), { completed: 1, failed: 0 });
  assert.deepEqual(order, [
    'recover:7',
    'claim:7',
    'refund',
    'completed',
  ]);
});
