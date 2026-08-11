import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessReservationSweeper,
  type HarnessReservationSweep,
  type HarnessReservationSweepStore,
} from './reservation-sweeper.js';
import type { HarnessBillingSettlementExecutor } from './billing-compensation.js';

const sweep: HarnessReservationSweep = {
  workspaceId: 'workspace-sweep',
  taskId: 'task-sweep',
  billingTaskId: 'task-sweep',
  billingIdentity: {
    workspaceId: 'workspace-sweep',
    taskId: 'task-sweep',
    workId: 'work-sweep',
    workflowId: 'task-sweep',
    quoteRef: { id: 'quote-sweep', revision: 'quote-r1' },
    reservationId: 'consume:task:task-sweep',
    carrierUnitId: 'single',
    carrierUnitIds: ['single'],
    carrierBillableUnits: 1,
  },
  quoteId: 'quote-sweep',
  quoteRevision: 'quote-r1',
  questionId: 'question-sweep',
  usageReservationId: 'usage-sweep',
  reservedUnits: [{ resource: 'image', quantity: 2 }],
  heldSince: '2026-07-25T00:00:00.000Z',
  reason: 'hold_reservation_ttl_elapsed',
  attempts: 1,
};

test('expired hold reservation is refunded and completion remains idempotent', async () => {
  const store = new MemorySweepStore([[sweep]]);
  const billing = new RecordingBilling();
  const worker = new HarnessReservationSweeper(store, billing, {
    now: () => new Date('2026-07-28T00:00:00.000Z'),
    reservationTtlSeconds: 48 * 60 * 60,
  });

  assert.deepEqual(
    await worker.runOnce({
      workspaceId: 'workspace-sweep',
      taskId: 'task-sweep',
    }),
    {
      claimed: 1,
      completed: 1,
      failed: 0,
    },
  );
  assert.equal(billing.refundCalls, 1);
  assert.deepEqual(store.completed, ['task-sweep']);
  assert.deepEqual(store.claimInputs, [
    {
      expiresBefore: '2026-07-26T00:00:00.000Z',
      limit: 20,
      taskId: 'task-sweep',
      workspaceId: 'workspace-sweep',
    },
  ]);
});

test('expired hold is fed back to the exact suspended workflow before completion', async () => {
  const store = new MemorySweepStore([[sweep]]);
  const billing = new RecordingBilling();
  const expired: Array<{ questionId: string; taskId: string }> = [];
  const worker = new HarnessReservationSweeper(store, billing, {
    async expireHold(input) {
      expired.push({ questionId: input.questionId, taskId: input.taskId });
      assert.deepEqual(store.completed, []);
    },
  });

  assert.deepEqual(await worker.runOnce(), {
    claimed: 1,
    completed: 1,
    failed: 0,
  });
  assert.deepEqual(expired, [
    { questionId: 'question-sweep', taskId: 'task-sweep' },
  ]);
  assert.deepEqual(store.completed, ['task-sweep']);
});

test('refund preserves separate workflow and billing task coordinates', async () => {
  const splitSweep = {
    ...sweep,
    taskId: 'workflow-task-sweep:plan-r1',
    billingTaskId: 'billing-task-sweep',
  };
  const store = new MemorySweepStore([[splitSweep]]);
  const billing = new RecordingBilling();
  const expired: string[] = [];
  const worker = new HarnessReservationSweeper(store, billing, {
    async expireHold(input) {
      expired.push(input.taskId);
    },
  });

  assert.deepEqual(await worker.runOnce(), {
    claimed: 1,
    completed: 1,
    failed: 0,
  });
  assert.deepEqual(
    {
      taskId: billing.refunds[0]?.taskId,
      billingTaskId: billing.refunds[0]?.billingTaskId,
    },
    {
      taskId: 'workflow-task-sweep:plan-r1',
      billingTaskId: 'billing-task-sweep',
    },
  );
  assert.deepEqual(expired, ['workflow-task-sweep:plan-r1']);
  assert.deepEqual(store.completed, ['workflow-task-sweep:plan-r1']);
});

test('a current hold produces no refund side effect', async () => {
  const store = new MemorySweepStore([]);
  const billing = new RecordingBilling();
  const worker = new HarnessReservationSweeper(store, billing, {
    now: () => new Date('2026-07-28T00:00:00.000Z'),
  });

  assert.deepEqual(await worker.runOnce(), {
    claimed: 0,
    completed: 0,
    failed: 0,
  });
  assert.equal(billing.refundCalls, 0);
  assert.deepEqual(store.completed, []);
  assert.deepEqual(store.claimInputs, [
    {
      expiresBefore: '2026-07-21T00:00:00.000Z',
      limit: 20,
    },
  ]);
});

test('a refund failure before ledger mutation releases the sweep fence so the hold can still be answered', async () => {
  const store = new MemorySweepStore([[sweep]]);
  const worker = new HarnessReservationSweeper(store, {
    async commit() {
      throw new Error('reservation sweeper never commits usage');
    },
    async refund() {
      throw new Error('billing is temporarily unavailable');
    },
  });

  assert.deepEqual(await worker.runOnce(), {
    claimed: 1,
    completed: 0,
    failed: 1,
  });
  assert.deepEqual(store.failed, [
    { phase: 'refund', taskId: 'task-sweep' },
  ]);
});

test('a persisted post-refund claim retries the same billing identity after completion failure', async () => {
  const store = new MemorySweepStore([
    [sweep],
    [{ ...sweep, attempts: 2 }],
  ]);
  store.failCompletionOnce = true;
  const billing = new RecordingBilling();
  const worker = new HarnessReservationSweeper(store, billing);

  assert.deepEqual(await worker.runOnce(), {
    claimed: 1,
    completed: 0,
    failed: 1,
  });
  assert.deepEqual(await worker.runOnce(), {
    claimed: 1,
    completed: 1,
    failed: 0,
  });
  assert.equal(billing.refundCalls, 2);
  assert.deepEqual(
    billing.refunds.map(({ attempts, taskId, usageReservationId }) => ({
      attempts,
      taskId,
      usageReservationId,
    })),
    [
      {
        attempts: 1,
        taskId: 'task-sweep',
        usageReservationId: 'usage-sweep',
      },
      {
        attempts: 2,
        taskId: 'task-sweep',
        usageReservationId: 'usage-sweep',
      },
    ],
  );
  assert.deepEqual(store.completed, ['task-sweep']);
});

class MemorySweepStore implements HarnessReservationSweepStore {
  readonly claimInputs: Array<{
    expiresBefore: string;
    limit: number;
    taskId?: string;
    workspaceId?: string;
  }> = [];
  readonly completed: string[] = [];
  readonly failed: Array<{
    phase: 'completion' | 'refund';
    taskId: string;
  }> = [];
  failCompletionOnce = false;

  constructor(private readonly batches: HarnessReservationSweep[][]) {}

  async claimBatch(input: {
    expiresBefore: string;
    limit: number;
    taskId?: string;
    workspaceId?: string;
  }) {
    this.claimInputs.push(input);
    return this.batches.shift() ?? [];
  }

  async markCompleted(input: HarnessReservationSweep) {
    if (this.failCompletionOnce) {
      this.failCompletionOnce = false;
      throw new Error('simulated crash before completion');
    }
    if (!this.completed.includes(input.taskId)) {
      this.completed.push(input.taskId);
    }
  }

  async markFailed(
    input: HarnessReservationSweep,
    _error: string,
    phase: 'completion' | 'refund',
  ) {
    this.failed.push({ phase, taskId: input.taskId });
  }
}

class RecordingBilling implements HarnessBillingSettlementExecutor {
  refundCalls = 0;
  readonly refunds: HarnessReservationSweep[] = [];

  async commit() {
    throw new Error('reservation sweeper never commits usage');
  }

  async refund(input: HarnessReservationSweep) {
    this.refundCalls += 1;
    this.refunds.push(structuredClone(input));
  }
}
