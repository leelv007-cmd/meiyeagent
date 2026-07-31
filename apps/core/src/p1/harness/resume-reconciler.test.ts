import assert from 'node:assert/strict';
import test from 'node:test';
import type { StructuredDecisionInput } from '@meiye/contracts';

import {
  HarnessResumeReconciler,
  type HarnessPendingResume,
  type HarnessResumeReconcilerStore,
} from './resume-reconciler.js';

test('pending resume is replayed with its persisted idempotency key', async () => {
  const pending = pendingResume();
  const store = new MemoryResumeStore([pending]);
  const resumed: StructuredDecisionInput[] = [];
  const reconciler = new HarnessResumeReconciler(store, {
    async resume(workspaceId, taskId, command) {
      void workspaceId;
      void taskId;
      resumed.push(command);
    },
    async resumeInteraction() {
      throw new Error('No interaction resume was expected.');
    },
  });

  assert.deepEqual(await reconciler.runOnce(), { resumed: 1, failed: 0 });
  assert.equal(resumed[0]?.idempotencyKey, 'decision-retry-1');
  assert.deepEqual(store.marked, ['decision-event-1']);
});

test('failed resume remains pending for the next reconciliation pass', async () => {
  const store = new MemoryResumeStore([pendingResume()]);
  const reconciler = new HarnessResumeReconciler(store, {
    async resume() {
      throw new Error('workflow runtime unavailable');
    },
    async resumeInteraction() {
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
    async resumeInteraction() {
      actions.push('unsafe-interaction-resume');
    },
  });

  assert.deepEqual(await reconciler.runOnce(), { resumed: 1, failed: 0 });
  assert.deepEqual(actions, [
    'successor:task-35:composer-task:late-answer-d3724871c13976fac6cae12b',
  ]);
  assert.deepEqual(store.marked, ['decision-event-1']);
});

test('interaction reconciliation dispatches its typed resume without using the legacy decision path', async () => {
  const pending = {
    claimId: 'interaction-claim-1',
    eventId: 'interaction-event-1',
    kind: 'interaction',
    workspaceId: 'workspace-a',
    taskId: 'task-35',
    resolutionSource: 'system_default',
    resume: {
      kind: 'harness_interaction_resume',
      schemaVersion: 'v1',
      idempotencyKey: 'interaction-default-1',
      interactionKind: 'ask_merchant',
      requestId: 'interaction-request-1',
      revision: 1,
      runId: 'task-35',
      step: 'context_injection',
      resumeData: {
        kind: 'answer',
        items: [
          {
            itemId: 'window',
            result: { kind: 'deferred' },
          },
        ],
      },
      resolutionSource: 'system_default',
    },
  } satisfies HarnessPendingResume;
  const store = new MemoryResumeStore([pending]);
  const actions: string[] = [];
  const reconciler = new HarnessResumeReconciler(
    store,
    {
      async resume() {
        actions.push('unsafe-legacy-decision-resume');
      },
      async resumeInteraction(_workspaceId: string, _taskId: string, signal: {
        idempotencyKey: string;
      }) {
        actions.push(`interaction:${signal.idempotencyKey}`);
      },
    },
  );

  assert.deepEqual(await reconciler.runOnce(), { resumed: 1, failed: 0 });
  assert.deepEqual(actions, ['interaction:interaction-default-1']);
  assert.deepEqual(store.marked, ['interaction-event-1']);
});

test('the existing reconciler owns targeted interaction resume claims', async () => {
  const pending = {
    claimId: 'interaction-claim-targeted',
    eventId: 'interaction-event-targeted',
    kind: 'interaction',
    workspaceId: 'workspace-a',
    taskId: 'task-35',
    resolutionSource: 'decision',
    resume: {
      kind: 'harness_interaction_resume',
      schemaVersion: 'v1',
      idempotencyKey: 'interaction-answer-targeted',
      interactionKind: 'execution_confirmation',
      requestId: 'interaction-request-targeted',
      revision: 2,
      runId: 'task-35',
      step: 'execution_selection',
      resumeData: { kind: 'approved' },
      resolutionSource: 'decision',
    },
  } satisfies HarnessPendingResume;
  const store = new MemoryResumeStore([pending]);
  const actions: string[] = [];
  const reconciler = new HarnessResumeReconciler(store, {
    async resume() {
      throw new Error('The legacy decision path must not be used.');
    },
    async resumeInteraction(_workspaceId, _taskId, signal) {
      actions.push(signal.idempotencyKey);
    },
  });

  assert.equal(
    await reconciler.resumeEvent('interaction-event-targeted'),
    true,
  );
  assert.deepEqual(actions, ['interaction-answer-targeted']);
  assert.deepEqual(store.targeted, ['interaction-event-targeted']);
  assert.deepEqual(store.marked, ['interaction-event-targeted']);
});

test('a malformed event is quarantined without blocking the next valid resume', async () => {
  const malformed = {
    claimId: 'malformed-claim-1',
    eventId: 'malformed-event-1',
    kind: 'malformed',
    workspaceId: 'workspace-a',
    taskId: 'task-bad',
  } satisfies HarnessPendingResume;
  const valid = pendingResume();
  const store = new MemoryResumeStore([malformed, valid]);
  const resumed: string[] = [];
  const reconciler = new HarnessResumeReconciler(store, {
    async resume(_workspaceId, taskId) {
      resumed.push(taskId);
    },
    async resumeInteraction() {
      throw new Error('No interaction resume was expected.');
    },
  });

  assert.deepEqual(await reconciler.runOnce(), { resumed: 1, failed: 1 });
  assert.deepEqual(resumed, ['task-35']);
  assert.deepEqual(store.invalid, ['malformed-event-1']);
  assert.deepEqual(store.released, []);
});

class MemoryResumeStore implements HarnessResumeReconcilerStore {
  readonly marked: string[] = [];
  readonly released: string[] = [];
  readonly invalid: string[] = [];
  readonly targeted: string[] = [];

  constructor(private readonly pending: HarnessPendingResume[]) {}

  async claimPending() {
    const next = this.pending.shift();
    return next ? [structuredClone(next)] : [];
  }

  async claimEvent(eventId: string) {
    this.targeted.push(eventId);
    const index = this.pending.findIndex((item) => item.eventId === eventId);
    if (index < 0) return null;
    return structuredClone(this.pending.splice(index, 1)[0]!);
  }

  async markResumed(eventId: string) {
    this.marked.push(eventId);
    return true;
  }

  async release(eventId: string) {
    this.released.push(eventId);
  }

  async markInvalid(eventId: string) {
    this.invalid.push(eventId);
    return true;
  }
}

function pendingResume(): Extract<
  HarnessPendingResume,
  { kind: 'structured_decision' }
> {
  return {
    claimId: 'resume-claim-1',
    eventId: 'decision-event-1',
    kind: 'structured_decision',
    reservationReleased: false,
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
