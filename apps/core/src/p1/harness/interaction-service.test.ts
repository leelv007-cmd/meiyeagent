import assert from 'node:assert/strict';
import test from 'node:test';

import {
  askMerchantAnswerSchema,
  askMerchantQuestionRequestSchema,
  executionConfirmationAnswerSchema,
  executionConfirmationRequestSchema,
} from '@meiye/contracts';

import {
  HarnessInteractionService,
  type HarnessInteractionPendingProjection,
  type HarnessInteractionStore,
} from './interaction-service.js';

test('interaction answers persist before one resume with the canonical triple', async () => {
  const order: string[] = [];
  const store = new MemoryInteractionStore(order);
  const request = askMerchantQuestionRequestSchema.parse({
    requestId: 'request-1',
    runId: 'run-1',
    step: 'context_injection',
    revision: 1,
    kind: 'ask_merchant',
    questions: [
      {
        itemId: 'window',
        question: '活动到哪天结束？',
        fallback: { kind: 'deferred' },
      },
    ],
    groupSkip: true,
    presentation: {
      carriers: ['conversation', 'store_page'],
      blocking: 'none',
      notification: 'none',
    },
  });
  const answer = askMerchantAnswerSchema.parse({
    requestId: request.requestId,
    revision: request.revision,
    idempotencyKey: 'answer-1',
    resume: { runId: request.runId, step: request.step },
    response: {
      kind: 'answer',
      items: [
        {
          itemId: 'window',
          result: { kind: 'answer', value: '2026-08-31' },
        },
      ],
    },
  });
  await store.registerInteraction('workspace-a', request);
  const service = new HarnessInteractionService(store, {
    async resume(input) {
      order.push(
        `resume:${input.runId}:${input.step}:${input.resumeData.kind}`,
      );
    },
  });

  const first = await service.submit('workspace-a', answer);
  const replay = await service.submit('workspace-a', answer);

  assert.deepEqual(first, { kind: 'resumed', replayed: false });
  assert.deepEqual(replay, { kind: 'resumed', replayed: true });
  assert.deepEqual(order, [
    'persist:answer-1',
    'resume:run-1:context_injection:answer',
    'resumed:answer-1',
  ]);
});

test('invalid offered labels become a durable follow-up revision without resuming', async () => {
  const store = new MemoryInteractionStore([]);
  const request = askRequest({
    questions: [
      {
        itemId: 'service',
        question: '这次主推哪个项目？',
        options: [{ label: '头皮护理' }],
        fallback: { kind: 'deferred' },
      },
    ],
  });
  await store.registerInteraction('workspace-a', request);
  const service = new HarnessInteractionService(store, {
    async resume() {
      throw new Error('A rejected answer must not resume.');
    },
  });

  const result = await service.submit('workspace-a', {
    requestId: request.requestId,
    revision: request.revision,
    idempotencyKey: 'invalid-label',
    resume: { runId: request.runId, step: request.step },
    response: {
      kind: 'answer',
      items: [
        {
          itemId: 'service',
          result: { kind: 'answer', value: '浏览器伪造选项' },
        },
      ],
    },
  });

  assert.equal(result.kind, 'reask');
  assert.equal(result.request.revision, request.revision + 1);
  assert.equal(
    (await store.readPendingInteraction('workspace-a', request.runId))
      ?.revision,
    request.revision + 1,
  );
});

test('a failed resume retries the persisted answer without writing it twice', async () => {
  const order: string[] = [];
  const store = new MemoryInteractionStore(order);
  const request = askRequest();
  const answer = askAnswer(request, 'retry-answer');
  await store.registerInteraction('workspace-a', request);
  let attempts = 0;
  const service = new HarnessInteractionService(store, {
    async resume() {
      attempts += 1;
      order.push(`resume-attempt:${attempts}`);
      if (attempts === 1) throw new Error('DBOS unavailable');
    },
  });

  await assert.rejects(
    service.submit('workspace-a', answer),
    /could not resume the workflow/u,
  );
  assert.deepEqual(await service.submit('workspace-a', answer), {
    kind: 'resumed',
    replayed: true,
  });
  assert.deepEqual(order, [
    'persist:retry-answer',
    'resume-attempt:1',
    'resume-attempt:2',
    'resumed:retry-answer',
  ]);
});

test('execution confirmation only persists when the server condition requires it', async () => {
  const store = new MemoryInteractionStore([]);
  const service = new HarnessInteractionService(store, { async resume() {} });
  const direct = executionRequest(false);
  const held = executionRequest(true);

  assert.deepEqual(await service.request('workspace-a', direct), {
    kind: 'continued',
  });
  assert.equal(
    await store.readPendingInteraction('workspace-a', direct.runId),
    null,
  );
  assert.deepEqual(await service.request('workspace-a', held), {
    kind: 'pending',
    replayed: false,
  });
  assert.equal(
    (await store.readPendingInteraction('workspace-a', held.runId))
      ?.requestId,
    held.requestId,
  );
});

for (const response of [
  { kind: 'approved' as const },
  { kind: 'rejected' as const, feedback: '请换成更稳妥的方案' },
]) {
  test(`execution response ${response.kind}${'feedback' in response ? ' with feedback' : ''} resumes its exact state`, async () => {
    const resumes: unknown[] = [];
    const store = new MemoryInteractionStore([]);
    const request = executionRequest(true);
    await store.registerInteraction('workspace-a', request);
    const service = new HarnessInteractionService(store, {
      async resume(input) {
        resumes.push(input.resumeData);
      },
    });
    const answer = executionConfirmationAnswerSchema.parse({
      requestId: request.requestId,
      revision: request.revision,
      idempotencyKey: `execution-${JSON.stringify(response)}`,
      resume: { runId: request.runId, step: request.step },
      response,
    });

    assert.deepEqual(await service.submit('workspace-a', answer), {
      kind: 'resumed',
      replayed: false,
    });
    assert.deepEqual(resumes, [response]);
  });
}

test('execution rejection without feedback persists waiting without resuming', async () => {
  const resumes: unknown[] = [];
  const store = new MemoryInteractionStore([]);
  const request = executionRequest(true);
  await store.registerInteraction('workspace-a', request);
  const service = new HarnessInteractionService(store, {
    async resume(input) {
      resumes.push(input.resumeData);
    },
  });
  const answer = executionConfirmationAnswerSchema.parse({
    requestId: request.requestId,
    revision: request.revision,
    idempotencyKey: 'execution-rejected-without-feedback',
    resume: { runId: request.runId, step: request.step },
    response: { kind: 'rejected' },
  });

  assert.deepEqual(await service.submit('workspace-a', answer), {
    kind: 'waiting',
    replayed: false,
  });
  assert.deepEqual(resumes, []);
  assert.equal(store.eventResumeRequired, false);
  assert.equal(
    await store.readPendingInteraction('workspace-a', request.runId),
    null,
  );
  assert.equal(
    (
      await store.readPendingInteraction('workspace-a', request.runId, {
        includeResolved: true,
      })
    )?.requestId,
    request.requestId,
  );
});

test('semantic timeout defers merchant questions but pauses while the merchant edits', async () => {
  const resumes: Array<{ resolutionSource: string; resumeData: unknown }> = [];
  const store = new MemoryInteractionStore([]);
  let now = Date.parse('2026-07-30T00:00:00.000Z');
  const request = askRequest({
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: {
        kind: 'safe',
        serverEvaluated: true,
      },
    },
    questions: [
      {
        itemId: 'service',
        question: '这次主推哪个项目？',
        fallback: { kind: 'deferred' },
      },
      {
        itemId: 'window',
        question: '活动到哪天结束？',
        fallback: { kind: 'deferred' },
      },
    ],
  });
  const service = new HarnessInteractionService(
    store,
    {
      async resume({ resolutionSource, resumeData }) {
        resumes.push({ resolutionSource, resumeData });
      },
    },
    () => new Date(now),
  );

  await service.request('workspace-a', request, {
    rendererCapability: 'available',
  });
  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'deadline' },
  );
  now += 10_000;
  await service.setEditing('workspace-a', request.runId, true);
  now += 90_000;
  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'editing' },
  );
  await service.setEditing('workspace-a', request.runId, false);
  now += 19_999;
  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'deadline' },
  );
  now += 1;
  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'resumed', replayed: false },
  );
  assert.deepEqual(resumes, [
    {
      resolutionSource: 'system_default',
      resumeData: {
        kind: 'answer',
        items: [
          { itemId: 'service', result: { kind: 'deferred' } },
          { itemId: 'window', result: { kind: 'deferred' } },
        ],
      },
    },
  ]);
  assert.equal(store.lastResolutionSource, 'system_default');
});

test('an unavailable renderer holds an otherwise eligible expired default', async () => {
  const store = new MemoryInteractionStore([]);
  let now = Date.parse('2026-07-30T00:00:00.000Z');
  const request = askRequest({
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: {
        kind: 'safe',
        serverEvaluated: true,
      },
    },
  });
  const service = new HarnessInteractionService(
    store,
    { async resume() {} },
    () => new Date(now),
  );
  await service.request('workspace-a', request, {
    rendererCapability: 'unavailable',
  });
  now += 30_000;

  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'renderer' },
  );
  await service.setRendererCapability(
    'workspace-a',
    request.runId,
    'available',
  );
  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'resumed', replayed: false },
  );
});

test('external execution effects hold forever and an unsupported carrier cannot release them', async () => {
  const store = new MemoryInteractionStore([]);
  const request = executionRequest(true, {
    conditionKind: 'external_action',
    timeoutKind: 'hold',
  });
  const service = new HarnessInteractionService(store, { async resume() {} });
  await service.request('workspace-a', request);

  assert.equal(
    await service.readForCarrier('workspace-a', request.runId, 'store_page'),
    null,
  );
  assert.equal(
    (await store.readPendingInteraction('workspace-a', request.runId))
      ?.requestId,
    request.requestId,
  );
  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'policy' },
  );
});

class MemoryInteractionStore implements HarnessInteractionStore {
  private pending:
    | Parameters<HarnessInteractionStore['registerInteraction']>[1]
    | null = null;
  private event:
    | {
        idempotencyKey: string;
        payloadFingerprint: string;
        resumeRequired: boolean;
      }
    | undefined;
  private waitingForMerchantMessage = false;
  private projection: HarnessInteractionPendingProjection = {
    version: 1,
    rendererCapability: 'unknown',
    waitingState: 'answer',
    timer: { kind: 'hold' },
  };
  editing = false;
  lastResolutionSource: string | undefined;
  get eventResumeRequired() {
    return this.event?.resumeRequired;
  }

  constructor(private readonly order: string[]) {}

  async registerInteraction(
    _workspaceId: string,
    request: Parameters<HarnessInteractionStore['registerInteraction']>[1],
    projection?: Parameters<HarnessInteractionStore['registerInteraction']>[2],
  ) {
    this.pending = request;
    if (projection) this.projection = structuredClone(projection);
    return { outcome: 'created' as const };
  }

  async readPendingInteraction(
    _workspaceId: string,
    _runId: string,
    options?: { includeResolved?: boolean },
  ) {
    if (this.waitingForMerchantMessage && !options?.includeResolved) {
      return null;
    }
    return this.pending;
  }

  async resolveInteraction(
    input: Parameters<HarnessInteractionStore['resolveInteraction']>[0],
  ) {
    if (this.event) {
      return {
        outcome:
          this.event.payloadFingerprint === input.payloadFingerprint
            ? ('replayed' as const)
            : ('idempotency_conflict' as const),
        resumeRequired: this.event.resumeRequired,
      };
    }
    if (input.trigger === 'system_default') {
      if (this.projection.timer.kind !== 'armed') {
        return { outcome: 'ineligible' as const, resumeRequired: false };
      }
      if (this.projection.rendererCapability !== 'available') {
        return {
          outcome: 'renderer_unavailable' as const,
          resumeRequired: false,
        };
      }
      if (this.projection.timer.editingStartedAt !== null) {
        return { outcome: 'editing' as const, resumeRequired: false };
      }
      if (
        Date.parse(input.resolvedAt) <
        Date.parse(this.projection.timer.deadlineAt)
      ) {
        return { outcome: 'not_due' as const, resumeRequired: false };
      }
    }
    this.event = {
      idempotencyKey: input.answer.idempotencyKey,
      payloadFingerprint: input.payloadFingerprint,
      resumeRequired: input.resumeDisposition === 'resume',
    };
    this.waitingForMerchantMessage = input.resumeDisposition === 'wait';
    this.lastResolutionSource = input.resolutionSource;
    this.order.push(`persist:${input.answer.idempotencyKey}`);
    return { outcome: 'created' as const, resumeRequired: true };
  }

  async claimInteractionResume() {
    if (!this.event?.resumeRequired) return false;
    this.event.resumeRequired = false;
    return true;
  }

  async releaseInteractionResume() {
    if (this.event) this.event.resumeRequired = true;
  }

  async markInteractionResumed(
    _workspaceId: string,
    _runId: string,
    idempotencyKey: string,
  ) {
    this.order.push(`resumed:${idempotencyKey}`);
    return true;
  }

  async transitionInteractionEditing(
    _workspaceId: string,
    _runId: string,
    editing: boolean,
    at: string,
  ) {
    if (!this.pending) return 'stale' as const;
    if (this.projection.timer.kind !== 'armed') {
      return 'unknown_state' as const;
    }
    const current = this.projection.timer.editingStartedAt;
    if ((editing && current !== null) || (!editing && current === null)) {
      return 'replayed' as const;
    }
    if (editing) {
      this.projection.timer.editingStartedAt = at;
    } else {
      const pausedFor = Date.parse(at) - Date.parse(current!);
      this.projection.timer.deadlineAt = new Date(
        Date.parse(this.projection.timer.deadlineAt) + pausedFor,
      ).toISOString();
      this.projection.timer.editingStartedAt = null;
    }
    this.editing = editing;
    return 'updated' as const;
  }

  async setInteractionRendererCapability(
    _workspaceId: string,
    _runId: string,
    capability: 'available' | 'unavailable' | 'unknown',
  ) {
    if (!this.pending) return false;
    this.projection.rendererCapability = capability;
    return true;
  }
}

function askRequest(
  overrides: Partial<
    ReturnType<typeof askMerchantQuestionRequestSchema.parse>
  > = {},
) {
  return askMerchantQuestionRequestSchema.parse({
    requestId: 'request-ask',
    runId: 'run-ask',
    step: 'context_injection',
    revision: 1,
    kind: 'ask_merchant',
    questions: [
      {
        itemId: 'window',
        question: '活动到哪天结束？',
        fallback: { kind: 'deferred' },
      },
    ],
    groupSkip: true,
    presentation: {
      carriers: ['conversation', 'store_page'],
      blocking: 'none',
      notification: 'none',
    },
    ...overrides,
  });
}

function askAnswer(
  request: ReturnType<typeof askRequest>,
  idempotencyKey: string,
) {
  return askMerchantAnswerSchema.parse({
    requestId: request.requestId,
    revision: request.revision,
    idempotencyKey,
    resume: { runId: request.runId, step: request.step },
    response: {
      kind: 'answer',
      items: [
        {
          itemId: request.questions[0]?.itemId,
          result: { kind: 'answer', value: '2026-08-31' },
        },
      ],
    },
  });
}

function executionRequest(
  required: boolean,
  options: {
    conditionKind?:
      | 'existing_gate'
      | 'quote_threshold'
      | 'external_action'
      | 'unknown';
    timeoutKind?: 'hold' | 'semantic_default';
  } = {},
) {
  return executionConfirmationRequestSchema.parse({
    requestId: `execution-request-${required}`,
    runId: `execution-run-${required}`,
    step: 'execution_selection',
    revision: 2,
    kind: 'execution_confirmation',
    frozen: {
      executionSnapshotRef: { id: 'snapshot-1', revision: 3 },
      quoteRevision: 'quote-r1',
      params: [
        {
          key: 'model',
          label: '模型',
          value: 'ark-image-v3',
          hint: null,
        },
      ],
      debitPreview: [{ resource: 'image', quantity: 2 }],
      condition: {
        kind: options.conditionKind ?? 'existing_gate',
        required,
        serverEvaluated: true,
      },
      timeoutPolicy:
        options.timeoutKind !== 'semantic_default'
          ? {
              kind: 'hold',
              reason:
                (options.conditionKind ?? 'existing_gate') === 'external_action'
                  ? 'external_action'
                  : (options.conditionKind ?? 'existing_gate') ===
                      'quote_threshold'
                    ? 'quote_threshold'
                    : 'unknown',
              serverEvaluated: true,
            }
          : {
              kind: 'semantic_default',
              timeoutSeconds: 30,
              eligibility: {
                kind: 'safe',
                serverEvaluated: true,
              },
            },
    },
    presentation: {
      carriers: ['conversation', 'task_card'],
      notification: 'none',
      renderer: 'execution_confirmation',
    },
  });
}
