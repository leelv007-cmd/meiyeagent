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

test('concurrent duplicate decisions claim one workflow resume', async () => {
  const order: string[] = [];
  const store = new MemoryDecisionStore(order);
  let releaseResume!: () => void;
  const resumeBlocked = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  let resumes = 0;
  const service = new HarnessDecisionService(store, {
    async resume() {
      resumes += 1;
      await resumeBlocked;
    },
  });

  const first = service.submit('workspace-1', 'task-35', decisionInput());
  const second = service.submit('workspace-1', 'task-35', decisionInput());
  await new Promise((resolve) => setImmediate(resolve));
  releaseResume();
  const results = await Promise.all([first, second]);

  assert.equal(resumes, 1);
  assert.equal(store.events.length, 1);
  assert.equal(store.traces.length, 1);
  assert.deepEqual(
    results.map((result) => result.replayed).sort(),
    [false, true],
  );
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

test('core timeout shares persistence but never sends a decision to its own workflow', async () => {
  const order: string[] = [];
  const store = new MemoryDecisionStore(order);
  store.pending = question();
  const service = new HarnessDecisionService(store, {
    async resume() {
      order.push('unexpected-resume');
    },
  });

  const result = await service.submitCoreTimeout(
    'workspace-1',
    'task-35',
    coreTimeoutInput(),
  );

  assert.equal(result.replayed, false);
  assert.deepEqual(order, [
    'persist:event-task-35-question-1-question-1:r4:core_timeout',
  ]);
  assert.equal(store.events.length, 1);
  assert.equal(store.traces.length, 1);
});

test('a frontend winner makes the concurrent core timeout converge without failing', async () => {
  const store = new MemoryDecisionStore([]);
  store.pending = question();
  store.nextOutcome = 'stale_question';
  const service = new HarnessDecisionService(store, { async resume() {} });

  assert.deepEqual(
    await service.submitCoreTimeout(
      'workspace-1',
      'task-35',
      coreTimeoutInput(),
    ),
    {
      consumedByOther: true,
      eventId: null,
      replayed: true,
    },
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
      command: input.command,
      resumeRequired:
        (outcome === 'created' || outcome === 'replayed') &&
        this.resumeRequired &&
        input.mode !== 'core_timeout',
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

  async claimDecisionResume() {
    if (!this.resumeRequired) return false;
    this.resumeRequired = false;
    return true;
  }

  async releaseDecisionResume() {
    this.resumeRequired = true;
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

function coreTimeoutInput() {
  return {
    idempotencyKey: 'question-1:r4:core_timeout',
    questionId: 'question-1',
    workflowRevision: 4,
    patch: {
      field: 'offer_price',
      value: '超时未作答，已按通用口径继续',
      reason: '补充当前任务所需的权威事实',
    },
    decision: {
      state: 'ignored' as const,
      value: '超时未作答，已按通用口径继续',
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
