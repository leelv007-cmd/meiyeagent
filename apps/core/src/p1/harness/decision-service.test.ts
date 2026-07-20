import assert from 'node:assert/strict';
import test from 'node:test';
import type { QuestionCard } from '@meiye/contracts';

import {
  HarnessDecisionError,
  HarnessDecisionResumeError,
  HarnessDecisionService,
  type HarnessDecisionStore,
} from './decision-service.js';

test('decision is persisted before the workflow is resumed', async () => {
  const order: string[] = [];
  const store = new MemoryDecisionStore(order);
  const service = new HarnessDecisionService(store, {
    async resume(_workspaceId, _taskId, command) {
      order.push(`resume:${command.questionId}`);
    },
  });

  const result = await service.submit('workspace-1', 'task-35', decisionInput());

  assert.equal(result.replayed, false);
  assert.deepEqual(order, [
    'persist:event-task-35-question-1-decision-1',
    'resume:question-1',
    'resumed:event-task-35-question-1-decision-1',
  ]);
  assert.equal(store.events.length, 1);
  assert.equal(store.traces.length, 1);
});

test('duplicate decision is idempotent and does not resume twice', async () => {
  const order: string[] = [];
  const store = new MemoryDecisionStore(order);
  const service = new HarnessDecisionService(store, {
    async resume(_workspaceId, _taskId, command) {
      order.push(`resume:${command.questionId}`);
    },
  });

  await service.submit('workspace-1', 'task-35', decisionInput());
  const replay = await service.submit('workspace-1', 'task-35', decisionInput());

  assert.equal(replay.replayed, true);
  assert.equal(store.events.length, 1);
  assert.deepEqual(order, [
    'persist:event-task-35-question-1-decision-1',
    'resume:question-1',
    'resumed:event-task-35-question-1-decision-1',
  ]);
});

test('a persisted decision retries a failed workflow resume', async () => {
  const order: string[] = [];
  const store = new MemoryDecisionStore(order);
  let attempts = 0;
  const service = new HarnessDecisionService(store, {
    async resume(_workspaceId, _taskId, command) {
      attempts += 1;
      order.push(`resume:${command.questionId}:${attempts}`);
      if (attempts === 1) throw new Error('DBOS unavailable');
    },
  });

  await assert.rejects(
    service.submit('workspace-1', 'task-35', decisionInput()),
    (error: unknown) =>
      error instanceof HarnessDecisionResumeError && error.status === 503,
  );
  const replay = await service.submit('workspace-1', 'task-35', decisionInput());

  assert.equal(replay.replayed, true);
  assert.equal(store.events.length, 1);
  assert.deepEqual(order, [
    'persist:event-task-35-question-1-decision-1',
    'resume:question-1:1',
    'resume:question-1:2',
    'resumed:event-task-35-question-1-decision-1',
  ]);
});

for (const outcome of [
  'stale_question',
  'stale_revision',
  'idempotency_conflict',
] as const) {
  test(`${outcome} is reported as 409`, async () => {
    const store = new MemoryDecisionStore([]);
    store.nextOutcome = outcome;
    const service = new HarnessDecisionService(store, {
      async resume() {},
    });

    await assert.rejects(
      service.submit('workspace-1', 'task-35', decisionInput()),
      (error: unknown) =>
        error instanceof HarnessDecisionError && error.status === 409
    );
  });
}

test('rejects a client patch that changes the authoritative question target', async () => {
  const store = new MemoryDecisionStore([]);
  store.pending = question();
  const service = new HarnessDecisionService(store, { async resume() {} });

  await assert.rejects(
    service.submit('workspace-1', 'task-35', {
      ...decisionInput(),
      patch: { ...decisionInput().patch, field: 'another_fact' },
    }),
    (error: unknown) =>
      error instanceof HarnessDecisionError &&
      error.code === 'DECISION_TARGET_MISMATCH' &&
      error.status === 409
  );
});

class MemoryDecisionStore implements HarnessDecisionStore {
  readonly events: Array<{ id: string }> = [];
  readonly traces: Array<{ id: string }> = [];
  private resumeRequired = true;
  nextOutcome:
    | 'created'
    | 'replayed'
    | 'stale_question'
    | 'stale_revision'
    | 'idempotency_conflict' = 'created';
  pending: QuestionCard | null = null;

  constructor(private readonly order: string[]) {}

  async submit(input: Parameters<HarnessDecisionStore['submit']>[0]) {
    const outcome = this.nextOutcome;
    if (outcome === 'created') {
      this.events.push(input.event);
      this.traces.push(input.trace);
      this.order.push(`persist:${input.event.id}`);
      this.nextOutcome = 'replayed';
    }
    return {
      outcome,
      resumeRequired:
        (outcome === 'created' || outcome === 'replayed') &&
        this.resumeRequired,
    };
  }

  async markDecisionResumed(
    _workspaceId: string,
    _taskId: string,
    eventId: string,
  ) {
    this.resumeRequired = false;
    this.order.push(`resumed:${eventId}`);
  }

  async readPending() {
    return this.pending;
  }

  async registerPending() {}
}

function decisionInput() {
  return {
    idempotencyKey: 'decision-1',
    questionId: 'question-1',
    workflowRevision: 4,
    patch: {
      field: 'offer_price',
      value: '当前团购价 398 元',
      reason: '补充当前任务所需的权威事实',
    },
    decision: {
      state: 'accepted' as const,
      value: '当前团购价 398 元',
    },
  };
}

function question(): QuestionCard {
  return {
    questionId: 'question-1',
    workflowId: 'task-35',
    workflowRevision: 4,
    question: '当前团购价是多少？',
    options: [],
    freeText: { enabled: true },
    response: {
      field: 'offer_price',
      reason: '补充当前任务所需的权威事实',
    },
    scope: 'current_task',
  };
}
