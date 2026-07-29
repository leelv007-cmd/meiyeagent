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
      resumed.push({
        claimId: pending.claimId,
        eventId: pending.eventId,
        workspaceId,
        taskId,
        command,
        resolutionSource: 'decision',
      });
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
  assert.deepEqual(store.released, ['decision-event-1']);
});

test('late answer reconciliation creates the C1 successor instead of messaging the expired workflow', async () => {
  const pending = {
    ...pendingResume(),
    request: {
      actorId: 'merchant-a',
      workspaceId: 'workspace-a',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized' as const,
      rawInput: '补充团购价',
      intent: {
        assetReferences: [],
        context: {
          workId: 'work-1',
          intent: '补充团购价',
          sourceSummaries: [],
        },
      },
    },
    resolutionSource: 'late_answer' as const,
  };
  const store = new MemoryResumeStore([pending]);
  const actions: string[] = [];
  const reconciler = new HarnessResumeReconciler(store, {
    async resume() {
      actions.push('unsafe-old-workflow-message');
    },
    async startSuccessor(input) {
      actions.push(`successor:${input.sourceTaskId}:${input.workflowId}`);
    },
  });

  assert.deepEqual(await reconciler.runOnce(), { resumed: 1, failed: 0 });
  assert.deepEqual(actions, [
    'successor:task-35:composer-task:late-answer-d3724871c13976fac6cae12b',
  ]);
  assert.deepEqual(store.marked, ['decision-event-1']);
});

class MemoryResumeStore implements HarnessResumeReconcilerStore {
  readonly marked: string[] = [];
  readonly released: string[] = [];

  constructor(private readonly pending: HarnessPendingResume[]) {}

  async claimPending() {
    const next = this.pending.shift();
    return next ? [structuredClone(next)] : [];
  }

  async markResumed(eventId: string) {
    this.marked.push(eventId);
    return true;
  }

  async release(eventId: string) {
    this.released.push(eventId);
  }
}

function pendingResume(): HarnessPendingResume {
  return {
    claimId: 'resume-claim-1',
    eventId: 'decision-event-1',
    workspaceId: 'workspace-a',
    taskId: 'task-35',
    resolutionSource: 'decision',
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
