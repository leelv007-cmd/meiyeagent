import assert from 'node:assert/strict';
import test from 'node:test';

import {
  askMerchantAnswerSchema,
  askMerchantQuestionRequestSchema,
  executionConfirmationAnswerSchema,
  executionConfirmationRequestSchema,
} from '@meiye/contracts';

import {
  askMerchantInteractionRequestFromQuestion,
  buildAskMerchantSemanticDefaultTimeoutPolicy,
  createHarnessInteractionPendingProjection,
  executionConfirmationInteractionRequestFromQuestion,
  HarnessInteractionError,
  harnessInteractionPendingProjectionSchema,
  HarnessInteractionService,
  HarnessSystemDefaultProducer,
  type HarnessInteractionPendingProjection,
  type HarnessInteractionStore,
} from './interaction-service.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';

test('merchant questions preserve free text and normalize duplicate labels before persistence', () => {
  const request = askMerchantInteractionRequestFromQuestion({
    question: {
      questionId: 'question-options-free-text',
      workflowId: 'run-options-free-text',
      workflowRevision: 1,
      question: '这次主推什么？',
      options: [
        { id: 'option-1', label: '头皮护理' },
        { id: 'option-2', label: '头皮护理' },
        { id: 'option-3', label: '染发' },
      ],
      freeText: { enabled: true, placeholder: '也可以直接告诉我' },
      response: {
        field: 'service',
        reason: '需要商家确认主推项目',
      },
      unattended: 'hold',
      scope: 'current_task',
    },
    stage: 'intent_naming',
  });

  assert.deepEqual(request.questions[0], {
    itemId: 'service',
    question: '这次主推什么？',
    options: [{ label: '头皮护理' }, { label: '染发' }],
    freeText: { enabled: true, placeholder: '也可以直接告诉我' },
    fallback: { kind: 'deferred' },
  });
});

test('semantic defaults require independent server-owned safety authority', () => {
  const question = {
    questionId: 'question-authority',
    workflowId: 'run-authority',
    workflowRevision: 1,
    question: '这次主推哪个项目？',
    options: [],
    freeText: { enabled: true },
    response: {
      field: 'service',
      reason: '需要商家确认主推项目',
    },
    unattended: 'continue' as const,
    scope: 'current_task' as const,
  };

  assert.deepEqual(
    buildAskMerchantSemanticDefaultTimeoutPolicy(question, 30),
    {
      kind: 'hold',
      reason: 'unknown',
      serverEvaluated: true,
    },
  );
  const policy = buildAskMerchantSemanticDefaultTimeoutPolicy(
    {
      ...question,
      semanticDefaultAuthority: {
        kind: 'non_resource_no_effect',
        source: 'intent_gap',
        revision: 'intent-gap/v1',
      },
    },
    30,
  );
  assert.equal(policy?.kind, 'semantic_default');
  if (!policy || policy.kind !== 'semantic_default') return;
  assert.equal(policy.eligibility.effect, 'none');
  assert.equal(policy.eligibility.quota, 'not_applicable');
  assert.equal(
    policy.eligibility.conditionRevision,
    'question-authority:r1',
  );
  assert.equal(
    policy.eligibility.defaultResponseFingerprint,
    fingerprintValue(policy.eligibility.defaultResponse),
  );
});

test('external execution authority freezes a hold-only confirmation request', () => {
  const request = executionConfirmationInteractionRequestFromQuestion({
    question: {
      questionId: 'execution-confirmation:snapshot-1',
      workflowId: 'run-1',
      workflowRevision: 1,
      question: '是否按当前方案开始生成？将按展示的参数与费用执行。',
      options: [
        { id: 'approved', label: '确认执行' },
        { id: 'rejected', label: '暂不执行' },
      ],
      freeText: { enabled: false },
      response: {
        field: 'execution_confirmation',
        reason: '生成前需要商家确认本次执行参数与费用',
      },
      unattended: 'hold',
      executionConfirmationAuthority: {
        kind: 'external_action',
        revision: 'execution-external-action/v1',
        reservedCredits: 5,
      },
      scope: 'current_task',
    },
    request: {
      executionSnapshot: {
        id: 'snapshot-1',
        revision: 1,
        quote: { revision: 'quote-r1' },
        operation: 'copy.generate',
        catalogModel: { id: 'model-1', revision: 'model-r1' },
        deliverable: { kind: 'copy_document' },
        distributionTarget: 'manual_copy',
      },
    },
  });

  assert.equal(request?.kind, 'execution_confirmation');
  assert.equal(request?.frozen.condition.kind, 'external_action');
  assert.equal(request?.frozen.condition.required, true);
  assert.equal(request?.frozen.reservedCredits, 5);
  assert.deepEqual(request?.frozen.debitPreview, []);
  assert.deepEqual(request?.frozen.timeoutPolicy, {
    kind: 'hold',
    reason: 'external_action',
    serverEvaluated: true,
  });
});

test('note paid-media confirmation freezes outline page count and titles', () => {
  const outline = {
    pageCount: 3,
    pages: [
      { order: 1, title: '封面：夏日控油' },
      { order: 2, title: '痛点：油头困扰' },
      { order: 3, title: '预约引导' },
    ],
  };
  const request = executionConfirmationInteractionRequestFromQuestion({
    question: {
      questionId: 'execution-confirmation:snapshot-note-1',
      workflowId: 'run-note-1',
      workflowRevision: 2,
      question: '是否按当前方案开始生成？将按展示的参数与费用执行。',
      options: [
        { id: 'approved', label: '确认执行' },
        { id: 'rejected', label: '暂不执行' },
      ],
      freeText: { enabled: false },
      response: {
        field: 'execution_confirmation',
        reason: '生成前需要商家确认本次执行参数与费用',
      },
      unattended: 'hold',
      executionConfirmationAuthority: {
        kind: 'external_action',
        revision: 'execution-external-action/v1',
        outline,
      },
      scope: 'current_task',
    },
    request: {
      executionSnapshot: {
        id: 'snapshot-note-1',
        revision: 2,
        quote: { revision: 'quote-note-r1' },
        operation: 'image.generate',
        catalogModel: { id: 'model-image-1', revision: 'model-r1' },
        deliverable: { kind: 'image_text_note' },
        distributionTarget: 'xiaohongshu_draft',
      },
    },
  });

  assert.equal(request?.kind, 'execution_confirmation');
  assert.deepEqual(request?.frozen.outline, outline);
  assert.equal(
    request?.frozen.params.some(
      (param) => param.key === 'quantity' && param.value === '3 页',
    ),
    true,
  );
});

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
  await store.seed(request);
  const service = new HarnessInteractionService(store, {
    async resume(input) {
      order.push(
        `resume:${input.runId}:${input.step}:${input.resumeData.kind}`,
      );
      store.markResumed(input.eventId);
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
  await store.seed(request);
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

test('bounded skips only advance the durable reask until an exact explicit continue', async () => {
  const resumed: unknown[] = [];
  const store = new MemoryInteractionStore([]);
  const request = askRequest({
    requestId: 'bounded-run:execution-selection:bounded:r1:a1',
    runId: 'bounded-run',
    step: 'execution_selection',
    questions: [
      {
        itemId: 'bounded_execution_continuation',
        question: '已保留当前最好结果，是否提高上限后继续？',
        options: [{ label: '提高上限后继续' }],
        freeText: { enabled: false },
        fallback: { kind: 'deferred' },
      },
    ],
  });
  await store.seed(request);
  const service = new HarnessInteractionService(store, {
    async resume(input) {
      resumed.push(input.resumeData);
      store.markResumed(input.eventId);
    },
  });

  let revision = request.revision;
  for (const idempotencyKey of ['bounded-skip-1', 'bounded-skip-2']) {
    const result = await service.submit('workspace-a', {
      requestId: request.requestId,
      revision,
      idempotencyKey,
      resume: { runId: request.runId, step: request.step },
      response: { kind: 'skipped' },
    });
    assert.equal(result.kind, 'reask');
    revision += 1;
    assert.equal(result.request.revision, revision);
    assert.deepEqual(resumed, []);
  }

  const explicit = await service.submit('workspace-a', {
    requestId: request.requestId,
    revision,
    idempotencyKey: 'bounded-explicit-continue',
    resume: { runId: request.runId, step: request.step },
    response: {
      kind: 'answer',
      items: [
        {
          itemId: 'bounded_execution_continuation',
          result: { kind: 'answer', value: '提高上限后继续' },
        },
      ],
    },
  });

  assert.deepEqual(explicit, { kind: 'resumed', replayed: false });
  assert.deepEqual(resumed, [
    {
      kind: 'answer',
      items: [
        {
          itemId: 'bounded_execution_continuation',
          result: { kind: 'answer', value: '提高上限后继续' },
        },
      ],
    },
  ]);
});

test('malformed ask answers reask after identity validation while forged identities fail closed', async () => {
  const store = new MemoryInteractionStore([]);
  const request = askRequest();
  await store.seed(request);
  const service = new HarnessInteractionService(store, {
    async resume() {
      throw new Error('A malformed answer must not resume.');
    },
  });
  const malformed = {
    requestId: request.requestId,
    revision: request.revision,
    idempotencyKey: 'malformed-answer',
    resume: { runId: request.runId, step: request.step },
    response: {
      kind: 'answer',
      items: [{ itemId: 'service', result: { kind: 'answer', value: '' } }],
    },
  };

  const result = await service.submit('workspace-a', malformed);

  assert.equal(result.kind, 'reask');
  assert.equal(result.request.revision, request.revision + 1);
  assert.equal(
    (await store.readPendingInteraction('workspace-a', request.runId))
      ?.revision,
    request.revision + 1,
  );
  await assert.rejects(
    service.submit('workspace-a', {
      ...malformed,
      requestId: 'forged-request',
      revision: request.revision + 1,
      resume: { ...malformed.resume, runId: 'forged-run' },
    }),
    /no longer pending|stale/u,
  );
});

test('an execution-shaped response to an exact ask identity advances one durable reask', async () => {
  const store = new MemoryInteractionStore([]);
  const request = askRequest({ step: 'execution_selection' });
  await store.seed(request);
  const service = new HarnessInteractionService(store, {
    async resume() {
      throw new Error('A mismatched answer must not resume.');
    },
  });

  const result = await service.submit('workspace-a', {
    requestId: request.requestId,
    revision: request.revision,
    idempotencyKey: 'execution-shaped-ask-answer',
    resume: { runId: request.runId, step: request.step },
    response: { kind: 'approved' },
  });

  assert.equal(result.kind, 'reask');
  assert.equal(result.request.revision, request.revision + 1);
  assert.equal(
    (await store.readPendingInteraction('workspace-a', request.runId))
      ?.revision,
    request.revision + 1,
  );
});

test('reask requires a fresh renderer acknowledgement and restarts its deadline', async () => {
  const resumes: unknown[] = [];
  let now = Date.parse('2026-07-30T00:00:00.000Z');
  const store = new MemoryInteractionStore([], () => new Date(now));
  const request = askRequest({
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: semanticDefaultEligibility(['service']),
    },
    questions: [
      {
        itemId: 'service',
        question: '这次主推哪个项目？',
        options: [{ label: '头皮护理' }],
        fallback: { kind: 'deferred' },
      },
    ],
  });
  await store.seed(request, 'available', new Date(now));
  const service = new HarnessInteractionService(
    store,
    {
      async resume(input) {
        resumes.push(input.resumeData);
      },
    },
    () => new Date(now),
  );

  const reask = await service.submit('workspace-a', {
    requestId: request.requestId,
    revision: request.revision,
    idempotencyKey: 'reask-before-timeout',
    resume: { runId: request.runId, step: request.step },
    response: {
      kind: 'answer',
      items: [
        {
          itemId: 'service',
          result: { kind: 'answer', value: '伪造选项' },
        },
      ],
    },
  });
  assert.equal(reask.kind, 'reask');
  now += 30_000;
  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'renderer' },
  );
  assert.deepEqual(resumes, []);
  await service.ackRenderer('workspace-a', request.runId, {
    requestId: request.requestId,
    revision: request.revision + 1,
    step: request.step,
    carrier: 'conversation',
  });
  now += 29_999;
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
      kind: 'answer',
      items: [{ itemId: 'service', result: { kind: 'deferred' } }],
    },
  ]);
});

test('a failed resume retries the persisted answer without writing it twice', async () => {
  const order: string[] = [];
  const store = new MemoryInteractionStore(order);
  const request = askRequest();
  const answer = askAnswer(request, 'retry-answer');
  await store.seed(request);
  let attempts = 0;
  const service = new HarnessInteractionService(store, {
    async resume() {
      attempts += 1;
      order.push(`resume-attempt:${attempts}`);
      if (attempts === 1) throw new Error('DBOS unavailable');
      store.markResumed('interaction-event-retry-answer');
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

for (const response of [
  { kind: 'approved' as const },
  { kind: 'rejected' as const, feedback: '请换成更稳妥的方案' },
]) {
  test(`execution response ${response.kind}${'feedback' in response ? ' with feedback' : ''} resumes its exact state`, async () => {
    const resumes: unknown[] = [];
    const store = new MemoryInteractionStore([]);
    const request = executionRequest(true);
    await store.seed(request);
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
  await store.seed(request);
  const service = new HarnessInteractionService(store, {
    async resume(input) {
      resumes.push(input.resumeData);
      store.markResumed(input.eventId);
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

test('the next merchant message resumes a rejected execution exactly once', async () => {
  const resumes: unknown[] = [];
  const store = new MemoryInteractionStore([]);
  const request = executionRequest(true);
  await store.seed(request);
  const service = new HarnessInteractionService(store, {
    async resume(input) {
      resumes.push(input.resumeData);
      store.markResumed(input.eventId);
    },
  });

  await service.submit('workspace-a', {
    requestId: request.requestId,
    revision: request.revision,
    idempotencyKey: 'execution-rejected-awaiting-message',
    resume: { runId: request.runId, step: request.step },
    response: { kind: 'rejected' },
  });
  const first = await service.submitMerchantMessage(
    'workspace-a',
    request.runId,
    {
      requestId: request.requestId,
      revision: request.revision,
      step: request.step,
      carrier: 'conversation',
      idempotencyKey: 'execution-rejected-message',
      message: '请改用更稳妥的模型并减少图片数量',
    },
  );
  const replay = await service.submitMerchantMessage(
    'workspace-a',
    request.runId,
    {
      requestId: request.requestId,
      revision: request.revision,
      step: request.step,
      carrier: 'conversation',
      idempotencyKey: 'execution-rejected-message',
      message: '请改用更稳妥的模型并减少图片数量',
    },
  );

  assert.deepEqual(first, { kind: 'resumed', replayed: false });
  assert.deepEqual(replay, { kind: 'resumed', replayed: true });
  assert.deepEqual(resumes, [
    {
      kind: 'rejected',
      feedback: '请改用更稳妥的模型并减少图片数量',
    },
  ]);
});

test('a stale merchant message cannot bind itself to the next waiting request', async () => {
  const resumes: unknown[] = [];
  const store = new MemoryInteractionStore([]);
  const request = executionRequest(true);
  await store.seed(request);
  const service = new HarnessInteractionService(store, {
    async resume(input) {
      resumes.push(input.resumeData);
      store.markResumed(input.eventId);
    },
  });

  await service.submit('workspace-a', {
    requestId: request.requestId,
    revision: request.revision,
    idempotencyKey: 'execution-rejected-before-stale-message',
    resume: { runId: request.runId, step: request.step },
    response: { kind: 'rejected' },
  });

  await assert.rejects(
    service.submitMerchantMessage('workspace-a', request.runId, {
      requestId: 'previous-execution-request',
      revision: request.revision,
      step: request.step,
      carrier: 'conversation',
      idempotencyKey: 'stale-execution-message',
      message: '这是上一张卡的迟到消息',
    }),
    (error: unknown) =>
      error instanceof HarnessInteractionError &&
      error.code === 'STALE_INTERACTION_REVISION',
  );
  assert.deepEqual(resumes, []);

  assert.deepEqual(
    await service.submitMerchantMessage('workspace-a', request.runId, {
      requestId: request.requestId,
      revision: request.revision,
      step: request.step,
      carrier: 'conversation',
      idempotencyKey: 'current-execution-message',
      message: '请换成更稳妥的模型',
    }),
    { kind: 'resumed', replayed: false },
  );
  assert.equal(resumes.length, 1);
});

test('editing signals are a no-op for interactions without a semantic timer', async () => {
  const store = new MemoryInteractionStore([]);
  const request = askRequest();
  await store.seed(request);
  const service = new HarnessInteractionService(store, { async resume() {} });

  await service.setEditing('workspace-a', request.runId, {
    requestId: request.requestId,
    revision: request.revision,
    step: request.step,
    carrier: 'conversation',
    editing: true,
    editingSessionId: 'editing-session-a',
  });
  assert.equal(store.editing, false);
});

test('semantic timeout defers merchant questions but pauses while the merchant edits', async () => {
  const resumes: Array<{ resolutionSource: string; resumeData: unknown }> = [];
  let now = Date.parse('2026-07-30T00:00:00.000Z');
  const store = new MemoryInteractionStore([], () => new Date(now));
  const request = askRequest({
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: semanticDefaultEligibility(['service', 'window']),
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

  await store.seed(request, 'available', new Date(now));
  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'deadline' },
  );
  now += 10_000;
  await service.setEditing('workspace-a', request.runId, {
    requestId: request.requestId,
    revision: request.revision,
    step: request.step,
    carrier: 'conversation',
    editing: true,
    editingSessionId: 'editing-session-a',
  });
  now += 20_000;
  await service.setEditing('workspace-a', request.runId, {
    requestId: request.requestId,
    revision: request.revision,
    step: request.step,
    carrier: 'conversation',
    editing: true,
    editingSessionId: 'editing-session-a',
  });
  now += 20_000;
  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'editing' },
  );
  await assert.rejects(
    service.setEditing('workspace-a', request.runId, {
      requestId: request.requestId,
      revision: request.revision,
      step: request.step,
      carrier: 'conversation',
      editing: false,
      editingSessionId: 'editing-session-stale',
    }),
    /no longer pending/u,
  );
  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'editing' },
  );
  await service.setEditing('workspace-a', request.runId, {
    requestId: request.requestId,
    revision: request.revision,
    step: request.step,
    carrier: 'conversation',
    editing: false,
    editingSessionId: 'editing-session-a',
  });
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

test('an abandoned editing lease expires without holding the run forever', async () => {
  let now = Date.parse('2026-07-30T00:00:00.000Z');
  const store = new MemoryInteractionStore([], () => new Date(now));
  const request = askRequest({
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: semanticDefaultEligibility(['window']),
    },
  });
  await store.seed(request, 'available', new Date(now));
  const service = new HarnessInteractionService(
    store,
    { async resume() {} },
    () => new Date(now),
  );
  await service.setEditing('workspace-a', request.runId, {
    requestId: request.requestId,
    revision: request.revision,
    step: request.step,
    carrier: 'conversation',
    editing: true,
    editingSessionId: 'editing-session-abandoned',
  });

  now += 60_000;

  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'resumed', replayed: false },
  );
});

test('an unavailable renderer holds an otherwise eligible expired default', async () => {
  const store = new MemoryInteractionStore([]);
  let now = Date.parse('2026-07-30T00:00:00.000Z');
  const request = askRequest({
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: semanticDefaultEligibility(['window']),
    },
  });
  const service = new HarnessInteractionService(
    store,
    { async resume() {} },
    () => new Date(now),
  );
  await store.seed(request, 'unavailable', new Date(now));
  now += 30_000;

  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'renderer' },
  );
});

test('an unacknowledged renderer expires through one exact durable owner', async () => {
  const store = new MemoryInteractionStore([]);
  let now = Date.parse('2026-07-30T00:00:00.000Z');
  const request = askRequest({
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: semanticDefaultEligibility(['window']),
    },
  });
  const service = new HarnessInteractionService(
    store,
    { async resume() {} },
    () => new Date(now),
  );
  await store.seed(request, 'unknown', new Date(now));
  now += 30_000;

  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'renderer' },
  );
  assert.equal(
    await service.expireUnrendered('workspace-a', request.runId),
    'expired',
  );
  assert.equal(
    await service.expireUnrendered('workspace-a', request.runId),
    'replayed',
  );
  await assert.rejects(
    service.ackRenderer('workspace-a', request.runId, {
      requestId: request.requestId,
      revision: request.revision,
      step: request.step,
      carrier: 'conversation',
    }),
    /no longer pending/u,
  );
});

test('an old renderer timeout cannot expire a reasked revision', async () => {
  const store = new MemoryInteractionStore([]);
  const request = askRequest({
    questions: [
      {
        itemId: 'window',
        question: '活动到哪天结束？',
        options: [{ label: '本周日' }],
        fallback: { kind: 'deferred' },
      },
    ],
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: semanticDefaultEligibility(['window']),
    },
  });
  const service = new HarnessInteractionService(store, {
    async resume() {},
  });
  await store.seed(request, 'available');

  const reask = await service.submit('workspace-a', {
    requestId: request.requestId,
    revision: request.revision,
    idempotencyKey: 'reask-before-old-renderer-timeout',
    resume: { runId: request.runId, step: request.step },
    response: {
      kind: 'answer',
      items: [
        {
          itemId: 'window',
          result: { kind: 'answer', value: '伪造选项' },
        },
      ],
    },
  });
  assert.equal(reask.kind, 'reask');

  assert.equal(
    await service.expireUnrendered('workspace-a', request.runId, {
      requestId: request.requestId,
      revision: request.revision,
      step: request.step,
    }),
    'stale',
  );
  assert.equal(
    (await store.readPendingInteraction('workspace-a', request.runId))
      ?.revision,
    request.revision + 1,
  );
  assert.equal(
    await service.expireUnrendered('workspace-a', request.runId, {
      requestId: request.requestId,
      revision: request.revision + 1,
      step: request.step,
    }),
    'expired',
  );
});

test('carrier reads do not self-ack and the first renderer ack starts the timeout window', async () => {
  let now = Date.parse('2026-07-30T00:01:00.000Z');
  const store = new MemoryInteractionStore([], () => new Date(now));
  const request = askRequest({
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: semanticDefaultEligibility(['window']),
    },
  });
  const service = new HarnessInteractionService(
    store,
    { async resume() {} },
    () => new Date(now),
  );
  await store.seed(
    request,
    'unknown',
    new Date('2026-07-30T00:00:00.000Z'),
  );

  assert.equal(
    (await service.readForCarrier('workspace-a', request.runId, 'conversation'))
      ?.requestId,
    request.requestId,
  );
  assert.equal(store.rendererCapability, 'unknown');
  assert.deepEqual(
    await service.submitSystemDefault('workspace-a', request.runId),
    { kind: 'held', reason: 'renderer' },
  );

  await service.ackRenderer('workspace-a', request.runId, {
    requestId: request.requestId,
    revision: request.revision,
    step: request.step,
    carrier: 'conversation',
  });
  assert.equal(store.rendererCapability, 'available');
  assert.equal(
    store.deadlineAt,
    '2026-07-30T00:01:30.000Z',
  );
  now += 10_000;
  await service.ackRenderer('workspace-a', request.runId, {
    requestId: request.requestId,
    revision: request.revision,
    step: request.step,
    carrier: 'conversation',
  });
  assert.equal(
    store.deadlineAt,
    '2026-07-30T00:01:30.000Z',
  );
});

test('a stale renderer acknowledgement cannot arm a newer request revision', async () => {
  const store = new MemoryInteractionStore([]);
  const first = askRequest({
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: semanticDefaultEligibility(['window']),
    },
  });
  await store.seed(first);
  const second = askRequest({
    ...first,
    revision: first.revision + 1,
  });
  assert.deepEqual(
    await store.advanceInteraction('workspace-a', second),
    { outcome: 'advanced' },
  );
  const service = new HarnessInteractionService(store, { async resume() {} });

  await assert.rejects(
    service.ackRenderer('workspace-a', second.runId, {
      requestId: first.requestId,
      revision: first.revision,
      step: first.step,
      carrier: 'conversation',
    }),
    /no longer pending/u,
  );
  assert.equal(store.rendererCapability, 'unknown');
});

test('the production default producer retries a due interaction after its durable timer unblocks', async () => {
  const calls: string[] = [];
  const producer = new HarnessSystemDefaultProducer(
    {
      async listSystemDefaultCandidates() {
        return [{ workspaceId: 'workspace-a', runId: 'run-due' }];
      },
    },
    {
      async submitSystemDefault(workspaceId, runId) {
        calls.push(`${workspaceId}:${runId}`);
        return { kind: 'resumed' as const, replayed: false };
      },
    },
  );

  assert.deepEqual(await producer.runOnce(), {
    failed: 0,
    held: 0,
    resumed: 1,
  });
  assert.deepEqual(calls, ['workspace-a:run-due']);
});

test('external execution effects hold forever and an unsupported carrier cannot release them', async () => {
  const store = new MemoryInteractionStore([]);
  const request = executionRequest(true, {
    conditionKind: 'external_action',
  });
  const service = new HarnessInteractionService(store, { async resume() {} });
  await store.seed(request);

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

test('legacy interaction projections require a fresh renderer acknowledgement', () => {
  const request = askRequest({
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: semanticDefaultEligibility(['window']),
    },
  });
  const projection = harnessInteractionPendingProjectionSchema.parse({
    kind: 'harness_interaction',
    version: 1,
    request,
    rendererCapability: 'available',
    waitingState: 'answer',
    timer: {
      kind: 'armed',
      timeoutSeconds: 30,
      deadlineAt: '2026-07-30T00:00:30.000Z',
      editingStartedAt: '2026-07-30T00:00:10.000Z',
    },
  });

  assert.equal(projection.version, 2);
  assert.equal(projection.rendererCapability, 'unknown');
  assert.equal(projection.rendererAckedAt, null);
  assert.deepEqual(projection.timer, {
    kind: 'armed',
    timeoutSeconds: 30,
    deadlineAt: '2026-07-30T00:00:30.000Z',
    editingStartedAt: null,
    editingLeaseExpiresAt: null,
    editingSessionId: null,
  });
});

class MemoryInteractionStore implements HarnessInteractionStore {
  private pending: Parameters<HarnessInteractionStore['advanceInteraction']>[1]
    | null = null;
  private readonly events = new Map<
    string,
    {
      payloadFingerprint: string;
      resumeRequired: boolean;
    }
  >();
  private lastEventKey: string | undefined;
  private waitingForMerchantMessage = false;
  private rendererExpired = false;
  private projection: HarnessInteractionPendingProjection | null = null;
  editing = false;
  lastResolutionSource: string | undefined;
  get eventResumeRequired() {
    return this.lastEventKey
      ? this.events.get(this.lastEventKey)?.resumeRequired
      : undefined;
  }
  get rendererCapability() {
    return this.projection?.rendererCapability;
  }
  get deadlineAt() {
    return this.projection?.timer.kind === 'armed'
      ? this.projection.timer.deadlineAt
      : undefined;
  }

  constructor(
    private readonly order: string[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async seed(
    request: Parameters<HarnessInteractionStore['advanceInteraction']>[1],
    rendererCapability: HarnessInteractionPendingProjection['rendererCapability'] = 'unknown',
    registeredAt = new Date('2026-07-30T00:00:00.000Z'),
  ) {
    this.pending = request;
    this.projection = createHarnessInteractionPendingProjection(
      request,
      rendererCapability,
      registeredAt,
    );
  }

  async advanceInteraction(
    _workspaceId: string,
    request: Parameters<HarnessInteractionStore['advanceInteraction']>[1],
  ) {
    if (!this.pending || !this.projection) {
      return { outcome: 'conflict' as const };
    }
    if (
      this.pending.requestId !== request.requestId ||
      this.pending.runId !== request.runId ||
      request.revision !== this.pending.revision + 1
    ) {
      return { outcome: 'conflict' as const };
    }
    this.pending = request;
    this.projection = createHarnessInteractionPendingProjection(
      request,
      'unknown',
      this.now(),
    );
    return { outcome: 'advanced' as const };
  }

  async readPendingInteraction(
    _workspaceId: string,
    _runId: string,
    options?: { includeResolved?: boolean },
  ) {
    if (
      (this.waitingForMerchantMessage || this.rendererExpired) &&
      !options?.includeResolved
    ) {
      return null;
    }
    return this.pending;
  }

  async readWaitingInteraction(_workspaceId: string, _runId: string) {
    return this.waitingForMerchantMessage ? this.pending : null;
  }

  async resolveInteraction(
    input: Parameters<HarnessInteractionStore['resolveInteraction']>[0],
  ) {
    const existing = this.events.get(input.answer.idempotencyKey);
    if (existing) {
      return {
        outcome:
          existing.payloadFingerprint === input.payloadFingerprint
            ? ('replayed' as const)
            : ('idempotency_conflict' as const),
        resumeRequired: existing.resumeRequired,
        eventId: `interaction-event-${input.answer.idempotencyKey}`,
      };
    }
    if (input.trigger === 'system_default') {
      if (!this.projection || this.projection.timer.kind !== 'armed') {
        return { outcome: 'ineligible' as const, resumeRequired: false };
      }
      if (this.projection.rendererCapability !== 'available') {
        return {
          outcome: 'renderer_unavailable' as const,
          resumeRequired: false,
        };
      }
      if (this.projection.timer.editingStartedAt !== null) {
        const leaseExpiresAt =
          this.projection.timer.editingLeaseExpiresAt ?? null;
        if (
          leaseExpiresAt === null ||
          Date.parse(input.resolvedAt) < Date.parse(leaseExpiresAt)
        ) {
          return { outcome: 'editing' as const, resumeRequired: false };
        }
        const pausedFor =
          Date.parse(leaseExpiresAt) -
          Date.parse(this.projection.timer.editingStartedAt);
        this.projection.timer.deadlineAt = new Date(
          Date.parse(this.projection.timer.deadlineAt) + pausedFor,
        ).toISOString();
        this.projection.timer.editingStartedAt = null;
        this.projection.timer.editingLeaseExpiresAt = null;
        this.projection.timer.editingSessionId = null;
      }
      if (
        Date.parse(input.resolvedAt) <
        Date.parse(this.projection.timer.deadlineAt)
      ) {
        return { outcome: 'not_due' as const, resumeRequired: false };
      }
    }
    if (
      input.trigger === 'merchant_message' &&
      !this.waitingForMerchantMessage
    ) {
      return { outcome: 'unknown_state' as const, resumeRequired: false };
    }
    if (
      input.trigger === 'merchant' &&
      this.waitingForMerchantMessage
    ) {
      return { outcome: 'unknown_state' as const, resumeRequired: false };
    }
    this.events.set(input.answer.idempotencyKey, {
      payloadFingerprint: input.payloadFingerprint,
      resumeRequired: input.resumeDisposition === 'resume',
    });
    this.lastEventKey = input.answer.idempotencyKey;
    this.waitingForMerchantMessage = input.resumeDisposition === 'wait';
    this.lastResolutionSource = input.resolutionSource;
    this.order.push(`persist:${input.answer.idempotencyKey}`);
    return {
      outcome: 'created' as const,
      resumeRequired: input.resumeDisposition === 'resume',
      eventId: `interaction-event-${input.answer.idempotencyKey}`,
    };
  }

  markResumed(eventId: string) {
    const idempotencyKey = eventId.replace('interaction-event-', '');
    const event = this.events.get(idempotencyKey);
    if (event) event.resumeRequired = false;
    this.order.push(`resumed:${idempotencyKey}`);
  }

  async transitionInteractionEditing(
    _workspaceId: string,
    _runId: string,
    input: Parameters<
      HarnessInteractionStore['transitionInteractionEditing']
    >[2],
  ) {
    if (!this.pending) return 'stale' as const;
    if (!this.projection) {
      return 'unknown_state' as const;
    }
    if (
      this.pending.requestId !== input.requestId ||
      this.pending.revision !== input.revision ||
      this.pending.step !== input.step ||
      !(this.pending.presentation.carriers as readonly string[]).includes(
        input.carrier,
      )
    ) {
      return 'stale' as const;
    }
    const timeoutPolicy =
      this.pending.kind === 'ask_merchant'
        ? this.pending.timeoutPolicy
        : this.pending.frozen.timeoutPolicy;
    if (timeoutPolicy?.kind !== 'semantic_default') {
      return 'replayed' as const;
    }
    if (this.projection.timer.kind !== 'armed') {
      return 'unknown_state' as const;
    }
    const at = this.now().toISOString();
    const current = this.projection.timer.editingStartedAt;
    if (!input.editing && current === null) {
      return 'replayed' as const;
    }
    if (input.editing) {
      const leaseExpiresAt =
        this.projection.timer.editingLeaseExpiresAt ??
        (current === null
          ? null
          : new Date(Date.parse(current) + 30_000).toISOString());
      if (
        current !== null &&
        leaseExpiresAt !== null &&
        Date.parse(leaseExpiresAt) <= Date.parse(at)
      ) {
        this.projection.timer.deadlineAt = new Date(
          Date.parse(this.projection.timer.deadlineAt) +
            Date.parse(leaseExpiresAt) -
            Date.parse(current),
        ).toISOString();
      }
      if (
        current === null ||
        (leaseExpiresAt !== null &&
          Date.parse(leaseExpiresAt) <= Date.parse(at))
      ) {
        this.projection.timer.editingStartedAt = at;
        this.projection.timer.editingSessionId =
          input.editingSessionId;
      } else if (
        this.projection.timer.editingSessionId !==
        input.editingSessionId
      ) {
        return 'stale' as const;
      }
      this.projection.timer.editingLeaseExpiresAt = new Date(
        Date.parse(at) + 30_000,
      ).toISOString();
    } else {
      if (
        this.projection.timer.editingSessionId !==
        input.editingSessionId
      ) {
        return 'stale' as const;
      }
      const leaseExpiresAt =
        this.projection.timer.editingLeaseExpiresAt ?? at;
      const pauseEndedAt = Math.min(
        Date.parse(at),
        Date.parse(leaseExpiresAt),
      );
      const pausedFor = pauseEndedAt - Date.parse(current!);
      if (pausedFor < 0) return 'unknown_state' as const;
      this.projection.timer.deadlineAt = new Date(
        Date.parse(this.projection.timer.deadlineAt) + pausedFor,
      ).toISOString();
      this.projection.timer.editingStartedAt = null;
      this.projection.timer.editingLeaseExpiresAt = null;
      this.projection.timer.editingSessionId = null;
    }
    this.editing = input.editing;
    return 'updated' as const;
  }

  async ackInteractionRenderer(
    _workspaceId: string,
    _runId: string,
    acknowledgement: Parameters<
      HarnessInteractionStore['ackInteractionRenderer']
    >[2],
  ) {
    if (this.rendererExpired || !this.pending || !this.projection) {
      return 'stale' as const;
    }
    if (
      this.pending.requestId !== acknowledgement.requestId ||
      this.pending.revision !== acknowledgement.revision ||
      this.pending.step !== acknowledgement.step ||
      !(this.pending.presentation.carriers as readonly string[]).includes(
        acknowledgement.carrier,
      )
    ) {
      return 'stale' as const;
    }
    if (this.projection.rendererCapability === 'available') {
      return 'replayed' as const;
    }
    if (this.projection.rendererCapability !== 'unknown') {
      return 'unknown_state' as const;
    }
    this.projection.rendererCapability = 'available';
    if (this.projection.timer.kind === 'armed') {
      const acknowledgedAt = this.now();
      this.projection.timer.deadlineAt = new Date(
        acknowledgedAt.getTime() +
          this.projection.timer.timeoutSeconds * 1_000,
      ).toISOString();
      if (this.projection.timer.editingStartedAt !== null) {
        this.projection.timer.editingStartedAt = acknowledgedAt.toISOString();
        this.projection.timer.editingLeaseExpiresAt = new Date(
          acknowledgedAt.getTime() + 30_000,
        ).toISOString();
      }
    }
    return 'acked' as const;
  }

  async expireUnrenderedInteraction(
    _workspaceId: string,
    _runId: string,
    identity: {
      requestId: string;
      revision: number;
      step: string;
    },
  ) {
    if (
      !this.pending ||
      !this.projection ||
      this.pending.requestId !== identity.requestId ||
      this.pending.revision !== identity.revision ||
      this.pending.step !== identity.step
    ) {
      return 'stale' as const;
    }
    if (this.rendererExpired) return 'replayed' as const;
    if (this.projection.rendererCapability === 'available') {
      return 'available' as const;
    }
    if (this.projection.rendererCapability !== 'unknown') {
      return 'unknown_state' as const;
    }
    this.projection.rendererCapability = 'unavailable';
    this.rendererExpired = true;
    return 'expired' as const;
  }
}

function semanticDefaultEligibility(itemIds: string[]) {
  const defaultResponse = {
    kind: 'answer' as const,
    items: itemIds.map((itemId) => ({
      itemId,
      result: { kind: 'deferred' as const },
    })),
  };
  return {
    kind: 'safe' as const,
    serverEvaluated: true as const,
    effect: 'none' as const,
    quota: 'not_applicable' as const,
    defaultResponse,
    defaultResponseFingerprint: fingerprintValue(defaultResponse),
    policyRevision: 'ask-semantic-default/v1',
    conditionRevision: 'request-ask:r1',
  };
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
      timeoutPolicy: {
        kind: 'hold',
        reason:
          (options.conditionKind ?? 'existing_gate') === 'external_action'
            ? 'external_action'
            : (options.conditionKind ?? 'existing_gate') === 'quote_threshold'
              ? 'quote_threshold'
              : 'unknown',
        serverEvaluated: true,
      },
    },
    presentation: {
      carriers: ['conversation', 'task_card'],
      notification: 'none',
      renderer: 'execution_confirmation',
    },
  });
}
