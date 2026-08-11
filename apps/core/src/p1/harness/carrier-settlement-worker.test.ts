import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ClaimedReadyWorkSettlement,
  HarnessCarrierSettlementRecoveryStore,
} from './carrier-settlement-coordinator.js';
import { HarnessCarrierSettlementWorker } from './carrier-settlement-worker.js';

function readyWork(): ClaimedReadyWorkSettlement {
  return {
    aggregateKey: 'billing-work:d29ya3NwYWNl:dGFzaw:d29yaw:cXVvdGU:cmV2:cmVzZXJ2YXRpb24:Y29weQ',
    claimToken: 'claim-1',
    action: 'commit',
    settlement: {
      workspaceId: 'workspace',
      taskId: 'workflow-copy',
      billingTaskId: 'task',
      billingIdentity: {
        workspaceId: 'workspace',
        taskId: 'task',
        workId: 'work',
        workflowId: 'workflow-copy',
        quoteRef: { id: 'quote', revision: 'rev' },
        reservationId: 'reservation',
        carrierUnitId: 'copy',
        carrierUnitIds: ['copy'],
        carrierBillableUnits: 1,
      },
      quoteId: 'quote',
      quoteRevision: 'rev',
    },
  };
}

function recoveryStore(input: {
  claimed: ClaimedReadyWorkSettlement[];
  onComplete?: (value: unknown) => void;
  onFailed?: (value: unknown) => void;
}): HarnessCarrierSettlementRecoveryStore {
  return {
    async recordCarrierTerminal() {
      return null;
    },
    async claimReadyWorkSettlements() {
      return input.claimed;
    },
    async markWorkSettled(value) {
      input.onComplete?.(value);
    },
    async markWorkSettlementFailed(value) {
      input.onFailed?.(value);
    },
  };
}

test('ready work settlement worker acknowledges only its leased aggregate', async () => {
  const ready = readyWork();
  const completed: unknown[] = [];
  const settled: unknown[] = [];
  const worker = new HarnessCarrierSettlementWorker(
    recoveryStore({
      claimed: [ready],
      onComplete: (value) => completed.push(value),
    }),
    {
      async settleReadyWork(value) {
        settled.push(value);
      },
    },
  );

  assert.deepEqual(await worker.runOnce(), {
    claimed: 1,
    completed: 1,
    failed: 0,
  });
  assert.deepEqual(settled, [ready]);
  assert.deepEqual(completed, [
    {
      workspaceId: 'workspace',
      aggregateKey: ready.aggregateKey,
      claimToken: ready.claimToken,
    },
  ]);
});

test('ready work settlement worker returns a failed lease to the outbox', async () => {
  const ready = readyWork();
  const failures: unknown[] = [];
  const worker = new HarnessCarrierSettlementWorker(
    recoveryStore({
      claimed: [ready],
      onFailed: (value) => failures.push(value),
    }),
    {
      async settleReadyWork() {
        throw new Error('aggregate billing unavailable');
      },
    },
    {
      now: () => new Date('2026-08-11T00:00:00.000Z'),
      retryDelayMs: 5_000,
    },
  );

  assert.deepEqual(await worker.runOnce(), {
    claimed: 1,
    completed: 0,
    failed: 1,
  });
  assert.deepEqual(failures, [
    {
      workspaceId: 'workspace',
      aggregateKey: ready.aggregateKey,
      claimToken: ready.claimToken,
      error: 'aggregate billing unavailable',
      retryAt: new Date('2026-08-11T00:00:05.000Z'),
    },
  ]);
});
