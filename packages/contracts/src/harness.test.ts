import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HARNESS_STAGES,
  chipsSignalInputSchema,
  contentPackageRevisionDeliverySchema,
  creationModeSchema,
  executionConfirmationAnswerSchema,
  executionConfirmationRequestSchema,
  firstUsableDraftMetricSchema,
  harnessDecisionSnapshotSchema,
  harnessDecisionSubmitResultSchema,
  harnessInteractionEditingSchema,
  harnessInteractionMerchantMessageSchema,
  harnessInteractionRendererAckSchema,
  harnessInteractionRequestSchema,
  harnessStageSchema,
  harnessTaskSubmissionSchema,
  questionCardUnattended,
  questionCardSchema,
  structuredDecisionInputSchema,
  taskIntentInputSchema,
  todayRecommendationStateSchema,
  workflowProgressFrameSchema,
  workflowStateFrameSchema,
  workflowTokenFrameSchema,
} from './harness.js';
import {
  assistantFieldPatchBaseSchema,
  assistantFieldPatchSchema,
} from './p1.js';

function roundTrip<T>(schema: { parse(value: unknown): T }, value: unknown) {
  const parsed = schema.parse(value);
  return schema.parse(JSON.parse(JSON.stringify(parsed)));
}

test('freezes the five harness stage protocol values', () => {
  assert.deepEqual(HARNESS_STAGES, [
    'intent_naming',
    'context_injection',
    'brief_compilation',
    'execution_selection',
    'assembly_delivery',
  ]);
  assert.equal(harnessStageSchema.safeParse('intent_naming').success, true);
  assert.equal(harnessStageSchema.safeParse('上下文注入').success, false);
  assert.equal(creationModeSchema.safeParse('customized').success, true);
  assert.equal(creationModeSchema.safeParse('free').success, true);
  assert.equal(creationModeSchema.safeParse('guidance').success, false);
});

test('parses and round-trips the three frontend inputs', () => {
  const intent = {
    context: {
      workId: 'work-1',
      intent: '把新团购做一套能发的',
      scene: '日常项目曝光',
      sourceSummaries: ['门店价目表'],
    },
    assetReferences: ['asset-1'],
  };
  assert.deepEqual(roundTrip(taskIntentInputSchema, intent), intent);
  assert.equal(
    taskIntentInputSchema.safeParse({ ...intent, context: null }).success,
    false,
  );
  const task = {
    taskId: 'work-1',
    packageId: 'package-1',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: intent.context.intent,
    intent,
  };
  assert.deepEqual(roundTrip(harnessTaskSubmissionSchema, task), task);
  assert.equal(
    harnessTaskSubmissionSchema.safeParse({
      ...task,
      workspaceId: 'browser-controlled-workspace',
    }).success,
    false,
  );

  const decision = {
    idempotencyKey: 'decision-1',
    questionId: 'question-1',
    workflowRevision: 2,
    patch: {
      field: 'tone',
      value: '更像主理人本人',
      reason: '用户明确选择',
    },
    decision: { state: 'accepted', value: '更像主理人本人' },
  };
  assert.deepEqual(
    roundTrip(structuredDecisionInputSchema, decision),
    decision
  );

  const firstDraftMetric = {
    idempotencyKey: 'first-usable-draft:work-1',
    path: 'canonical_mouse',
    timeToFirstUsableDraftMs: 842,
    userActivationCount: 1,
  };
  assert.deepEqual(
    roundTrip(firstUsableDraftMetricSchema, firstDraftMetric),
    firstDraftMetric
  );
  assert.equal(
    firstUsableDraftMetricSchema.safeParse({
      ...firstDraftMetric,
      userActivationCount: 101,
    }).success,
    false
  );

  const signal = {
    chipId: 'signal-1',
    kind: 'adopted',
    taskId: 'task-1',
    value: '更像我本人',
  };
  assert.deepEqual(roundTrip(chipsSignalInputSchema, signal), signal);

  assert.equal(
    structuredDecisionInputSchema.safeParse({
      ...decision,
      decision: { state: 'enabled', value: 'invalid' },
    }).success,
    false
  );
  assert.equal(
    chipsSignalInputSchema.safeParse({ ...signal, kind: 'auto_learned' })
      .success,
    false
  );
});

test('structured decisions reuse the dynamic canonical assistant field patch schema', () => {
  assert.equal(
    structuredDecisionInputSchema.shape.patch,
    assistantFieldPatchBaseSchema
  );
  assert.equal(
    structuredDecisionInputSchema.safeParse({
      idempotencyKey: 'decision-offer-price',
      questionId: 'question-offer-price',
      workflowRevision: 2,
      patch: {
        field: 'offer_price',
        value: '398',
        reason: '补充当前任务所需的权威事实',
      },
      decision: { state: 'accepted', value: '398' },
    }).success,
    true
  );
  assert.equal(
    structuredDecisionInputSchema.safeParse({
      idempotencyKey: 'decision-tone',
      questionId: 'question-tone',
      workflowRevision: 2,
      patch: {
        field: 'tone',
        value: '克制可信',
        reason: '用户明确选择',
        unexpected: true,
      },
      decision: { state: 'accepted', value: '克制可信' },
    }).success,
    false
  );
});

test('p1 assistant field patches reject unknown fields', () => {
  assert.equal(
    assistantFieldPatchSchema.safeParse({
      field: 'hack',
      value: 'invalid',
      reason: 'unknown p1 field',
    }).success,
    false
  );
});

test('parses and round-trips progress and authoritative state frames', () => {
  const progress = {
    event: 'workflow.progress',
    data: {
      eventId: 'workflow-1:3',
      workflowId: 'workflow-1',
      workflowType: 'daily_project_exposure',
      sequence: 3,
      stage: 'brief_compilation',
      state: 'running',
      occurredAt: '2026-07-18T08:00:00.000Z',
      message: '正在把门店事实编译成创作简报',
    },
  };
  assert.deepEqual(roundTrip(workflowProgressFrameSchema, progress), progress);

  const state = {
    event: 'workflow.state',
    data: {
      workflowId: 'workflow-1',
      sourceRevision: 4,
      status: 'suspended',
      occurredAt: '2026-07-18T08:01:00.000Z',
      snapshot: { questionId: 'question-1' },
    },
  };
  assert.deepEqual(roundTrip(workflowStateFrameSchema, state), state);

  assert.equal(
    workflowProgressFrameSchema.safeParse({
      ...progress,
      data: { ...progress.data, stage: 'unknown_stage' },
    }).success,
    false
  );
  assert.equal(
    workflowStateFrameSchema.safeParse({
      ...state,
      data: { ...state.data, status: 'paused' },
    }).success,
    false
  );
});

test('terminal workflow state carries merchant action usage without internal cost fields', () => {
  const completed = {
    event: 'workflow.state',
    data: {
      workflowId: 'workflow-usage',
      sourceRevision: 4,
      status: 'success',
      occurredAt: '2026-07-29T08:01:00.000Z',
      snapshot: { packageId: 'package-usage' },
      actionUsage: {
        actionId: 'usage-record-248',
        taskId: 'workflow-usage',
        status: 'completed',
        settlementStatus: 'reconciled',
        settledUnits: 2,
        refundedUnits: 1,
      },
    },
  };
  assert.deepEqual(roundTrip(workflowStateFrameSchema, completed), completed);

  assert.equal(
    workflowStateFrameSchema.safeParse({
      ...completed,
      data: {
        ...completed.data,
        actionUsage: {
          ...completed.data.actionUsage,
          status: 'rejected',
          settledUnits: 0,
        },
      },
    }).success,
    true,
  );
  assert.equal(
    workflowStateFrameSchema.safeParse({
      ...completed,
      data: {
        ...completed.data,
        actionUsage: {
          ...completed.data.actionUsage,
          provider: 'private-provider',
        },
      },
    }).success,
    false,
  );
});

test('token frames carry replay-safe deltas on named copy channels', () => {
  const token = {
    event: 'workflow.token',
    data: {
      eventId: 'workflow-1:event:4',
      workflowId: 'workflow-1',
      sequence: 4,
      sourceRevision: 2,
      candidateId: 'c01',
      channel: 'copy.body',
      delta: '正在把真实到店细节写进正文',
      occurredAt: '2026-07-18T08:00:00.000Z',
    },
  };

  assert.deepEqual(roundTrip(workflowTokenFrameSchema, token), token);
  assert.equal(
    workflowTokenFrameSchema.safeParse({
      ...token,
      data: { ...token.data, channel: 'provider.raw_json' },
    }).success,
    false,
  );
  assert.equal(
    workflowTokenFrameSchema.safeParse({
      ...token,
      data: { ...token.data, delta: '' },
    }).success,
    false,
  );
  const { candidateId: _candidateId, ...withoutCandidate } = token.data;
  assert.equal(
    workflowTokenFrameSchema.safeParse({
      ...token,
      data: withoutCandidate,
    }).success,
    false,
  );
});

test('question card represents exactly one scoped blocking question', () => {
  const card = {
    questionId: 'question-1',
    workflowId: 'workflow-1',
    workflowRevision: 2,
    question: '这次团购价按哪个金额写？',
    options: [
      { id: 'option-a', label: '¥398' },
      { id: 'option-b', label: '¥498' },
    ],
    freeText: { enabled: true, placeholder: '输入其他价格' },
    response: {
      field: 'offer_price',
      reason: '补充本次任务缺失的权威事实',
    },
    scope: 'current_task',
  };
  assert.deepEqual(roundTrip(questionCardSchema, card), card);
  assert.equal(
    questionCardSchema.safeParse({
      ...card,
      options: [],
      freeText: { enabled: false },
    }).success,
    false
  );
  assert.equal(
    questionCardSchema.safeParse({ ...card, scope: 'global' }).success,
    false
  );
  assert.equal(
    questionCardSchema.safeParse({ ...card, unattended: 'continue' }).success,
    true
  );
  assert.equal(
    questionCardSchema.safeParse({ ...card, unattended: 'hold' }).success,
    true
  );
  assert.equal(
    questionCardSchema.safeParse({ ...card, unattended: 'release' }).success,
    false
  );
  assert.equal(questionCardUnattended(card), 'hold');
  assert.equal(
    questionCardUnattended({ ...card, unattended: 'continue' }),
    'continue'
  );
});

test('decision snapshot binds unattended policy to the core-owned timeout', () => {
  const question = questionCardSchema.parse({
    questionId: 'question-timeout',
    workflowId: 'workflow-timeout',
    workflowRevision: 1,
    question: '要补充这次活动的重点吗？',
    options: [{ id: 'option-a', label: '突出体验' }],
    freeText: { enabled: true },
    response: {
      field: 'campaign_focus',
      reason: '让这次内容更贴合你的实际情况',
    },
    unattended: 'continue',
    scope: 'current_task',
  });
  assert.equal(
    harnessDecisionSnapshotSchema.safeParse({
      question,
      reservationReleased: false,
      resolutionSource: null,
      status: 'pending',
      timeoutSeconds: 18,
    }).success,
    true
  );
  assert.equal(
    harnessDecisionSnapshotSchema.safeParse({
      question,
      reservationReleased: true,
      resolutionSource: null,
      status: 'pending',
      timeoutSeconds: null,
    }).success,
    true
  );
  assert.equal(
    harnessDecisionSnapshotSchema.safeParse({
      question: { ...question, unattended: 'hold' },
      reservationReleased: false,
      resolutionSource: null,
      status: 'pending',
      timeoutSeconds: 18,
    }).success,
    false
  );
});

test('reservation release is orthogonal to a pending decision resolution', () => {
  const snapshot = harnessDecisionSnapshotSchema.parse({
    question: questionCardSchema.parse({
      questionId: 'question-released',
      workflowId: 'workflow-released',
      workflowRevision: 1,
      question: '这次活动价是多少？',
      options: [],
      freeText: { enabled: true },
      response: {
        field: 'offer_price',
        reason: '补充本次任务所需信息',
      },
      unattended: 'hold',
      scope: 'current_task',
    }),
    reservationReleased: true,
    resolutionSource: null,
    status: 'pending',
    timeoutSeconds: null,
  });

  assert.equal(snapshot.status, 'pending');
  assert.equal(snapshot.reservationReleased, true);
  assert.equal(snapshot.resolutionSource, null);
});

test('decision receipts preserve timeout races and late-answer successors', () => {
  assert.deepEqual(
    harnessDecisionSubmitResultSchema.parse({
      consumedByOther: true,
      eventId: null,
    }),
    { consumedByOther: true, eventId: null }
  );
  assert.deepEqual(
    harnessDecisionSubmitResultSchema.parse({
      eventId: 'event-late',
      replayed: false,
      successor: {
        snapshotId: 'snapshot-late',
        workflowId: 'workflow-late',
      },
    }),
    {
      eventId: 'event-late',
      replayed: false,
      successor: {
        snapshotId: 'snapshot-late',
        workflowId: 'workflow-late',
      },
    }
  );
});

test('semantic defaults remain distinct from carrier timeout cancellation', () => {
  const question = questionCardSchema.parse({
    questionId: 'question-system-default',
    workflowId: 'workflow-system-default',
    workflowRevision: 1,
    question: '没有补充时，是否按推荐重点继续？',
    options: [{ id: 'continue', label: '按推荐继续' }],
    freeText: { enabled: false },
    response: {
      field: 'campaign_focus',
      reason: '采用商家可见的安全默认值',
    },
    unattended: 'continue',
    scope: 'current_task',
  });

  assert.equal(
    harnessDecisionSnapshotSchema.safeParse({
      question,
      resolutionSource: 'system_default',
      status: 'resolved',
      timeoutSeconds: null,
    }).success,
    true,
  );
});

test('execution confirmation freezes server conditions and all three merchant outcomes', () => {
  const request = {
    requestId: 'execution-confirmation-1',
    runId: 'run-1',
    step: 'execution_selection',
    revision: 2,
    kind: 'execution_confirmation',
    frozen: {
      executionSnapshotRef: { id: 'snapshot-task-1', revision: 1 },
      quoteRevision: 'quote-r7',
      params: [
        {
          key: 'aspectRatio',
          label: '画面比例',
          value: '3:4 竖版',
          hint: '适合朋友圈、小红书，也够印展架',
        },
      ],
      debitPreview: [{ resource: 'image', quantity: 1 }],
      condition: {
        kind: 'existing_gate',
        required: true,
        serverEvaluated: true,
      },
      timeoutPolicy: { kind: 'hold' },
    },
    presentation: {
      carriers: ['conversation'],
      notification: 'none',
      renderer: 'execution_confirmation',
    },
  } as const;

  assert.deepEqual(executionConfirmationRequestSchema.parse(request), request);
  assert.deepEqual(harnessInteractionRequestSchema.parse(request), request);
  for (const response of [
    { kind: 'approved' },
    { kind: 'rejected', feedback: '换成方图再做' },
    { kind: 'rejected' },
  ] as const) {
    assert.deepEqual(
      executionConfirmationAnswerSchema.parse({
        requestId: request.requestId,
        revision: request.revision,
        idempotencyKey: `answer-${response.kind}-${'feedback' in response}`,
        resume: { runId: request.runId, step: request.step },
        response,
      }).response,
      response,
    );
  }
  assert.equal(
    executionConfirmationRequestSchema.safeParse({
      ...request,
      frozen: {
        ...request.frozen,
        params: [{ ...request.frozen.params[0], editable: true }],
      },
    }).success,
    false,
  );
});

test('merchant continuation messages are strict typed interaction input', () => {
  const message = {
    requestId: 'execution-request-1',
    revision: 2,
    step: 'execution_selection',
    carrier: 'conversation',
    idempotencyKey: 'merchant-message-1',
    message: '请换成更稳妥的方案',
  } as const;
  assert.deepEqual(
    harnessInteractionMerchantMessageSchema.parse(message),
    message,
  );
  assert.equal(
    harnessInteractionMerchantMessageSchema.safeParse({
      ...message,
      runId: 'forged-path-authority',
    }).success,
    false,
  );
  assert.equal(
    harnessInteractionMerchantMessageSchema.safeParse({
      idempotencyKey: message.idempotencyKey,
      message: message.message,
    }).success,
    false,
  );
});

test('renderer and editing signals carry the exact durable request identity', () => {
  const acknowledgement = {
    requestId: 'request-1',
    revision: 2,
    step: 'context_injection',
    carrier: 'conversation',
  } as const;
  assert.deepEqual(
    harnessInteractionRendererAckSchema.parse(acknowledgement),
    acknowledgement,
  );
  assert.deepEqual(
    harnessInteractionEditingSchema.parse({
      ...acknowledgement,
      editing: true,
      editingSessionId: 'editing-session-1',
    }),
    {
      ...acknowledgement,
      editing: true,
      editingSessionId: 'editing-session-1',
    },
  );
  assert.equal(
    harnessInteractionEditingSchema.safeParse({
      ...acknowledgement,
      editing: true,
    }).success,
    false,
  );
  assert.equal(
    harnessInteractionRendererAckSchema.safeParse({
      ...acknowledgement,
      revision: '2',
    }).success,
    false,
  );
  assert.equal(
    harnessInteractionEditingSchema.safeParse({
      ...acknowledgement,
      editing: true,
      editingSessionId: 'editing-session-1',
      runId: 'forged-run',
    }).success,
    false,
  );
});

test('execution semantic defaults stay closed until resource authority is available', () => {
  const base = {
    requestId: 'execution-safe-default',
    runId: 'run-safe-default',
    step: 'execution_selection',
    revision: 1,
    kind: 'execution_confirmation',
    frozen: {
      executionSnapshotRef: { id: 'snapshot-safe', revision: 1 },
      quoteRevision: 'quote-safe',
      params: [],
      debitPreview: [],
      condition: {
        kind: 'existing_gate',
        required: true,
        serverEvaluated: true,
      },
      timeoutPolicy: {
        kind: 'semantic_default',
        timeoutSeconds: 30,
        eligibility: {
          kind: 'safe',
          serverEvaluated: true,
        },
      },
    },
    presentation: {
      carriers: ['conversation'],
      notification: 'none',
      renderer: 'execution_confirmation',
    },
  } as const;

  assert.equal(executionConfirmationRequestSchema.safeParse(base).success, false);
  for (const kind of [
    'quote_threshold',
    'external_action',
    'unknown',
  ] as const) {
    assert.equal(
      executionConfirmationRequestSchema.safeParse({
        ...base,
        frozen: {
          ...base.frozen,
          condition: {
            ...base.frozen.condition,
            kind,
          },
        },
      }).success,
      false,
    );
  }
  assert.equal(
    executionConfirmationRequestSchema.safeParse({
      ...base,
      frozen: {
        ...base.frozen,
        condition: {
          ...base.frozen.condition,
          kind: 'unknown',
        },
        timeoutPolicy: {
          kind: 'hold',
          reason: 'unknown',
          serverEvaluated: true,
        },
      },
    }).success,
    true,
  );
});

test('delivery reference keeps aggregate revision separate from event sequence', () => {
  const delivery = {
    packageId: 'package-1',
    versionId: 'version-3',
    revision: 7,
  };
  assert.deepEqual(
    roundTrip(contentPackageRevisionDeliverySchema, delivery),
    delivery
  );
  assert.equal(
    contentPackageRevisionDeliverySchema.safeParse({
      ...delivery,
      revision: -1,
    }).success,
    false
  );
  assert.equal(
    contentPackageRevisionDeliverySchema.safeParse({ ...delivery, sequence: 7 })
      .success,
    false
  );
});

test('today recommendation is current only for the same workspace and fact revision', () => {
  const recommendation = {
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    factsRevision: 2,
    packageId: 'package-1',
    versionId: 'version-1',
    title: '本周猫眼项目推荐',
    body: '使用本店已确认的猫眼项目和价格制作的完整内容。',
    whyNow: '当前项目和换季场景匹配',
    factReferences: ['store_fact:offer-price:2'],
    customerAction: '私信预约',
    sourceLabel: '把新团购做一套能发的',
    createdAt: '2026-07-18T08:00:00.000Z',
    opportunity: {
      opportunityId: 'opportunity-1',
      status: 'active',
      source: 'https://example.com/city-hair-color',
      sourceType: 'user_link',
      capturedAt: '2026-07-18T08:00:00.000Z',
      expiresAt: '2026-07-19T08:00:00.000Z',
      platforms: ['xiaohongshu'],
      region: '上海静安',
      targetAudience: '准备换夏季发色的同城顾客',
      matchedStoreReferences: ['store_fact:service-1:2'],
      relevanceExplanation: '门店本周主推低损伤染发。',
      reusableMechanism: '借夏季显白发色问题给出本店原创建议。',
      expectedAction: '私信预约发质判断。',
      evergreenFallback: '转为常青发色选择指南。',
      protectedExpressionCopied: false,
    },
  };
  assert.deepEqual(
    roundTrip(todayRecommendationStateSchema, {
      workspaceId: 'workspace-1',
      currentFactsRevision: 2,
      recommendation,
      stale: false,
    }).recommendation,
    recommendation,
  );
  assert.equal(
    todayRecommendationStateSchema.safeParse({
      workspaceId: 'workspace-1',
      currentFactsRevision: 3,
      recommendation,
      stale: false,
    }).success,
    false,
  );
  assert.equal(
    todayRecommendationStateSchema.safeParse({
      workspaceId: 'workspace-1',
      currentFactsRevision: 0,
      recommendation: { ...recommendation, factsRevision: 0 },
      stale: false,
    }).success,
    false,
  );
});
