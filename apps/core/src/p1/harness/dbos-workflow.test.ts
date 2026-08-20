import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  planConfirmationDecisionSchema,
  questionCardSchema,
  resumeInterruptCommandSchema,
  type InterruptPayload,
  type ResumeInterruptCommand,
  type StructuredDecisionInput,
} from '@meiye/contracts';
import { ADMIN_CONFIG_KEY_CLASSIFICATION } from '../../assembly/domain-rules.js';
import { HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY } from '../admin-config/foundation-module.js';

import {
  InterruptProtocolService,
  MemoryInterruptStore,
} from './interrupt-protocol.js';
import {
  HarnessExecutionFencePauseError,
  HarnessExecutionFenceSafeStopError,
} from './context-fence.js';
import { createCanonicalCarrierUnitRecipeRegistry } from './carrier-unit-recipes.js';
import { HarnessInteractionError } from './interaction-service.js';
import { normalizeHarnessTerminalFailure } from './terminal-failure.js';
import {
  buildExecutionPlanSnapshot,
  ExecutionPlanAdmissionError,
  ExecutionPlanAdmissionService,
  freezeExecutionPlanContent,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';
import { MemoryExecutionPlanSnapshotStore } from './memory-execution-plan-admission-store.js';

import {
  commitHarnessBillingOrSchedule,
  assertHarnessInteractionContinuationLayout,
  confirmationCardDecision,
  confirmationCardHoldExpired,
  contextFencePauseQuestion,
  createHarnessInterruptProtocolPort,
  createHarnessInterruptResumeBridge,
  failHarnessWorkflowPreservingExecutionError,
  harnessBillingSettlementInput,
  harnessInterruptMirrorInput,
  interruptQuestionFromPayload,
  interruptResumeDecision,
  invokeHarnessAskMerchantPrimitive,
  readConfirmationCardHoldTimeoutSeconds,
  readConfirmationCardTimeoutSeconds,
  refundHarnessBillingPreservingFailure,
  registerHarnessDbosWorkflow,
  resolveHarnessBoundedExecutionContinuation,
  resumeHarnessDbosInteractionWorkflow,
  resumeHarnessDbosWorkflow,
  sampleProductionL05,
  suspensionQuestionFailOpen,
  settleHarnessCancellation,
  settleHarnessTerminalSuccess,
  HarnessInteractionLayoutResetRequiredError,
  HARNESS_INTERACTION_CONTINUATION_LAYOUT,
  type HarnessAskMerchantPrimitivePort,
  type HarnessBillingSettlementPort,
  type HarnessDbosWorkflowOptions,
} from './dbos-workflow.js';
import {
  HarnessBillingCompensationConflictError,
  isHarnessBillingCompensationConflictError,
} from './billing-compensation.js';
import type { AdminConfigRepository } from '../admin-config/foundation-module.js';
import {
  executionPlanAdmissionWorkflowId,
  type HarnessWorkflowInput,
} from './task-admission.js';
import {
  BillingIdentityError,
  settlementIdempotencyKey,
} from '../execution-spine/billing-identity.js';
import {
  HarnessWorkflowCancellation,
  type HarnessStagePorts,
} from './workflow-core.js';

const settlement = {
  workspaceId: 'workspace-billing-failure',
  taskId: 'task-billing-failure',
  billingTaskId: 'task-billing-failure',
  billingIdentity: {
    workspaceId: 'workspace-billing-failure',
    taskId: 'task-billing-failure',
    workId: 'work-billing-failure',
    workflowId: 'task-billing-failure',
    quoteRef: { id: 'quote-billing-failure', revision: 'quote-revision-1' },
    reservationId: 'consume:task:task-billing-failure',
    carrierUnitId: 'single',
    carrierUnitIds: ['single'],
    carrierBillableUnits: 1,
  },
  quoteId: 'quote-billing-failure',
  quoteRevision: 'quote-revision-1',
};

const multiCarrierSettlement = {
  ...settlement,
  taskId: 'task-billing-failure:carrier-note',
  billingIdentity: {
    ...settlement.billingIdentity,
    workflowId: 'task-billing-failure:carrier-note',
    carrierUnitId: 'note',
    carrierUnitIds: ['copy', 'note'],
  },
};

const baseHarnessInput: HarnessWorkflowInput = {
    actorId: 'actor-test',
    workspaceId: 'workspace-test',
    packageId: 'package-test',
    expectedRevision: 0,
    workflowRevision: 0,
    creationMode: 'customized',
    rawInput: 'test input',
    intent: {
      context: {
        workId: 'work-test',
        intent: 'test intent',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
};

function harnessInput(): HarnessWorkflowInput;
function harnessInput<T extends object>(
  overrides: T,
): HarnessWorkflowInput & T;
function harnessInput<T extends object>(overrides?: T) {
  return Object.assign({}, baseHarnessInput, overrides);
}

test('context fence drift becomes a held typed question, not a terminal failure', () => {
  const question = contextFencePauseQuestion({
    workflowId: 'workflow-fence',
    workflowRevision: 4,
    error: new HarnessExecutionFencePauseError(
      '已引用的价格发生变化，请确认后继续。',
      { quote: { frozen: 1, live: 2 } },
    ),
  });
  assert.equal(question.workflowId, 'workflow-fence');
  assert.equal(question.workflowRevision, 4);
  assert.equal(question.unattended, 'hold');
  assert.equal(question.response.field, 'context_fence_acknowledgement');
  assert.match(question.questionId, /context-fence/u);
});

test('invalid suspension data fails open to a valid held recovery card', () => {
  const question = suspensionQuestionFailOpen(
    {
      questionId: 'broken-question',
      workflowId: 'wrong-workflow',
      workflowRevision: -1,
      question: '',
      options: [],
      freeText: { enabled: false },
      response: { field: '', reason: '' },
      scope: 'current_task',
    },
    {
      workflowId: 'workflow-1',
      workflowRevision: 3,
    },
  );

  assert.deepEqual(questionCardSchema.parse(question), question);
  assert.equal(question.workflowId, 'workflow-1');
  assert.equal(question.workflowRevision, 3);
  assert.equal(question.unattended, 'hold');
  assert.equal(question.response.field, 'suspension_recovery');
  assert.equal(question.freeText.enabled, true);
});

test('resume rejects an invalid runtime command before resolving or sending', async (t) => {
  let resolverCalls = 0;
  let sendCalls = 0;
  t.mock.method(DBOS, 'send', async () => {
    sendCalls += 1;
  });

  await assert.rejects(
    resumeHarnessDbosWorkflow(
      'workspace-1',
      'task-1',
      { questionId: 'question-1' },
      {
        async workflowRuntimeId() {
          resolverCalls += 1;
          return 'runtime-1';
        },
      },
    ),
  );

  assert.equal(resolverCalls, 0);
  assert.equal(sendCalls, 0);
});

test('resume accepts a valid command after rejecting invalid runtime data', async (t) => {
  const sent: unknown[][] = [];
  let resolverCalls = 0;
  t.mock.method(DBOS, 'send', async (...args: unknown[]) => {
    sent.push(args);
  });
  const resolver = {
    async workflowRuntimeId() {
      resolverCalls += 1;
      return 'runtime-1';
    },
  };

  await assert.rejects(
    resumeHarnessDbosWorkflow(
      'workspace-1',
      'task-1',
      { questionId: 'question-1' },
      resolver,
    ),
  );

  const command: StructuredDecisionInput = {
    idempotencyKey: 'decision-1',
    questionId: 'question-1',
    workflowRevision: 1,
    patch: {
      field: 'offer_price',
      reason: '补充当前任务所需的权威事实',
      value: '当前团购价 398 元',
    },
    decision: {
      state: 'accepted',
      value: '当前团购价 398 元',
    },
  };
  await resumeHarnessDbosWorkflow(
    'workspace-1',
    'task-1',
    command,
    resolver,
  );

  assert.equal(resolverCalls, 1);
  assert.deepEqual(sent, [
    [
      'runtime-1',
      command,
      'structured-decision:question-1',
      'harness-decision:workspace-1:runtime-1:decision-1',
    ],
  ]);
});

test('exact core hold expiry resumes DBOS with a scoped cancellation signal', async (t) => {
  const sent: unknown[][] = [];
  t.mock.method(DBOS, 'send', async (...args: unknown[]) => {
    sent.push(args);
  });
  const question = questionCardSchema.parse({
    questionId: 'question-expired-1',
    workflowId: 'task-expired-1',
    workflowRevision: 3,
    question: '这次想采用哪种笔记风格？',
    options: [{ id: 'style-a', label: '克制专业' }],
    freeText: { enabled: false },
    response: { field: 'note_style', reason: '选择表达风格' },
    scope: 'current_task',
  });

  await resumeHarnessDbosWorkflow(
    'workspace-expired-1',
    question.workflowId,
    confirmationCardHoldExpired(question),
    { async workflowRuntimeId() { return 'runtime-expired-1'; } },
  );

  assert.deepEqual(sent, [
    [
      'runtime-expired-1',
      {
        cancelled: true,
        interruptId: question.questionId,
        merchantMessage: '超时未选择，本次任务已取消，积分已退回',
        resolutionSource: 'core_hold_expired',
        revision: question.workflowRevision,
      },
      `structured-decision:${question.questionId}`,
      `harness-decision:workspace-expired-1:runtime-expired-1:${question.questionId}:r3:core_hold_expired`,
    ],
  ]);
});

test('interaction resume keeps its typed payload and idempotency on the existing decision topic', async (t) => {
  const sent: unknown[][] = [];
  t.mock.method(DBOS, 'send', async (...args: unknown[]) => {
    sent.push(args);
  });
  const signal = {
    kind: 'harness_interaction_resume',
    schemaVersion: 'v1',
    idempotencyKey: 'interaction-answer-1',
    interactionKind: 'ask_merchant',
    requestId: 'question-1',
    revision: 1,
    runId: 'task-1',
    step: 'context_injection',
    resumeData: {
      kind: 'answer',
      items: [
        {
          itemId: 'offer_price',
          result: { kind: 'answer', value: '398 元' },
        },
      ],
    },
    resolutionSource: 'decision',
  } as const;

  await resumeHarnessDbosInteractionWorkflow(
    'workspace-1',
    'task-1',
    signal,
    {
      async workflowRuntimeId() {
        return 'runtime-1';
      },
    },
  );

  assert.deepEqual(sent, [
    [
      'runtime-1',
      signal,
      'structured-decision:question-1',
      'harness-interaction:workspace-1:runtime-1:interaction-answer-1',
    ],
  ]);
});

test('only the current durable reask revision resumes the original DBOS question topic', () => {
  const question = questionCardSchema.parse({
    questionId: 'question-reask',
    workflowId: 'task-reask',
    workflowRevision: 1,
    question: '活动到哪天结束？',
    options: [],
    freeText: { enabled: true },
    response: {
      field: 'window',
      reason: '需要商家补充活动期限',
    },
    unattended: 'continue',
    scope: 'current_task',
  });

  const signal = {
    kind: 'harness_interaction_resume',
    schemaVersion: 'v1',
    idempotencyKey: 'answer-reask-r2',
    interactionKind: 'ask_merchant',
    requestId: question.questionId,
    revision: 2,
    runId: question.workflowId,
    step: 'context_injection',
    resumeData: {
      kind: 'answer',
      items: [
        {
          itemId: 'window',
          result: { kind: 'answer', value: '2026-08-31' },
        },
      ],
    },
    resolutionSource: 'decision',
  } as const;
  const command = confirmationCardDecision(question, signal, 2);

  assert.equal(command.idempotencyKey, 'answer-reask-r2');
  assert.equal(command.workflowRevision, question.workflowRevision);
  assert.equal(command.decision.value, '2026-08-31');
  assert.throws(() =>
    confirmationCardDecision(
      question,
      { ...signal, revision: 999 },
      2,
    ),
  );
});

test('a grouped interaction answer fails closed at the single-question DBOS consumer', () => {
  const question = questionCardSchema.parse({
    questionId: 'question-single-consumer',
    workflowId: 'task-single-consumer',
    workflowRevision: 1,
    question: '活动到哪天结束？',
    options: [],
    freeText: { enabled: true },
    response: {
      field: 'window',
      reason: '需要商家补充活动期限',
    },
    unattended: 'continue',
    scope: 'current_task',
  });

  assert.throws(
    () =>
      confirmationCardDecision(question, {
        kind: 'harness_interaction_resume',
        schemaVersion: 'v1',
        idempotencyKey: 'answer-grouped',
        interactionKind: 'ask_merchant',
        requestId: question.questionId,
        revision: question.workflowRevision,
        runId: question.workflowId,
        step: 'context_injection',
        resumeData: {
          kind: 'answer',
          items: [
            {
              itemId: 'window',
              result: { kind: 'answer', value: '2026-08-31' },
            },
            {
              itemId: 'offer_price',
              result: { kind: 'answer', value: '398 元' },
            },
          ],
        },
        resolutionSource: 'decision',
      }),
    /grouped workflow consumer/u,
  );
});

test('bounded continuation rejects a forged capability result before resolving a raised limit', async () => {
  const request = harnessInput({
    workspaceId: 'workspace-1',
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 1,
      maxCostCents: 'unset',
      maxWallClockMs: 'unset',
      maxDelegations: 'unset',
      requiredLimits: ['maxIterations'],
      consumption: {
        iterations: 1,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: 'limit_reached',
      triggeredLimit: 'maxIterations',
    },
  });
  const suspension = {
    state: 'suspended' as const,
    snapshot: request.boundedExecution!,
    currentBest: null,
    unmetExplanation: '还需要一次尝试',
    resumable: true as const,
  };
  const command: StructuredDecisionInput = {
    idempotencyKey: 'decision-bounded-1',
    questionId: 'workflow-1:execution-selection:bounded:r1:a1',
    workflowRevision: 1,
    patch: {
      field: 'bounded_execution_continuation',
      reason: '请求服务端为本次有界执行生成后继钉扎',
      value: '提高上限后继续',
    },
    decision: { state: 'accepted', value: '提高上限后继续' },
  };
  let resolverCalls = 0;

  await assert.rejects(
    resolveHarnessBoundedExecutionContinuation(
      {
        workflowId: 'workflow-1',
        request,
        suspension,
        command,
        authorization: {
          kind: 'explicit_bounded_continue',
          questionId: command.questionId,
          workflowRevision: command.workflowRevision,
          field: command.patch.field,
          value: command.patch.value,
        } as never,
      },
      {
        async capability() {
          throw new Error('Capability must be checked before this seam.');
        },
        async resolve() {
          resolverCalls += 1;
          return { limit: 'maxIterations', value: 2 };
        },
      },
    ) as Promise<unknown>,
    /explicit workflow authorization seam/u,
  );
  assert.equal(resolverCalls, 0);
});

test('confirmation-card hold and continuation waits read admin-config', async () => {
  const values = new Map([
    ['harness.confirmation_card.timeout_seconds', 45],
    ['harness.confirmation_card.hold_timeout_seconds', 86_400],
  ]);
  const config: Pick<AdminConfigRepository, 'get'> = {
    async get(_scope: 'global', _workspaceId: string, key: string) {
      const value = values.get(key);
      return value === undefined
        ? null
        : {
            key,
            scope: 'global' as const,
            workspaceId: '__global__',
            value,
            revision: 1,
            status: 'applied' as const,
            rolledBackToRevision: null,
            actorId: 'test',
            reason: 'test',
            correlationId: `test:${key}`,
            createdAt: '2026-07-18T00:00:00.000Z',
          };
    },
  };

  assert.equal(await readConfirmationCardTimeoutSeconds(config), 45);
  assert.equal(await readConfirmationCardHoldTimeoutSeconds(config), 86_400);
  assert.equal(await readConfirmationCardHoldTimeoutSeconds(), 172_800);
  values.set('harness.confirmation_card.hold_timeout_seconds', 3_599);
  await assert.rejects(
    readConfirmationCardHoldTimeoutSeconds(config),
    /integer from 3600 to 172800/u,
  );
});

test('hold config is frozen inside the pending step and exposed as hot-read wiring', () => {
  const workflowSource = readFileSync(
    new URL('./dbos-workflow.ts', import.meta.url),
    'utf8',
  );
  const pendingStepStart = workflowSource.indexOf(
    'const pendingProjection = await DBOS.runStep(',
  );
  const pendingStepEnd = workflowSource.indexOf(
    "await DBOS.setEvent('pending-structured-decision'",
    pendingStepStart,
  );
  assert.ok(pendingStepStart >= 0);
  assert.ok(pendingStepEnd > pendingStepStart);
  const pendingStep = workflowSource.slice(pendingStepStart, pendingStepEnd);
  const primitiveCall = pendingStep.indexOf(
    'await invokeHarnessAskMerchantPrimitive(',
  );
  const canonicalRegistration = pendingStep.indexOf(
    'await persistence.registerPending(',
  );
  assert.ok(primitiveCall >= 0);
  assert.ok(canonicalRegistration > primitiveCall);
  assert.equal(pendingStep.match(/DBOS\.runStep\(/gu)?.length, 1);
  assert.match(
    pendingStep,
    /\{ name: `persist-pending-\$\{question\.questionId\}` \}/u,
  );
  assert.match(
    pendingStep,
    /await readConfirmationCardHoldTimeoutSeconds\(config\)/u,
  );

  assert.ok(
    ADMIN_CONFIG_KEY_CLASSIFICATION.hotReadKeys.includes(
      HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
    ),
  );
  assert.ok(
    ADMIN_CONFIG_KEY_CLASSIFICATION.wiredKeys.includes(
      HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
    ),
  );
});

test('typed timeout persistence uses the production system-default owner', () => {
  const workflowSource = readFileSync(
    new URL('./dbos-workflow.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    workflowSource,
    /pendingProjection\?\.interactionRequest/u,
  );
  assert.match(
    workflowSource,
    /interactions\.submitSystemDefault/u,
  );
  assert.match(
    workflowSource,
    /persist-system-default-/u,
  );
  assert.match(
    workflowSource,
    /interactions\.expireUnrendered/u,
  );
  assert.match(
    workflowSource,
    /interactionRequest\.revision/u,
  );
  assert.match(
    workflowSource,
    /waitForTypedInteractionAfterTimeout/u,
  );
  assert.match(
    workflowSource,
    /DBOS\.recv<unknown>\([\s\S]*timeoutSeconds: input\.timeoutSeconds/u,
  );
  assert.match(
    workflowSource,
    /persist-renderer-unavailable-/u,
  );
  const mainSource = readFileSync(
    new URL('../../assembly/api-runtime.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    mainSource,
    /askMerchant:\s*p1HarnessAskInvoker,\s*interactions:\s*harnessInteractions/u,
  );
});

test('typed interaction continuation layouts fail closed unless the frozen marker is current', () => {
  const typedProjection = {
    timeoutSeconds: 30,
    interactionRequest: { requestId: 'request-layout' },
  };

  for (const projection of [
    typedProjection,
    {
      ...typedProjection,
      interactionContinuationLayout: 'future_layout_v2',
    },
  ]) {
    assert.throws(
      () => assertHarnessInteractionContinuationLayout(projection),
      (error: unknown) =>
        error instanceof HarnessInteractionLayoutResetRequiredError &&
        error.code === 'HARNESS_INTERACTION_LAYOUT_RESET_REQUIRED',
    );
  }
  assert.doesNotThrow(() =>
    assertHarnessInteractionContinuationLayout({
      ...typedProjection,
      interactionContinuationLayout:
        HARNESS_INTERACTION_CONTINUATION_LAYOUT,
    }),
  );
  assert.doesNotThrow(() =>
    assertHarnessInteractionContinuationLayout({ timeoutSeconds: null }),
  );
});

test('the typed layout marker is frozen before the no-step replay gate', () => {
  const workflowSource = readFileSync(
    new URL('./dbos-workflow.ts', import.meta.url),
    'utf8',
  );
  const pendingStepStart = workflowSource.indexOf(
    'const pendingProjection = await DBOS.runStep(',
  );
  const pendingStepEnd = workflowSource.indexOf(
    "await DBOS.setEvent('pending-structured-decision'",
    pendingStepStart,
  );
  const pendingStep = workflowSource.slice(pendingStepStart, pendingStepEnd);

  assert.match(
    pendingStep,
    /interactionContinuationLayout:\s*HARNESS_INTERACTION_CONTINUATION_LAYOUT/u,
  );
  assert.match(
    pendingStep,
    /assertHarnessInteractionContinuationLayout\(pendingProjection\)/u,
  );
  assert.doesNotMatch(
    pendingStep,
    /interactionContinuationLayout\s*\?\?/u,
  );
  assert.ok(
    pendingStep.indexOf('assertHarnessInteractionContinuationLayout(') >
      pendingStep.lastIndexOf('DBOS.runStep('),
  );
});

test('U14: snapshot-less durable replay is archived fail-closed before layout reset or settlement', async (t) => {
  const workflowId = 'workflow-pre-a9-layout';
  const workspaceId = 'workspace-pre-a9-layout';
  const question = questionCardSchema.parse({
    questionId: `${workflowId}:offer-price`,
    workflowId,
    workflowRevision: 1,
    question: '当前团购价是多少？',
    options: [],
    freeText: { enabled: true },
    response: {
      field: 'offer_price',
      reason: '补充当前任务所需的权威事实',
    },
    unattended: 'continue',
    semanticDefaultAuthority: {
      kind: 'non_resource_no_effect',
      source: 'intent_gap',
      revision: 'intent-gap/v1',
    },
    scope: 'current_task',
  });
  const stepNames: string[] = [];
  const sideEffects: string[] = [];
  const workflowIdDescriptor = Object.getOwnPropertyDescriptor(
    DBOS,
    'workflowID',
  );
  Object.defineProperty(DBOS, 'workflowID', {
    configurable: true,
    get: () => workflowId,
  });
  t.after(() => {
    if (workflowIdDescriptor) {
      Object.defineProperty(DBOS, 'workflowID', workflowIdDescriptor);
    }
  });
  t.mock.method(
    DBOS,
    'registerWorkflow',
    ((workflow: unknown) => workflow) as typeof DBOS.registerWorkflow,
  );
  t.mock.method(
    DBOS,
    'runStep',
    async <T>(
      operation: () => Promise<T>,
      options?: { name?: string },
    ): Promise<T> => {
      stepNames.push(options?.name ?? 'unnamed');
      if (options?.name === `persist-pending-${question.questionId}`) {
        return {
          timeoutSeconds: 30,
          holdTimeoutSeconds: null,
          interactionRequest: { requestId: question.questionId },
        } as T;
      }
      return operation();
    },
  );
  t.mock.method(DBOS, 'now', async () => Date.now());
  t.mock.method(DBOS, 'writeStream', async () => {});
  t.mock.method(DBOS, 'setEvent', async () => {
    sideEffects.push('set-event');
  });
  t.mock.method(DBOS, 'closeStream', async () => {
    sideEffects.push('close-stream');
  });
  const unreachableStage = async (): Promise<never> => {
    throw new Error('The layout gate must run before later Harness stages.');
  };
  const stages: HarnessStagePorts = {
    async nameIntent() {
      return {
        declaration: {
          normalizedIntent: '推广本店团购',
          taskType: 'promotion_groupbuy_conversion',
          deliveryLayer: 'copy',
          relevantAssetCategories: ['promotion_activity'],
          usedAssetCategories: [],
          route: 'guidance',
          routingSource: 'model',
          implicitConstraints: [],
        },
        blockingQuestion: question,
      };
    },
    injectContext: unreachableStage,
    fenceContext: unreachableStage,
    compileBrief: unreachableStage,
    executeAndSelect: unreachableStage,
    assembleAndDeliver: unreachableStage,
  };
  const workflow = registerHarnessDbosWorkflow(
    stages,
    {
      async registerPending() {
        throw new Error('A replayed pending step must not execute its closure.');
      },
      async readPending() {
        return question;
      },
      async recordStageTrace() {},
      async recordTerminalFailure() {
        sideEffects.push('terminal-failure');
      },
    },
    {
      billing: {
        async commit() {
          sideEffects.push('commit');
        },
        async refund() {
          sideEffects.push('refund');
        },
        async scheduleCompensation() {
          sideEffects.push('schedule-compensation');
        },
      },
    },
  );
  const request = harnessInput({
    workspaceId,
    workflowRevision: 1,
    usageReservation: {
      id: `usage-reservation-${workflowId}`,
      units: [{ resource: 'copy', quantity: 1 }],
    },
  });

  await assert.rejects(
    workflow({ workflowId, request }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Legacy durable replay is archived fail-closed (U14).',
  );
  assert.deepEqual(sideEffects, []);
  assert.equal(
    stepNames.some((name) =>
      /terminal|commit|refund|compensation|system-default|renderer/u.test(
        name,
      ),
    ),
    false,
  );
});

function mockDbosRuntime(t: TestContext, workflowId: string) {
  const workflowIdDescriptor = Object.getOwnPropertyDescriptor(
    DBOS,
    'workflowID',
  );
  Object.defineProperty(DBOS, 'workflowID', {
    configurable: true,
    get: () => workflowId,
  });
  t.after(() => {
    if (workflowIdDescriptor) {
      Object.defineProperty(DBOS, 'workflowID', workflowIdDescriptor);
    }
  });
  t.mock.method(
    DBOS,
    'registerWorkflow',
    ((workflow: unknown) => workflow) as typeof DBOS.registerWorkflow,
  );
  const stepNames: string[] = [];
  t.mock.method(
    DBOS,
    'runStep',
    async <T>(
      operation: () => Promise<T>,
      options?: { name?: string },
    ): Promise<T> => {
      stepNames.push(options?.name ?? 'unnamed');
      return operation();
    },
  );
  t.mock.method(DBOS, 'now', async () => Date.now());
  t.mock.method(DBOS, 'writeStream', async () => {});
  t.mock.method(DBOS, 'setEvent', async () => {});
  t.mock.method(DBOS, 'closeStream', async () => {});
  return stepNames;
}

function admission4AFrozenContent(): ExecutionPlanFrozenContent {
  return {
    planId: 'plan-4a',
    planRevision: 1,
    intentDeclaration: { summary: '4A 复现固定内容' },
    contextBundleRef: { bundleId: 'bundle-4a', revision: 1, hash: 'ctx-hash-4a' },
    executionPlan: {
      schemaVersion: 'compiled-execution-plan/v1',
      units: [{ unitId: 'unit-4a', unitType: 'copy.generate', primitive: 'generate' }],
      dependencyGroups: [{ groupId: 'g-4a', unitIds: ['unit-4a'] }],
      boundedRetry: {
        'unit-4a': { maxAttempts: 1, maxCostCents: 0, retry: { enabled: false } },
      },
    },
    deliverables: [{ deliverableId: 'd-4a', kind: 'copy', quantity: 1 }],
    promptRevisionRefs: { copyGeneration: { key: 'copyGeneration', version: 'v1' } },
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-4a', revision: 1 },
    rightsRevisionRefs: ['rights-4a'],
    factRevisionRefs: ['fact-4a'],
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 10,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
      requiredLimits: ['maxIterations', 'maxCostCents'],
      consumption: { iterations: 0, costCents: 0, wallClockMs: 0, delegations: 0 },
      stopReason: null,
      triggeredLimit: null,
    },
    harnessReleaseId: 'release-4a',
    approvalBasis: 'policy_exempt_copy',
  } as unknown as ExecutionPlanFrozenContent;
}

test('4A fix: a fresh paid task with a pending confirmation snapshot proceeds past the pre-run verification step instead of dying on NOT_FOUND (V31-12 admit-after-decide)', async (t) => {
  const workflowId = 'workflow-pending-confirmation-fresh';
  const stepNames = mockDbosRuntime(t, workflowId);
  const reachedNameIntent = new Error(
    'REACHED_NAME_INTENT_PAST_VERIFICATION: the pre-run verification step let a fresh pending confirmation proceed into the first real Harness stage instead of dying on NOT_FOUND.',
  );
  const unreachableStage = async (): Promise<never> => {
    throw new Error('This stage must not run before nameIntent.');
  };
  const stages: HarnessStagePorts = {
    nameIntent: async () => {
      throw reachedNameIntent;
    },
    injectContext: unreachableStage,
    fenceContext: unreachableStage,
    compileBrief: unreachableStage,
    executeAndSelect: unreachableStage,
    assembleAndDeliver: unreachableStage,
  };
  // Real admission service, empty store: nothing has been admitted for this
  // workflow yet, which is exactly the state a fresh paid task is in before
  // the merchant has decided (V31-12: "确认请求持 hash 作锚... 确认后...").
  const executionPlanAdmission = new ExecutionPlanAdmissionService(
    new MemoryExecutionPlanSnapshotStore(),
  );
  const persistenceCalls: string[] = [];
  const workflow = registerHarnessDbosWorkflow(
    stages,
    {
      async registerPending(): Promise<never> {
        persistenceCalls.push('registerPending');
        throw new Error('This test does not expect a clarification interrupt.');
      },
      async readPending() {
        persistenceCalls.push('readPending');
        return null;
      },
      async recordStageTrace() {
        persistenceCalls.push('recordStageTrace');
      },
      async recordTerminalFailure() {
        persistenceCalls.push('recordTerminalFailure');
      },
    },
    { executionPlanAdmission },
  );
  const request = harnessInput({
    workspaceId: 'workspace-pending-confirmation-fresh',
    // Paid/non-exempt path (task-admission.ts's else branch, V31-12): only a
    // pending marker is attached before Make begins. Admission is deferred
    // to the confirmation gate, which runs later in this same workflow body
    // once the merchant decides — nothing is admitted yet on this, the
    // first-ever invocation.
    pendingExecutionPlanSnapshot: {
      snapshotHash: 'pending-snapshot-hash-fresh',
    },
  });

  await assert.rejects(
    workflow({ workflowId, request }),
    (error: unknown) =>
      !(error instanceof ExecutionPlanAdmissionError) &&
      error === reachedNameIntent,
  );
  // The pre-run verification checkpoint completes without throwing. The
  // confirmation-gate path reuses that result instead of repeating the same
  // durable step for this invocation.
  // Execution then reaches real intent-resolution machinery
  // ('skill-resolve-intent', the per-run intent step) and calls
  // nameIntent, which is this test's deliberate throw — the workflow's own
  // failure handling then persists the terminal failure. None of that ever
  // ran before the fix (the whole run died on the very first step).
  assert.deepEqual(stepNames, [
    'execution-plan-snapshot-verification',
    'skill-resolve-intent',
    `wf-${workflowId}-s1-intent-0`,
    'persist-terminal-failure',
  ]);
});

test('4A anti-narrowing pin: an execution_plan_snapshot branch fails closed when missing and verifies its canonical admitted authority', async (t) => {
  const workflowId = 'composer-task:workflow-snapshot-branch-still-verified';
  const stepNames = mockDbosRuntime(t, workflowId);
  const reachedPostVerificationBoundary = new Error(
    'REACHED_POST_VERIFICATION_BOUNDARY_WITH_CANONICAL_WORKFLOW_AUTHORITY',
  );
  const unreachableStage = async (): Promise<never> => {
    throw new Error(
      'The execution_plan_snapshot branch must still die on NOT_FOUND when nothing is admitted — narrowing the verify to this branch must not also skip it.',
    );
  };
  const stages: HarnessStagePorts = {
    // On the snapshot-consume path intent is materialized from the frozen
    // plan, so no stage port runs before the intent trace — the ports only
    // guard against the branch skipping verification entirely.
    nameIntent: unreachableStage,
    injectContext: unreachableStage,
    fenceContext: unreachableStage,
    compileBrief: unreachableStage,
    executeAndSelect: unreachableStage,
    assembleAndDeliver: unreachableStage,
  };
  // Real admission service, empty store: this branch's snapshot is never
  // admitted (unlike real production, where task-admission.ts admits it
  // synchronously before the workflow starts) — the verify must still run
  // and still fail closed here.
  const executionPlanAdmission = new ExecutionPlanAdmissionService(
    new MemoryExecutionPlanSnapshotStore(),
  );
  const workflow = registerHarnessDbosWorkflow(
    stages,
    {
      async registerPending() {
        throw new Error('Must not register a pending step before verification even ran.');
      },
      async readPending() {
        throw new Error('Must not read a pending step before verification even ran.');
      },
      async recordStageTrace() {
        // Post-verification canary: the first persisted effect the workflow
        // reaches once the snapshot verify has passed is the intent_naming
        // trace. (It was the retired force-legacy flag resolver until V31-26b
        // deleted that hook, 2026-08-12.) Before verification this doubles as
        // the no-trace-before-verify guard.
        throw reachedPostVerificationBoundary;
      },
      async recordTerminalFailure() {},
    },
    { executionPlanAdmission },
  );
  // The minimal 4A plan is not executor-compatible (no terminal record unit),
  // and with the force-legacy hook retired (V31-26b) the workflow now asserts
  // plan compatibility immediately after verification — freeze the canonical
  // copy plan instead so the run reaches the nameIntent canary.
  const content = {
    ...admission4AFrozenContent(),
    executionPlan: createCanonicalCarrierUnitRecipeRegistry().resolve('copy')
      .plan,
  };
  const { snapshotHash } = freezeExecutionPlanContent(content);
  const snapshot = buildExecutionPlanSnapshot({ content, snapshotHash });
  const request = harnessInput({
    workspaceId: 'workspace-snapshot-branch-still-verified',
    executionPlanSnapshot: snapshot,
  });

  await assert.rejects(
    workflow({ workflowId, request }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError && error.code === 'NOT_FOUND',
  );
  // Same single-step shape as before the 4A fix: narrowing to
  // pending_confirmation did not add, remove, or rename any step for the
  // execution_plan_snapshot branch.
  assert.deepEqual(stepNames, ['execution-plan-snapshot-verification']);
  const admittedWorkflowId = executionPlanAdmissionWorkflowId(workflowId, {
    executionPlanSnapshot: snapshot,
  });
  await executionPlanAdmission.admitSnapshot({
    workflowId: admittedWorkflowId,
    workspaceId: request.workspaceId,
    snapshot,
  });

  stepNames.length = 0;
  await assert.rejects(
    workflow({ workflowId, request }),
    (error: unknown) => error === reachedPostVerificationBoundary,
  );
  // With the admitted authority in place the branch proceeds past verification
  // into the compiled executor prelude: skill resolution, the materialized
  // intent effect, then the intent trace (the canary). Until V31-26b retired
  // the force-legacy resolver (2026-08-12) that hook fired before any of
  // these, so the pinned shape was verification + terminal failure only.
  assert.deepEqual(stepNames, [
    'execution-plan-snapshot-verification',
    'skill-resolve-intent',
    'wf-composer-task-workflow-snapshot-branch-still-verified-s1-intent-0',
    'persist-intent_naming-trace',
    'persist-terminal-failure',
  ]);
});

test('a stale admission whose successor was created closes as superseded_by_reprice: no refund, no terminal failure', async (t) => {
  const workflowId = 'composer-task:workflow-superseded-by-reprice';
  const stepNames = mockDbosRuntime(t, workflowId);
  const progressFrames: Array<{ stage?: string; state?: string; message?: string }> = [];
  t.mock.method(DBOS, 'writeStream', async (_stream: string, frame: unknown) => {
    progressFrames.push(frame as { stage?: string; state?: string; message?: string });
  });
  const sideEffects: string[] = [];
  const unreachableStage = async (): Promise<never> => {
    throw new Error('A superseded paid admission must not reach a Harness stage.');
  };
  const stages: HarnessStagePorts = {
    nameIntent: unreachableStage,
    injectContext: unreachableStage,
    fenceContext: unreachableStage,
    compileBrief: unreachableStage,
    executeAndSelect: unreachableStage,
    assembleAndDeliver: unreachableStage,
  };
  const content = {
    ...admission4AFrozenContent(),
    executionPlan: createCanonicalCarrierUnitRecipeRegistry().resolve('copy')
      .plan,
    quoteRef: { id: 'quote-superseded', revision: 1 },
    approvalBasis: 'merchant_confirmed' as const,
  };
  const pendingExecutionPlanSnapshot = freezeExecutionPlanContent(content);
  const workflow = registerHarnessDbosWorkflow(
    stages,
    {
      async registerPending(): Promise<never> {
        throw new Error('The pre-confirmed gate must not suspend on interaction.');
      },
      async readPending() {
        return null;
      },
      async recordStageTrace() {},
      async recordTerminalFailure() {
        sideEffects.push('terminal-failure');
      },
    },
    {
      billing: {
        async commit() {
          sideEffects.push('commit');
        },
        async refund() {
          sideEffects.push('refund');
        },
        async scheduleCompensation() {
          sideEffects.push('schedule-compensation');
        },
      },
      executionConfirmation: {
        async createRequest(): Promise<never> {
          throw new Error('old workflow must not reserve a successor hold');
        },
        async putCurrent(): Promise<never> {
          throw new Error('old workflow must not write a successor authority');
        },
        async getRequest() {
          return null;
        },
        async getDecisionForWorkspace(_workspaceId: string, requestId: string) {
          return planConfirmationDecisionSchema.parse({
            schemaVersion: 'plan-confirmation-decision/v1',
            decisionId: `living-plan-commit:${requestId}`,
            requestId,
            actorId: 'owner-1',
            decision: 'confirmed',
            decidedAt: '2026-08-12T00:00:00.000Z',
          });
        },
      } as never,
      executionPlanAdmission: new ExecutionPlanAdmissionService(
        new MemoryExecutionPlanSnapshotStore(),
      ),
      // Post-confirm quote drift: frozen revision 1, live revision 2.
      resolveExecutionPlanLiveFacts: async () => ({ quoteRevision: 2 }),
      createRepricedPaidExecutionSuccessor: async () => ({
        kind: 'created' as const,
        submission: {
          task: { id: 'task-superseded-successor' },
          confirmationDispatch: { requestId: 'confirmation-superseded-successor' },
        },
      }),
    },
  );
  const request = harnessInput({
    workspaceId: 'workspace-superseded-by-reprice',
    executionConfirmationRequestId: 'confirmation-superseded-predecessor',
    executionSnapshot: {
      id: 'snapshot-superseded',
      createdAt: '2026-08-12T00:00:00.000Z',
      lens: 'copy',
      task: { id: 'task-superseded-predecessor' },
      quote: { id: 'quote-superseded', revision: '1' },
    },
    pendingExecutionPlanSnapshot,
    usageReservation: {
      id: 'usage-superseded',
      credits: 5,
      units: [{ resource: 'image', quantity: 1 }],
    },
  });

  const result = (await workflow({ workflowId, request })) as {
    delivery: null;
    merchantMessage: string;
    outcome: string;
    predecessorConfirmationRequestId: string;
    successorTaskId: string;
    successorConfirmationRequestId: string;
  };

  assert.equal(result.outcome, 'superseded_by_reprice');
  assert.equal(result.delivery, null);
  assert.match(result.merchantMessage, /新的确认卡/u);
  assert.equal(
    result.predecessorConfirmationRequestId,
    'confirmation-superseded-predecessor',
  );
  assert.equal(result.successorTaskId, 'task-superseded-successor');
  assert.equal(
    result.successorConfirmationRequestId,
    'confirmation-superseded-successor',
  );
  // Handover is not a failure: the predecessor hold was refunded inside the
  // successor's admission transaction, so this run must neither refund again
  // nor persist a terminal failure 申报.
  assert.deepEqual(sideEffects, []);
  assert.equal(
    stepNames.some((name) => /terminal|refund|compensation/u.test(name)),
    false,
  );
  const handover = progressFrames.find(
    (frame) =>
      frame.stage === 'execution_selection' &&
      typeof frame.message === 'string' &&
      /新的确认卡/u.test(frame.message),
  );
  assert.ok(handover, 'merchant progress must point at the fresh confirmation');
  assert.equal(handover!.state, 'suspended');
});

test('ask_merchant caller derives one replay-stable key from the canonical question', async () => {
  const question = questionCardSchema.parse({
    questionId: 'workflow-ask:offer-price',
    workflowId: 'workflow-ask',
    workflowRevision: 3,
    question: '当前团购价是多少？',
    options: [],
    freeText: { enabled: true },
    response: {
      field: 'offer_price',
      reason: '需要商户确认当前价格',
    },
    unattended: 'hold',
    scope: 'current_task',
  });
  const calls: Array<Parameters<HarnessAskMerchantPrimitivePort['invoke']>[0]> =
    [];
  const primitive: HarnessAskMerchantPrimitivePort = {
    async invoke(input) {
      calls.push(structuredClone(input));
    },
  };
  const request = harnessInput({
    workspaceId: 'workspace-ask',
    workflowRevision: question.workflowRevision,
  });

  await invokeHarnessAskMerchantPrimitive(primitive, {
    question,
    request,
    stage: 'intent_naming',
    workspaceId: 'workspace-ask',
  });
  await invokeHarnessAskMerchantPrimitive(primitive, {
    question,
    request,
    stage: 'intent_naming',
    workspaceId: 'workspace-ask',
  });

  assert.deepEqual(calls, [
    {
      idempotencyKey: 'harness-ask-merchant:workflow-ask:offer-price',
      question,
      request,
      stage: 'intent_naming',
      workspaceId: 'workspace-ask',
    },
    {
      idempotencyKey: 'harness-ask-merchant:workflow-ask:offer-price',
      question,
      request,
      stage: 'intent_naming',
      workspaceId: 'workspace-ask',
    },
  ]);
});

test('confirmation timeout becomes a legal ignored decision', () => {
  assert.deepEqual(
    confirmationCardDecision(
      {
        questionId: 'question-timeout',
        workflowId: 'task-timeout',
        workflowRevision: 3,
        question: 'What service should this content feature?',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'industry_category',
          reason: 'Ground the content in the merchant service category',
        },
        scope: 'current_task',
      },
      null,
    ),
    {
      idempotencyKey: 'question-timeout:r3:core_timeout',
      questionId: 'question-timeout',
      workflowRevision: 3,
      patch: {
        field: 'industry_category',
        value: '超时未作答，已按通用口径继续',
        reason: 'Ground the content in the merchant service category',
      },
      decision: {
        state: 'ignored',
        value: '超时未作答，已按通用口径继续',
      },
    },
  );
});

test('commit failure schedules durable compensation without rejecting delivery', async () => {
  const events: string[] = [];
  const billing: HarnessBillingSettlementPort = {
    async commit() {
      events.push('commit');
      throw new Error('billing unavailable');
    },
    async refund() {},
    async scheduleCompensation(input) {
      events.push(`scheduled:${input.action}:${input.quoteRevision}`);
    },
  };

  await commitHarnessBillingOrSchedule({
    billing,
    input: settlement,
    runStep: async (name, operation) => {
      events.push(`step:${name}`);
      return operation();
    },
  });

  assert.deepEqual(events, [
    'step:commit-product-usage',
    'scheduled:commit:quote-revision-1',
    'commit',
  ]);
});

test('multi-carrier commit never writes a receipt without a durable compensation owner', async () => {
  let commits = 0;
  let schedules = 0;

  await assert.rejects(
    commitHarnessBillingOrSchedule({
      billing: {
        async commit() {
          commits += 1;
        },
        async refund() {},
        async scheduleCompensation() {
          schedules += 1;
          throw new Error('compensation store unavailable');
        },
      },
      input: multiCarrierSettlement,
      runStep: async (_name, operation) => operation(),
    }),
    /compensation store unavailable/u,
  );

  assert.equal(commits, 0);
  assert.equal(schedules, 2);
});

test('multi-carrier refund never writes a receipt without a durable compensation owner', async () => {
  let refunds = 0;
  let schedules = 0;

  const outcome = await refundHarnessBillingPreservingFailure({
    billing: {
      async commit() {},
      async refund() {
        refunds += 1;
      },
      async scheduleCompensation() {
        schedules += 1;
        throw new Error('compensation store unavailable');
      },
    },
    input: multiCarrierSettlement,
    runStep: async (_name, operation) => operation(),
  });

  assert.equal(outcome, 'unavailable');
  assert.equal(refunds, 0);
  assert.equal(schedules, 2);
});

test('an opposite refund owner prevents a direct commit effect', async () => {
  let commits = 0;
  await assert.rejects(
    commitHarnessBillingOrSchedule({
      billing: {
        async commit() {
          commits += 1;
        },
        async refund() {},
        async scheduleCompensation() {
          throw new HarnessBillingCompensationConflictError(settlement.taskId);
        },
      },
      input: settlement,
      runStep: async (_name, operation) => operation(),
    }),
    HarnessBillingCompensationConflictError,
  );
  assert.equal(commits, 0);
});

test('an opposite commit owner prevents a direct refund effect', async () => {
  let refunds = 0;
  await assert.rejects(
    refundHarnessBillingPreservingFailure({
      billing: {
        async commit() {},
        async refund() {
          refunds += 1;
        },
        async scheduleCompensation() {
          throw Object.assign(
            new Error('Persisted opposite settlement action.'),
            {
              code: 'HARNESS_BILLING_COMPENSATION_CONFLICT',
              name: 'HarnessBillingCompensationConflictError',
              taskId: settlement.taskId,
            },
          );
        },
      },
      input: settlement,
      runStep: async (_name, operation) => operation(),
    }),
    isHarnessBillingCompensationConflictError,
  );
  assert.equal(refunds, 0);
});

test('terminal success enqueues recall after a failed commit is durably scheduled', async () => {
  const events: string[] = [];
  const request = {
    workspaceId: settlement.workspaceId,
    billingIdentity: settlement.billingIdentity,
  };

  await settleHarnessTerminalSuccess({
    billing: {
      async commit() {
        events.push('commit');
        throw new Error('billing unavailable');
      },
      async refund() {},
      async scheduleCompensation() {
        events.push('schedule');
      },
    },
    completedAt: '2026-07-29T02:00:00.000Z',
    request,
    runStep: async (name, operation) => {
      events.push(`step:${name}`);
      return operation();
    },
    settlement,
    taskRecallDue: {
      async produce(input) {
        events.push(`recall:${input.sourceTaskId}`);
      },
    },
    workflowId: settlement.taskId,
  });

  assert.deepEqual(events, [
    'step:commit-product-usage',
    'schedule',
    'commit',
    'step:enqueue-task-recall',
    `recall:${settlement.taskId}`,
  ]);
});

test('terminal success does not enqueue recall when billing compensation cannot be scheduled', async () => {
  let recallDue = 0;

  await assert.rejects(
    settleHarnessTerminalSuccess({
      billing: {
        async commit() {
          throw new Error('billing unavailable');
        },
        async refund() {},
        async scheduleCompensation() {
          throw new Error('compensation store unavailable');
        },
      },
      completedAt: '2026-07-29T02:00:00.000Z',
      request: {
        workspaceId: settlement.workspaceId,
      } as HarnessWorkflowInput,
      runStep: async (_name, operation) => operation(),
      settlement,
      taskRecallDue: {
        async produce() {
          recallDue += 1;
        },
      },
      workflowId: settlement.taskId,
    }),
    /compensation store unavailable/u,
  );

  assert.equal(recallDue, 0);
});

test('refund failure still records terminal state and preserves the execution error', async () => {
  const executionError = new Error('generation failed');
  const events: string[] = [];
  const billing: HarnessBillingSettlementPort = {
    async commit() {},
    async refund() {
      events.push('refund');
      throw new Error('billing unavailable');
    },
    async scheduleCompensation(input) {
      events.push(`scheduled:${input.action}`);
    },
  };

  await assert.rejects(
    failHarnessWorkflowPreservingExecutionError({
      billing,
      input: settlement,
      error: executionError,
      runStep: async (name, operation) => {
        events.push(`step:${name}`);
        return operation();
      },
      async recordTerminalFailure(quotaRefunded) {
        events.push(`terminal:refunded=${quotaRefunded}`);
      },
    }),
    (error) => error === executionError,
  );
  assert.deepEqual(events, [
    'step:refund-product-usage',
    'scheduled:refund',
    'refund',
    'step:persist-terminal-failure',
    // The 申报卡 quotes this. A scheduled compensation has given nothing back
    // yet, so claiming 「已退回」 here would be the card's one possible lie.
    'terminal:refunded=false',
  ]);
});

test('a refund that lands is the only thing that lets the card say 积分已退回', async () => {
  const executionError = new Error('generation failed');
  const recorded: boolean[] = [];
  await assert.rejects(
    failHarnessWorkflowPreservingExecutionError({
      billing: {
        async commit() {},
        async refund() {},
        async scheduleCompensation() {
          throw new Error('compensation must not be needed');
        },
      },
      input: settlement,
      error: executionError,
      runStep: async (_name, operation) => operation(),
      async recordTerminalFailure(quotaRefunded) {
        recorded.push(quotaRefunded);
      },
    }),
    (error) => error === executionError,
  );
  assert.deepEqual(recorded, [true]);
});

test('a refund that reaches neither the ledger nor the compensation store claims nothing', async () => {
  const executionError = new Error('generation failed');
  const recorded: boolean[] = [];
  await assert.rejects(
    failHarnessWorkflowPreservingExecutionError({
      billing: {
        async commit() {},
        async refund() {
          throw new Error('billing unavailable');
        },
        async scheduleCompensation() {
          throw new Error('compensation store unavailable');
        },
      },
      input: settlement,
      error: executionError,
      runStep: async (_name, operation) => operation(),
      async recordTerminalFailure(quotaRefunded) {
        recorded.push(quotaRefunded);
      },
    }),
    (error) => error === executionError,
  );
  assert.deepEqual(recorded, [false]);
});

test('hold expiry refunds the reservation and returns a successful non-delivery result', async () => {
  const events: string[] = [];
  const request = harnessInput({
    workspaceId: settlement.workspaceId,
    billingIdentity: settlement.billingIdentity,
    executionSnapshot: {
      work: { id: 'work-hold' },
      quote: { id: settlement.quoteId, revision: settlement.quoteRevision },
    },
    usageReservation: { id: 'usage-reservation-hold', credits: 9, units: [] },
  });
  const result = await settleHarnessCancellation({
    billing: {
      async commit() {
        events.push('unexpected-commit');
      },
      async refund() {
        events.push('refund');
      },
      async scheduleCompensation() {
        events.push('scheduled');
      },
      async completeCompensation() {
        events.push('completed');
      },
    },
    cancellation: new HarnessWorkflowCancellation(
      '超时未选择，本次任务已取消，积分已退回',
    ),
    request,
    runStep: async (name, operation) => {
      events.push(`step:${name}`);
      return operation();
    },
    workflowId: settlement.taskId,
  });

  assert.deepEqual(events, [
    'step:refund-product-usage',
    'scheduled',
    'refund',
    'completed',
  ]);
  assert.deepEqual(result, {
    delivery: null,
    merchantMessage: '超时未选择，本次任务已取消，积分已退回',
    outcome: 'cancelled',
    resolutionSource: 'core_hold_expired',
  });
});

test('hold expiry reports a pending refund when durable compensation owns it', async () => {
  const request = harnessInput({
    workspaceId: settlement.workspaceId,
    billingIdentity: settlement.billingIdentity,
    executionSnapshot: {
      work: { id: 'work-hold' },
      quote: { id: settlement.quoteId, revision: settlement.quoteRevision },
    },
    usageReservation: { id: 'usage-reservation-hold', credits: 9, units: [] },
  });
  const result = await settleHarnessCancellation({
    billing: {
      async commit() {},
      async refund() {
        throw new Error('billing unavailable');
      },
      async scheduleCompensation() {},
    },
    cancellation: new HarnessWorkflowCancellation(
      '超时未选择，本次任务已取消，积分已退回',
    ),
    request,
    runStep: async (_name, operation) => operation(),
    workflowId: settlement.taskId,
  });

  assert.equal(result.merchantMessage, '超时未选择，本次任务已取消，积分退款处理中');
});

test('hold expiry prefers ledger truth when sweeper already refunded credits', async () => {
  const billingTaskId = 'task-source-hold-refunded';
  const request = harnessInput({
    workspaceId: settlement.workspaceId,
    sourceTaskId: billingTaskId,
    billingIdentity: {
      ...settlement.billingIdentity,
      taskId: billingTaskId,
      workflowId: `${billingTaskId}:plan-r1`,
    },
    executionSnapshot: {
      work: { id: 'work-hold' },
      quote: { id: settlement.quoteId, revision: settlement.quoteRevision },
    },
    usageReservation: {
      id: 'usage-reservation-hold-refunded',
      credits: 9,
      units: [],
    },
  });
  const result = await settleHarnessCancellation({
    billing: {
      async commit() {},
      async refund() {
        throw new Error('billing unavailable after sweeper');
      },
      async scheduleCompensation() {},
      async getUsage(taskId) {
        assert.equal(taskId, billingTaskId);
        return {
          id: 'usage-hold-refunded',
          taskId: billingTaskId,
          workspaceId: settlement.workspaceId,
          quoteId: settlement.quoteId,
          status: 'refunded',
          reservedQuantity: 0,
          reservedUnits: [],
          settledQuantity: 0,
          settledUnits: [],
          refundedQuantity: 0,
          refundedUnits: [],
          reservedCredits: 9,
          settledCredits: 0,
          refundedCredits: 9,
          billingMode: 'per_request',
          settlementStatus: 'reconciled',
          createdAt: '2026-08-11T08:00:00.000Z',
          updatedAt: '2026-08-11T09:00:00.000Z',
        };
      },
    },
    cancellation: new HarnessWorkflowCancellation(
      '超时未选择，本次任务已取消，积分已退回',
    ),
    request,
    runStep: async (_name, operation) => operation(),
    workflowId: `${billingTaskId}:plan-r1`,
  });

  assert.equal(
    result.merchantMessage,
    '超时未选择，本次任务已取消，积分已退回',
  );
});

test('an explicit hard-cap stop keeps its decision reason while refund is pending', async () => {
  const request = harnessInput({
    workspaceId: settlement.workspaceId,
    billingIdentity: settlement.billingIdentity,
    executionSnapshot: {
      work: { id: 'work-hold' },
      quote: { id: settlement.quoteId, revision: settlement.quoteRevision },
    },
    usageReservation: { id: 'usage-reservation-hard-cap', credits: 9, units: [] },
  });
  const result = await settleHarnessCancellation({
    billing: {
      async commit() {},
      async refund() {
        throw new Error('billing unavailable');
      },
      async scheduleCompensation() {},
    },
    cancellation: new HarnessWorkflowCancellation(
      '已达本次任务可提高的最高上限，本次任务已结束',
      'decision',
    ),
    request,
    runStep: async (_name, operation) => operation(),
    workflowId: settlement.taskId,
  });

  assert.equal(result.resolutionSource, 'decision');
  assert.equal(result.merchantMessage, '本次任务已结束，积分退款处理中');
});

test('hold expiry never claims a refund after both settlement writes fail', async () => {
  const request = harnessInput({
    workspaceId: settlement.workspaceId,
    billingIdentity: settlement.billingIdentity,
    executionSnapshot: {
      work: { id: 'work-hold' },
      quote: { id: settlement.quoteId, revision: settlement.quoteRevision },
    },
    usageReservation: { id: 'usage-reservation-hold', credits: 9, units: [] },
  });
  const result = await settleHarnessCancellation({
    billing: {
      async commit() {},
      async refund() {
        throw new Error('billing unavailable');
      },
      async scheduleCompensation() {
        throw new Error('compensation unavailable');
      },
    },
    cancellation: new HarnessWorkflowCancellation(
      '超时未选择，本次任务已取消，积分已退回',
    ),
    request,
    runStep: async (_name, operation) => operation(),
    workflowId: settlement.taskId,
  });

  assert.equal(result.merchantMessage, '超时未选择，本次任务已取消，积分退款处理中');
});

test('hold expiry without a reservation has nothing to refund', async () => {
  const result = await settleHarnessCancellation({
    cancellation: new HarnessWorkflowCancellation(
      '超时未选择，本次任务已取消，积分已退回',
    ),
    request: harnessInput({ workspaceId: 'workspace-no-reservation' }),
    runStep: async (_name, operation) => operation(),
    workflowId: 'task-no-reservation',
  });

  assert.equal(result.outcome, 'cancelled');
  assert.equal(result.delivery, null);
});

test('hold expiry refuses success when a reservation cannot be refunded', async () => {
  await assert.rejects(
    settleHarnessCancellation({
      cancellation: new HarnessWorkflowCancellation(
        '超时未选择，本次任务已取消，积分已退回',
      ),
      request: harnessInput({
        usageReservation: { id: 'usage-reservation-missing-billing', units: [] },
        workspaceId: 'workspace-missing-billing',
      }),
      runStep: async (_name, operation) => operation(),
      workflowId: 'task-missing-billing',
    }),
    /requires its reserved billing input/u,
  );
});

test('execution receipt forwards trusted per-bucket product units to settlement', () => {
  const request = harnessInput({
    workspaceId: 'workspace-note-units',
    billingIdentity: {
      workspaceId: 'workspace-note-units',
      taskId: 'task-note-units',
      workId: 'work-note-units',
      workflowId: 'task-note-units',
      quoteRef: { id: 'quote-note-units', revision: 'quote-r1' },
      reservationId: 'usage-reservation-note-units',
      carrierUnitId: 'single',
      carrierUnitIds: ['single'],
      carrierBillableUnits: 1,
    },
    executionSnapshot: {
      work: { id: 'work-note-units' },
      quote: { id: 'quote-note-units', revision: 'quote-r1' },
    },
    usageReservation: {
      id: 'usage-reservation-note-units',
      credits: 1,
      units: [],
    },
  });

  assert.deepEqual(
    harnessBillingSettlementInput(request, 'task-note-units', {
      billingReceipt: {
        trustedUsage: {
          kind: 'product_units',
          units: [
            { resource: 'copy', quantity: 2 },
            { resource: 'image', quantity: 5 },
          ],
          evidenceRef: 'note-receipts:task-note-units',
        },
      },
    }),
    {
      workspaceId: 'workspace-note-units',
      taskId: 'task-note-units',
      billingTaskId: 'task-note-units',
      billingIdentity: {
        workspaceId: 'workspace-note-units',
        taskId: 'task-note-units',
        workId: 'work-note-units',
        workflowId: 'task-note-units',
        quoteRef: { id: 'quote-note-units', revision: 'quote-r1' },
        reservationId: 'usage-reservation-note-units',
        carrierUnitId: 'single',
        carrierUnitIds: ['single'],
        carrierBillableUnits: 1,
      },
      settlementIdempotencyKey: settlementIdempotencyKey(request.billingIdentity!),
      quoteId: 'quote-note-units',
      quoteRevision: 'quote-r1',
      trustedUsage: {
        kind: 'product_units',
        units: [
          { resource: 'copy', quantity: 2 },
          { resource: 'image', quantity: 5 },
        ],
        evidenceRef: 'note-receipts:task-note-units',
      },
    },
  );
});

test('successor settlement uses the effective plan quote and confirmation operation', () => {
  const request = harnessInput({
    workspaceId: 'workspace-successor-settlement',
    billingIdentity: {
      workspaceId: 'workspace-successor-settlement',
      taskId: 'task-successor-settlement',
      workId: 'work-successor-settlement',
      workflowId: 'task-successor-settlement',
      planId: 'plan-successor-settlement',
      planRevision: 2,
      snapshotHash: 'hash-successor-r2',
      quoteRef: { id: 'quote-successor', revision: 'quote-r2' },
      creditHoldOperationId: 'consume:confirmation:successor-r2',
      creditUsageOperationId: 'consume:task:task-successor-settlement',
      productUsageReservationId: 'usage-reservation-successor-settlement',
      reservationId:
        'typed|consume:confirmation:successor-r2|consume:task:task-successor-settlement|usage-reservation-successor-settlement',
      carrierUnitId: 'single',
      carrierUnitIds: ['single'],
      carrierBillableUnits: 1,
    },
    executionSnapshot: {
      work: { id: 'work-successor-settlement' },
      quote: { id: 'quote-successor', revision: 'quote-r1' },
    },
    executionPlanSnapshot: {
      planId: 'plan-successor-settlement',
      planRevision: 1,
      snapshotHash: 'hash-successor-r1',
      quoteRef: { id: 'quote-successor', revision: 'quote-r1' },
    },
    pendingExecutionPlanSnapshot: {
      snapshotHash: 'hash-successor-r2',
      content: {
        planId: 'plan-successor-settlement',
        planRevision: 2,
        quoteRef: { id: 'quote-successor', revision: 'quote-r2' },
      },
    },
    executionConfirmationReservationIdempotencyKey:
      'consume:confirmation:successor-r2',
    usageReservation: {
      id: 'usage-reservation-successor-settlement',
      creditUsageOperationId: 'consume:task:task-successor-settlement',
      units: [],
    },
  });

  assert.deepEqual(
    harnessBillingSettlementInput(request, 'task-successor-settlement'),
    {
      workspaceId: 'workspace-successor-settlement',
      taskId: 'task-successor-settlement',
      billingTaskId: 'task-successor-settlement',
      billingIdentity: {
        workspaceId: 'workspace-successor-settlement',
        taskId: 'task-successor-settlement',
        workId: 'work-successor-settlement',
        workflowId: 'task-successor-settlement',
        planId: 'plan-successor-settlement',
        planRevision: 2,
        snapshotHash: 'hash-successor-r2',
        quoteRef: { id: 'quote-successor', revision: 'quote-r2' },
        creditHoldOperationId: 'consume:confirmation:successor-r2',
        creditUsageOperationId: 'consume:task:task-successor-settlement',
        productUsageReservationId: 'usage-reservation-successor-settlement',
        reservationId:
          'typed|consume:confirmation:successor-r2|consume:task:task-successor-settlement|usage-reservation-successor-settlement',
        carrierUnitId: 'single',
        carrierUnitIds: ['single'],
        carrierBillableUnits: 1,
      },
      settlementIdempotencyKey: settlementIdempotencyKey(request.billingIdentity!),
      quoteId: 'quote-successor',
      quoteRevision: 'quote-r2',
      creditUsageOperationId: 'consume:task:task-successor-settlement',
    },
  );
});

test('V31-59 ordinary settlement always sets billingTaskId even without sourceTaskId', () => {
  const request = harnessInput({
    workspaceId: 'workspace-ordinary-billing-id',
    billingIdentity: {
      workspaceId: 'workspace-ordinary-billing-id',
      taskId: 'task-ordinary-workflow',
      workId: 'work-ordinary',
      workflowId: 'task-ordinary-workflow',
      quoteRef: { id: 'quote-ordinary', revision: 'quote-r1' },
      reservationId: 'usage-reservation-ordinary',
      carrierUnitId: 'single',
      carrierUnitIds: ['single'],
      carrierBillableUnits: 1,
    },
    executionSnapshot: {
      work: { id: 'work-ordinary' },
      quote: { id: 'quote-ordinary', revision: 'quote-r1' },
    },
    usageReservation: {
      id: 'usage-reservation-ordinary',
      credits: 1,
      units: [],
    },
  });

  const settlement = harnessBillingSettlementInput(
    request,
    'task-ordinary-workflow',
  );
  assert.ok(settlement);
  assert.equal(settlement.taskId, 'task-ordinary-workflow');
  assert.equal(settlement.billingTaskId, 'task-ordinary-workflow');
});

test('R-P0-05 settlement rejects an identity that disagrees with its durable request', () => {
  const request = harnessInput({
    workspaceId: 'workspace-durable-identity',
    billingTaskId: 'task-durable-identity',
    carrierUnitId: 'single',
    carrierUnitIds: ['single'],
    carrierBillableUnits: 1,
    executionConfirmationReservationIdempotencyKey:
      'consume:confirmation:durable-identity',
    billingIdentity: {
      workspaceId: 'workspace-durable-identity',
      taskId: 'task-durable-identity',
      workId: 'work-durable-identity',
      workflowId: 'task-durable-identity',
      quoteRef: { id: 'quote-durable-identity', revision: 'quote-r1' },
      reservationId: 'consume:confirmation:durable-identity',
      carrierUnitId: 'single',
      carrierUnitIds: ['single'],
      carrierBillableUnits: 1,
    },
    executionSnapshot: {
      work: { id: 'work-durable-identity' },
      quote: { id: 'quote-durable-identity', revision: 'quote-r1' },
    },
    usageReservation: {
      id: 'usage-durable-identity',
      credits: 1,
      units: [],
    },
  });

  for (const mutation of [
    { workspaceId: 'workspace-other' },
    { billingTaskId: 'task-other' },
    { carrierUnitId: 'other' },
    { carrierUnitIds: ['other'] },
    { carrierBillableUnits: 2 },
    { executionConfirmationReservationIdempotencyKey: 'consume:confirmation:other' },
    {
      executionPlanSnapshot: {
        planId: 'plan-durable-identity',
        planRevision: 1,
        snapshotHash: 'snapshot-durable-identity',
        quoteRef: { id: 'quote-durable-identity', revision: 'quote-r1' },
      },
    },
  ]) {
    assert.throws(
      () =>
        harnessBillingSettlementInput(
          { ...request, ...mutation },
          'task-durable-identity',
        ),
      (error: unknown) =>
        error instanceof BillingIdentityError &&
        error.code === 'BILLING_IDENTITY_MISMATCH',
    );
  }
});

test('prepared settlement keeps workflow and billing task identities separate', () => {
  const request = harnessInput({
    workspaceId: 'workspace-prepared-settlement',
    sourceTaskId: 'task-prepared-settlement',
    billingIdentity: {
      workspaceId: 'workspace-prepared-settlement',
      taskId: 'task-prepared-settlement',
      workId: 'work-prepared-settlement',
      workflowId: 'task-prepared-settlement:plan-r2',
      quoteRef: { id: 'quote-prepared-settlement', revision: 'quote-r1' },
      reservationId: 'usage-reservation-prepared-settlement',
      carrierUnitId: 'single',
      carrierUnitIds: ['single'],
      carrierBillableUnits: 1,
    },
    executionSnapshot: {
      work: { id: 'work-prepared-settlement' },
      quote: { id: 'quote-prepared-settlement', revision: 'quote-r1' },
    },
    usageReservation: {
      id: 'usage-reservation-prepared-settlement',
      credits: 1,
      units: [],
    },
  });

  assert.deepEqual(
    harnessBillingSettlementInput(
      request,
      'task-prepared-settlement:plan-r2',
    ),
    {
      workspaceId: 'workspace-prepared-settlement',
      taskId: 'task-prepared-settlement:plan-r2',
      billingTaskId: 'task-prepared-settlement',
      billingIdentity: {
        workspaceId: 'workspace-prepared-settlement',
        taskId: 'task-prepared-settlement',
        workId: 'work-prepared-settlement',
        workflowId: 'task-prepared-settlement:plan-r2',
        quoteRef: { id: 'quote-prepared-settlement', revision: 'quote-r1' },
        reservationId: 'usage-reservation-prepared-settlement',
        carrierUnitId: 'single',
        carrierUnitIds: ['single'],
        carrierBillableUnits: 1,
      },
      settlementIdempotencyKey: settlementIdempotencyKey(request.billingIdentity!),
      quoteId: 'quote-prepared-settlement',
      quoteRevision: 'quote-r1',
    },
  );
});

test('cancellation refunds the effective successor quote, not the superseded hold', async () => {
  const refunds: Array<Record<string, unknown>> = [];
  // Post-reprice shape: the admitted snapshot still carries r1 while the
  // pending successor plan holds r2 and owns the live credit reservation.
  const request = harnessInput({
    workspaceId: 'workspace-successor-cancel',
    billingIdentity: {
      workspaceId: 'workspace-successor-cancel',
      taskId: 'task-successor-cancel',
      workId: 'work-successor-cancel',
      workflowId: 'task-successor-cancel',
      planId: 'plan-successor-cancel',
      planRevision: 2,
      snapshotHash: 'hash-successor-cancel-r2',
      quoteRef: { id: 'quote-successor-cancel', revision: 'quote-r2' },
      creditHoldOperationId: 'consume:confirmation:successor-cancel-r2',
      creditUsageOperationId: 'consume:task:task-successor-cancel',
      productUsageReservationId: 'usage-reservation-successor-cancel',
      reservationId:
        'typed|consume:confirmation:successor-cancel-r2|consume:task:task-successor-cancel|usage-reservation-successor-cancel',
      carrierUnitId: 'single',
      carrierUnitIds: ['single'],
      carrierBillableUnits: 1,
    },
    executionSnapshot: {
      work: { id: 'work-successor-cancel' },
      quote: { id: 'quote-successor-cancel', revision: 'quote-r1' },
    },
    executionPlanSnapshot: {
      planId: 'plan-successor-cancel',
      planRevision: 1,
      snapshotHash: 'hash-successor-cancel-r1',
      quoteRef: { id: 'quote-successor-cancel', revision: 'quote-r1' },
    },
    pendingExecutionPlanSnapshot: {
      snapshotHash: 'hash-successor-cancel-r2',
      content: {
        planId: 'plan-successor-cancel',
        planRevision: 2,
        quoteRef: { id: 'quote-successor-cancel', revision: 'quote-r2' },
      },
    },
    executionConfirmationReservationIdempotencyKey:
      'consume:confirmation:successor-cancel-r2',
    usageReservation: {
      id: 'usage-reservation-successor-cancel',
      creditUsageOperationId: 'consume:task:task-successor-cancel',
      units: [],
    },
  });

  await settleHarnessCancellation({
    billing: {
      async commit() {},
      async refund(input) {
        refunds.push(input as unknown as Record<string, unknown>);
      },
      async scheduleCompensation() {},
      async completeCompensation() {},
    },
    cancellation: new HarnessWorkflowCancellation(
      '超时未选择，本次任务已取消，积分已退回',
    ),
    request,
    runStep: async (_name, operation) => operation(),
    workflowId: 'task-successor-cancel',
  });

  assert.deepEqual(refunds, [
    {
      workspaceId: 'workspace-successor-cancel',
      taskId: 'task-successor-cancel',
      billingTaskId: 'task-successor-cancel',
      billingIdentity: {
        workspaceId: 'workspace-successor-cancel',
        taskId: 'task-successor-cancel',
        workId: 'work-successor-cancel',
        workflowId: 'task-successor-cancel',
        planId: 'plan-successor-cancel',
        planRevision: 2,
        snapshotHash: 'hash-successor-cancel-r2',
        quoteRef: { id: 'quote-successor-cancel', revision: 'quote-r2' },
        creditHoldOperationId: 'consume:confirmation:successor-cancel-r2',
        creditUsageOperationId: 'consume:task:task-successor-cancel',
        productUsageReservationId: 'usage-reservation-successor-cancel',
        reservationId:
          'typed|consume:confirmation:successor-cancel-r2|consume:task:task-successor-cancel|usage-reservation-successor-cancel',
        carrierUnitId: 'single',
        carrierUnitIds: ['single'],
        carrierBillableUnits: 1,
      },
      settlementIdempotencyKey: settlementIdempotencyKey(request.billingIdentity!),
      quoteId: 'quote-successor-cancel',
      quoteRevision: 'quote-r2',
        creditUsageOperationId: 'consume:task:task-successor-cancel',
      forceCreditRefund: true,
    },
  ]);
});

test('execution receipt forwards the executor partial delivery basis to settlement', () => {
  const request = harnessInput({
    workspaceId: 'workspace-note-partial',
    billingIdentity: {
      workspaceId: 'workspace-note-partial',
      taskId: 'task-note-partial',
      workId: 'work-note-partial',
      workflowId: 'task-note-partial',
      quoteRef: { id: 'quote-note-partial', revision: 'quote-r1' },
      reservationId: 'usage-reservation-note-partial',
      carrierUnitId: 'single',
      carrierUnitIds: ['single'],
      carrierBillableUnits: 1,
    },
    executionSnapshot: {
      work: { id: 'work-note-partial' },
      quote: { id: 'quote-note-partial', revision: 'quote-r1' },
    },
    usageReservation: {
      id: 'usage-reservation-note-partial',
      credits: 1,
      units: [],
    },
  });

  const settlement = harnessBillingSettlementInput(request, 'task-note-partial', {
    billingReceipt: {
      trustedUsage: {
        kind: 'product_units',
        units: [{ resource: 'image', quantity: 5 }],
      },
      partialDelivery: { totalUnits: 6, deliveredUnits: 5 },
    },
  });
  assert.deepEqual(settlement?.partialDelivery, {
    totalUnits: 6,
    deliveredUnits: 5,
  });

  // Negative inbound: a malformed or over-claiming basis is dropped, so a bad
  // receipt cannot invent a refund. Absent evidence stays a full charge.
  for (const partialDelivery of [
    { totalUnits: 6, deliveredUnits: 7 },
    { totalUnits: 0, deliveredUnits: 0 },
    { totalUnits: '6', deliveredUnits: '5' },
    null,
  ]) {
    assert.equal(
      harnessBillingSettlementInput(request, 'task-note-partial', {
        billingReceipt: { partialDelivery },
      })?.partialDelivery,
      undefined,
    );
  }
});

// ─── V31-14 P1-a: typed Interrupt protocol mirror + resume bridge ───────────

function interruptQuestion(overrides: Record<string, unknown> = {}) {
  const merged: Record<string, unknown> = {
    questionId: 'question-1',
    workflowId: 'workflow-1',
    workflowRevision: 3,
    question: '请确认执行付费生成',
    options: [
      { id: 'approved', label: '确认执行' },
      { id: 'rejected', label: '暂不执行' },
    ],
    freeText: { enabled: false },
    response: { field: 'execution_confirmation', reason: '付费执行前确认' },
    unattended: 'hold',
    executionConfirmationAuthority: {
      kind: 'external_action',
      revision: 'execution-external-action/v1',
    },
    scope: 'current_task',
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return questionCardSchema.parse(merged);
}

function interruptRequest() {
  return { workspaceId: 'workspace-1' } as import('./task-admission.js').HarnessWorkflowInput;
}

function interruptResume(overrides: Record<string, unknown> = {}): ResumeInterruptCommand {
  return resumeInterruptCommandSchema.parse({
    schemaVersion: 'interrupt-payload/v1',
    interruptId: 'question-1',
    revision: 3,
    type: 'accept',
    ...overrides,
  });
}

test('mirror input maps a pending question into the typed interrupt payload', () => {
  const { workspaceId, payload } = harnessInterruptMirrorInput({
    question: interruptQuestion(),
    stage: 'execution_selection',
    request: interruptRequest(),
  });
  assert.equal(workspaceId, 'workspace-1');
  assert.equal(payload.interruptId, 'question-1');
  assert.equal(payload.threadId, 'harness-thread:workflow-1');
  assert.equal(payload.runId, 'workflow-1');
  assert.equal(payload.workflowId, 'workflow-1');
  assert.equal(payload.step, 'execution_selection');
  assert.equal(payload.revision, 3);
  assert.equal(payload.action, 'confirm_paid_execution');
  assert.deepEqual(payload.config, {
    allowAccept: true,
    allowEdit: false,
    allowReject: true,
    allowRespond: false,
  });
  assert.equal(payload.resourceId, 'workspace-1');
  assert.equal(payload.expiresAt, undefined, 'no business hold deadline without holdTimeoutSeconds');
  assert.equal(interruptQuestionFromPayload(payload).questionId, 'question-1');
});

test('mirror input carries the QuestionCard roundtrip and hold deadline', () => {
  const { payload } = harnessInterruptMirrorInput({
    question: interruptQuestion({ executionConfirmationAuthority: undefined }),
    stage: 'intent_naming',
    request: interruptRequest(),
  });
  assert.equal(payload.action, 'answer_question');
  assert.equal(
    payload.expiresAt,
    undefined,
    'no deadline without holdTimeoutSeconds',
  );
  const held = harnessInterruptMirrorInput({
    question: interruptQuestion({ executionConfirmationAuthority: undefined }),
    stage: 'intent_naming',
    request: interruptRequest(),
    holdTimeoutSeconds: 60,
  });
  assert.ok(held.payload.expiresAt);
  const roundtrip = interruptQuestionFromPayload(held.payload);
  assert.equal(roundtrip.questionId, 'question-1');
  assert.equal(roundtrip.response.field, 'execution_confirmation');
});

test('resume decision maps typed resume commands onto the question response', () => {
  const question = interruptQuestion();
  const accepted = interruptResumeDecision(question, interruptResume({ idempotencyKey: 'resume-1' }));
  assert.equal(accepted.questionId, 'question-1');
  assert.equal(accepted.workflowRevision, 3);
  assert.equal(accepted.patch.field, 'execution_confirmation');
  assert.equal(accepted.decision.state, 'accepted');
  assert.equal(accepted.decision.value, 'approved');
  assert.equal(accepted.idempotencyKey, 'resume-1');
  assert.deepEqual(confirmationCardDecision(question, accepted), accepted);

  const rejected = interruptResumeDecision(question, interruptResume({ type: 'reject' }));
  assert.equal(rejected.decision.state, 'ignored');
  assert.equal(rejected.decision.value, 'rejected');
  assert.equal(rejected.idempotencyKey, 'interrupt:question-1:r3');

  const respond = interruptResumeDecision(
    question,
    interruptResume({ type: 'respond', args: { value: '用方案B' } }),
  );
  assert.equal(respond.decision.state, 'accepted');
  assert.equal(respond.decision.value, '用方案B');
  assert.equal(respond.patch.value, '用方案B');
});

test('resume decision fails closed when respond/edit lacks a merchant value', () => {
  const question = interruptQuestion();
  assert.throws(
    () => interruptResumeDecision(question, interruptResume({ type: 'respond' })),
    /requires a merchant value/u,
  );
  assert.throws(
    () => interruptResumeDecision(question, interruptResume({ type: 'edit' })),
    /requires a merchant value/u,
  );
});

test('resume bridge sends the reconstructed decision on the workflow topic with a stable dedup key', async (t) => {
  const sent: unknown[][] = [];
  t.mock.method(DBOS, 'send', async (...args: unknown[]) => {
    sent.push(args);
  });
  const bridge = createHarnessInterruptResumeBridge({
    async workflowRuntimeId() {
      return 'runtime-workflow-1';
    },
  });
  const { payload } = harnessInterruptMirrorInput({
    question: interruptQuestion(),
    stage: 'execution_selection',
    request: interruptRequest(),
  });
  const command = interruptResume({ idempotencyKey: 'resume-1' });
  await bridge.deliver({ workspaceId: 'workspace-1', payload, command });

  assert.equal(sent.length, 1);
  const [destination, message, topic, idempotencyKey] = sent[0] as [
    string,
    StructuredDecisionInput,
    string,
    string,
  ];
  assert.equal(destination, 'runtime-workflow-1');
  assert.equal(topic, 'structured-decision:question-1');
  assert.equal(idempotencyKey, 'harness-interrupt:workspace-1:runtime-workflow-1:question-1:resume-1');
  assert.equal(message.questionId, 'question-1');
  assert.equal(message.decision.value, 'approved');

  // Duplicate resume → same dedup key → exactly-once send semantics.
  await bridge.deliver({ workspaceId: 'workspace-1', payload, command });
  assert.equal(sent.length, 2);
  assert.equal(sent[1]?.[3], sent[0]?.[3]);
});

test('production resume bridge resolves the typed harness interaction before workflow delivery', async () => {
  const submitted: Array<{
    workspaceId: string;
    workflowId?: string;
    answer: unknown;
  }> = [];
  const bridge = createHarnessInterruptResumeBridge(undefined, {
    async submit(workspaceId, answer, workflowId) {
      submitted.push({ workspaceId, workflowId, answer });
    },
  });
  const { payload } = harnessInterruptMirrorInput({
    question: interruptQuestion(),
    stage: 'execution_selection',
    request: interruptRequest(),
  });

  await bridge.deliver({
    workspaceId: 'workspace-1',
    payload,
    command: interruptResume({ idempotencyKey: 'resume-persisted-1' }),
  });

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]?.workspaceId, 'workspace-1');
  assert.equal(submitted[0]?.workflowId, payload.workflowId);
  assert.deepEqual(submitted[0]?.answer, {
    requestId: payload.interruptId,
    revision: payload.revision,
    idempotencyKey: 'resume-persisted-1',
    resume: {
      runId: payload.workflowId,
      step: 'execution_selection',
    },
    response: { kind: 'approved' },
  });
});

test('paid execution interrupt resume writes PlanConfirmationDecision before interaction submit', async () => {
  const decided: Array<{ requestId: string; decision: string; actorId: string }> =
    [];
  const submitted: unknown[] = [];
  const bridge = createHarnessInterruptResumeBridge(
    undefined,
    {
      async submit(_workspaceId, answer) {
        submitted.push(answer);
      },
    },
    {
      async getDecisionForWorkspace() {
        return null;
      },
      async decideForWorkspace(input) {
        decided.push({
          requestId: input.requestId,
          decision: input.decision,
          actorId: input.actorId,
        });
        return {
          decision: planConfirmationDecisionSchema.parse({
            schemaVersion: 'plan-confirmation-decision/v1',
            decisionId: input.decisionId,
            requestId: input.requestId,
            actorId: input.actorId,
            decision: input.decision,
            decidedAt: input.decidedAt,
          }),
          request: null as never,
          merchantMessage: null,
          refundedCredits: 0,
        };
      },
    },
  );
  const { payload } = harnessInterruptMirrorInput({
    question: interruptQuestion(),
    stage: 'execution_selection',
    request: interruptRequest(),
  });
  await bridge.deliver({
    workspaceId: 'workspace-1',
    payload,
    command: interruptResume({ idempotencyKey: 'resume-paid-1' }),
    actorId: 'merchant-1',
  });
  assert.deepEqual(decided, [
    {
      requestId: payload.interruptId,
      decision: 'confirmed',
      actorId: 'merchant-1',
    },
  ]);
  assert.equal(submitted.length, 1);
});

test('paid execution interrupt resume reuses an existing confirmed decision', async () => {
  let decideCalls = 0;
  const bridge = createHarnessInterruptResumeBridge(
    undefined,
    {
      async submit() {
        return undefined;
      },
    },
    {
      async getDecisionForWorkspace() {
        return planConfirmationDecisionSchema.parse({
          schemaVersion: 'plan-confirmation-decision/v1',
          decisionId: 'living-plan-commit:question-1',
          requestId: 'question-1',
          actorId: 'merchant-1',
          decision: 'confirmed',
          decidedAt: '2026-08-11T00:00:00.000Z',
        });
      },
      async decideForWorkspace() {
        decideCalls += 1;
        throw new Error('must not re-decide a confirmed living-plan start');
      },
    },
  );
  const { payload } = harnessInterruptMirrorInput({
    question: interruptQuestion(),
    stage: 'execution_selection',
    request: interruptRequest(),
  });
  await bridge.deliver({
    workspaceId: 'workspace-1',
    payload,
    command: interruptResume({ idempotencyKey: 'resume-paid-replay-1' }),
    actorId: 'merchant-1',
  });
  assert.equal(decideCalls, 0);
});

test('production resume bridge treats an already-resolved interaction as a delivered replay', async () => {
  const bridge = createHarnessInterruptResumeBridge(undefined, {
    async submit() {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REQUEST',
        'The interaction request is no longer pending.',
      );
    },
  });
  const { payload } = harnessInterruptMirrorInput({
    question: interruptQuestion(),
    stage: 'execution_selection',
    request: interruptRequest(),
  });

  await bridge.deliver({
    workspaceId: 'workspace-1',
    payload,
    command: interruptResume({ idempotencyKey: 'resume-replay-1' }),
  });
});

test('production resume bridge accepts the recommended ask-merchant option', async () => {
  const submitted: unknown[] = [];
  const bridge = createHarnessInterruptResumeBridge(undefined, {
    async submit(_workspaceId, answer) {
      submitted.push(answer);
    },
  });
  const { payload } = harnessInterruptMirrorInput({
    question: interruptQuestion({ executionConfirmationAuthority: undefined }),
    stage: 'brief_compilation',
    request: interruptRequest(),
  });

  await bridge.deliver({
    workspaceId: 'workspace-1',
    payload,
    command: interruptResume({ idempotencyKey: 'resume-option-1' }),
  });

  assert.deepEqual(submitted[0], {
    requestId: payload.interruptId,
    revision: payload.revision,
    idempotencyKey: 'resume-option-1',
    resume: { runId: payload.workflowId, step: 'brief_compilation' },
    response: {
      kind: 'answer',
      items: [
        {
          itemId: 'execution_confirmation',
          result: { kind: 'answer', value: '确认执行' },
        },
      ],
    },
  });
});

test('mirror port tolerates a durable retry that recomputes the hold expiry', async () => {
  const store = new MemoryInterruptStore();
  const service = new InterruptProtocolService(
    store,
    {
      async hasMembership() {
        return true;
      },
    },
    () => '2026-08-08T12:00:00.000Z',
  );
  const port = createHarnessInterruptProtocolPort({
    request: (input) => service.request(input),
    resolveByWorkflow: (input) => service.resolveByWorkflow(input),
    getById: (id) => store.getById(id),
  });
  const question = interruptQuestion({ executionConfirmationAuthority: undefined });
  const mirrorInput = {
    workspaceId: 'workspace-1',
    question,
    stage: 'intent_naming' as const,
    request: interruptRequest(),
  };
  // First step attempt writes with one deadline…
  await port.mirrorPending({ ...mirrorInput, holdTimeoutSeconds: 60 });
  // …a durable retry recomputes Date.now() and would produce a new deadline.
  await port.mirrorPending({ ...mirrorInput, holdTimeoutSeconds: 60 });
  const row = await store.getById('question-1');
  assert.equal(row?.status, 'pending');
  assert.equal(row?.payload.revision, 3);

  await port.resolvePending({
    workspaceId: 'workspace-1',
    interruptId: 'question-1',
    revision: 3,
    source: 'core_hold_expired',
  });
  const pending = await store.listPending({
    workspaceId: 'workspace-1',
    resourceId: 'workspace-1',
  });
  assert.equal(pending.length, 0, 'workflow resolution clears the mirrored row');
});

test('production mirror resolves the real AgentThread coordinates', async () => {
  const store = new MemoryInterruptStore();
  const service = new InterruptProtocolService(
    store,
    { async hasMembership() { return true; } },
    () => '2026-08-08T12:00:00.000Z',
  );
  const port = createHarnessInterruptProtocolPort({
    request: (input) => service.request(input),
    resolveByWorkflow: (input) => service.resolveByWorkflow(input),
    getById: (id) => store.getById(id),
    async resolveAgentCoordinates() {
      return { threadId: 'thread:composer:real', runId: 'run:composer:real' };
    },
  });
  await port.mirrorPending({
    workspaceId: 'workspace-1',
    question: interruptQuestion(),
    stage: 'execution_selection',
    request: interruptRequest(),
  });
  const row = await store.getById('question-1');
  assert.equal(row?.payload.threadId, 'thread:composer:real');
  assert.equal(row?.payload.runId, 'run:composer:real');
});

test('mirror port rejects a genuine same-revision payload conflict', async () => {
  const store = new MemoryInterruptStore();
  const service = new InterruptProtocolService(
    store,
    {
      async hasMembership() {
        return true;
      },
    },
    () => '2026-08-08T12:00:00.000Z',
  );
  const port = createHarnessInterruptProtocolPort({
    request: (input) => service.request(input),
    resolveByWorkflow: (input) => service.resolveByWorkflow(input),
    getById: (id) => store.getById(id),
  });
  const base = {
    workspaceId: 'workspace-1',
    question: interruptQuestion(),
    stage: 'execution_selection' as const,
    request: interruptRequest(),
  };
  await port.mirrorPending(base);
  await assert.rejects(
    () =>
      port.mirrorPending({
        ...base,
        question: interruptQuestion({ question: '内容被篡改的另一个问题' }),
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === 'InterruptProtocolError' &&
      (error as { code?: string }).code === 'IDEMPOTENCY_CONFLICT',
  );
});

// ─── V31-14 P1-b: §23.4 safe stop refunds the reservation, never re-charges ──

test('rights-revoked safe stop refunds the reservation without committing a new charge', async () => {
  const events: string[] = [];
  const safeStop = new HarnessExecutionFenceSafeStopError(
    '素材授权已撤销，已安全停止且不会重复扣费。',
  );
  await assert.rejects(
    failHarnessWorkflowPreservingExecutionError({
      billing: {
        async commit() {
          events.push('commit');
          throw new Error('commit must not run for a safe stop');
        },
        async refund() {
          events.push('refund');
        },
        async scheduleCompensation() {
          throw new Error('compensation must not be needed');
        },
      },
      input: settlement,
      error: safeStop,
      runStep: async (_name, operation) => operation(),
      async recordTerminalFailure(quotaRefunded) {
        events.push(`terminal:refunded=${quotaRefunded}`);
      },
    }),
    (error) => error === safeStop,
  );
  assert.deepEqual(
    events,
    ['refund', 'terminal:refunded=true'],
    'safe stop refunds once and reports the refund; no commit step runs',
  );
  assert.equal(
    normalizeHarnessTerminalFailure(safeStop).code,
    'HARNESS_EXECUTION_FENCE_SAFE_STOP',
  );
  assert.equal(
    normalizeHarnessTerminalFailure(safeStop).merchantMessage,
    safeStop.merchantMessage,
  );
});

test('L0.5 production sampling gates by rate and lands a release-bound verdict (V31-23)', async () => {
  const calls: Array<{ kind: string; releaseId: string; resultId?: string }> =
    [];
  const outcome = await sampleProductionL05({
    productionSampling: {
      shouldSample: async () => true,
      sample: async (input) => {
        calls.push({
          kind: 'sample',
          releaseId: input.harnessReleaseId,
          resultId: input.resultId,
        });
        return {
          result: {
            resultId: input.resultId ?? 'sample-result',
            gates: [
              { id: 'l0.5.proxy.fidelity', kind: 'fidelity', passed: true },
              { id: 'l0.5.proxy.rights', kind: 'rights', passed: true },
              { id: 'l0.5.proxy.redline', kind: 'redline', passed: true },
            ],
            quickCheckIds: ['a', 'b'],
            evalSuiteRevision: 'eval/sampling-1',
            createdAt: '2026-08-08T01:00:00.000Z',
            verdict: 'passed',
          },
          quickCheckVerdicts: [],
        } as unknown as Awaited<
          ReturnType<
            NonNullable<HarnessDbosWorkflowOptions['productionSampling']>['sample']
          >
        >;
      },
      recordAndEmit: async (input) => {
        calls.push({ kind: 'emit', releaseId: input.harnessReleaseId });
      },
    },
    workflowId: 'wf-l05-1',
    request: {
      workspaceId: 'ws-1',
      executionSnapshot: { lens: 'copy' } as HarnessWorkflowInput['executionSnapshot'],
      executionPlanSnapshot: {
        harnessReleaseId: 'release-1',
        contextBundleRef: { bundleId: 'ctx-1', revision: 1, hash: 'h' },
        planId: 'plan-1',
        planRevision: 1,
      } as HarnessWorkflowInput['executionPlanSnapshot'],
    } as HarnessWorkflowInput,
  });

  assert.equal(outcome.sampled, true);
  assert.equal(outcome.verdict, 'passed');
  assert.deepEqual(calls, [
    { kind: 'sample', releaseId: 'release-1', resultId: 'l0.5:make:wf-l05-1' },
    { kind: 'emit', releaseId: 'release-1' },
  ]);
});

test('L0.5 production sampling is gated off by the sample rate and never throws', async () => {
  const calls: string[] = [];
  const off = await sampleProductionL05({
    productionSampling: {
      shouldSample: async () => false,
      sample: async () => {
        calls.push('sample');
        throw new Error('must not run');
      },
      recordAndEmit: async () => {
        calls.push('emit');
      },
    },
    workflowId: 'wf-l05-off',
    request: {
      executionPlanSnapshot: {
        harnessReleaseId: 'release-1',
      } as HarnessWorkflowInput['executionPlanSnapshot'],
    } as HarnessWorkflowInput,
  });
  assert.deepEqual(off, { sampled: false });
  assert.equal(calls.length, 0);

  const failing = await sampleProductionL05({
    productionSampling: {
      shouldSample: async () => true,
      sample: async () => {
        throw new Error('sampler exploded');
      },
      recordAndEmit: async () => {
        calls.push('emit');
      },
    },
    workflowId: 'wf-l05-fail',
    request: {
      executionPlanSnapshot: {
        harnessReleaseId: 'release-1',
      } as HarnessWorkflowInput['executionPlanSnapshot'],
    } as HarnessWorkflowInput,
  });
  assert.deepEqual(failing, { sampled: false, error: true });
  assert.equal(calls.length, 0);

  const noSnapshot = await sampleProductionL05({
    productionSampling: {
      shouldSample: async () => true,
      sample: async () => {
        calls.push('sample');
        throw new Error('no snapshot means sample must not run');
      },
      recordAndEmit: async () => {
        calls.push('emit');
      },
    },
    workflowId: 'wf-l05-none',
    request: { workspaceId: 'ws-1' } as HarnessWorkflowInput,
  });
  assert.deepEqual(noSnapshot, { sampled: false });
  assert.equal(calls.length, 0);
});
