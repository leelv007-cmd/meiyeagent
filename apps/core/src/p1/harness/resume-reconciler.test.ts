import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessResumeReconciler,
  type HarnessPendingResume,
  type HarnessResumeReconcilerStore,
} from './resume-reconciler.js';

test('pending resume is replayed with its persisted idempotency key', async () => {
  const pending = pendingResume();
  const store = new MemoryResumeStore([pending]);
  const resumed: HarnessPendingResume[] = [];
  const reconciler = new HarnessResumeReconciler(store, {
    async resume(workspaceId, taskId, command) {
      resumed.push({ eventId: pending.eventId, workspaceId, taskId, command });
    },
  });

  assert.deepEqual(await reconciler.runOnce(), { resumed: 1, failed: 0 });
  assert.equal(resumed[0]?.command.idempotencyKey, 'decision-retry-1');
  assert.deepEqual(store.marked, ['decision-event-1']);
});

test('failed resume remains pending for the next reconciliation pass', async () => {
  const store = new MemoryResumeStore([pendingResume()]);
  const reconciler = new HarnessResumeReconciler(store, {
    async resume() {
      throw new Error('workflow runtime unavailable');
    },
  });

  assert.deepEqual(await reconciler.runOnce(), { resumed: 0, failed: 1 });
  assert.deepEqual(store.marked, []);
});

class MemoryResumeStore implements HarnessResumeReconcilerStore {
  readonly marked: string[] = [];

  constructor(private readonly pending: HarnessPendingResume[]) {}

  async listPending() {
    return structuredClone(this.pending);
  }

  async markResumed(eventId: string) {
    this.marked.push(eventId);
  }
}

function pendingResume(): HarnessPendingResume {
  return {
    eventId: 'decision-event-1',
    workspaceId: 'workspace-a',
    taskId: 'task-35',
    command: {
      idempotencyKey: 'decision-retry-1',
      questionId: 'question-1',
      workflowRevision: 4,
      patch: {
        field: 'offer_price',
        reason: '补充当前任务所需的权威事实',
        value: '当前团购价 398 元',
      },
      decision: {
        state: 'accepted',
        value: '当前团购价 398 元',
      },
    },
  };
}
