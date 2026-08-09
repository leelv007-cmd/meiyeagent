import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  questionCardSchema,
  resumeInterruptCommandSchema,
  type InterruptPayload,
  type ResumeInterruptCommand,
  type StructuredDecisionInput,
} from '@meiye/contracts';
import { ADMIN_CONFIG_KEY_CLASSIFICATION } from '../../assembly/domain-rules.js';
import { HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY } from '../admin-config/index.js';

import {
  InterruptProtocolService,
  MemoryInterruptStore,
} from './interrupt-protocol.js';
import {
  HarnessExecutionFencePauseError,
  HarnessExecutionFenceSafeStopError,
} from './context-fence.js';
import { HarnessInteractionError } from './interaction-service.js';
import { normalizeHarnessTerminalFailure } from './terminal-failure.js';

import {
  commitHarnessBillingOrSchedule,
  assertHarnessInteractionContinuationLayout,
  confirmationCardDecision,
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
import type { HarnessWorkflowInput } from './task-admission.js';
import {
  HarnessWorkflowCancellation,
  type HarnessStagePorts,
} from './workflow-core.js';

const settlement = {
  workspaceId: 'workspace-billing-failure',
  taskId: 'task-billing-failure',
  quoteId: 'quote-billing-failure',
  quoteRevision: 'quote-revision-1',
};

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
  const request = {
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
  } as HarnessWorkflowInput;
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

test('a pre-a9 replay stops before settlement, terminal writes, or later DBOS operations', async (t) => {
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
  const request = {
    workspaceId,
    workflowRevision: 1,
    usageReservation: {
      id: `usage-reservation-${workflowId}`,
      units: [{ resource: 'copy', quantity: 1 }],
    },
  } as HarnessWorkflowInput;

  await assert.rejects(
    workflow({ workflowId, request }),
    (error: unknown) =>
      error instanceof HarnessInteractionLayoutResetRequiredError &&
      error.code === 'HARNESS_INTERACTION_LAYOUT_RESET_REQUIRED',
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
  const request = {
    workspaceId: 'workspace-ask',
    workflowRevision: question.workflowRevision,
  } as HarnessWorkflowInput;

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
  } as HarnessWorkflowInput;

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
  const request = {
    workspaceId: settlement.workspaceId,
    executionSnapshot: {
      quote: { id: settlement.quoteId, revision: settlement.quoteRevision },
    },
    usageReservation: { id: 'usage-reservation-hold', units: [] },
  } as unknown as HarnessWorkflowInput;
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
  const request = {
    workspaceId: settlement.workspaceId,
    executionSnapshot: {
      quote: { id: settlement.quoteId, revision: settlement.quoteRevision },
    },
    usageReservation: { id: 'usage-reservation-hold', units: [] },
  } as unknown as HarnessWorkflowInput;
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

test('an explicit hard-cap stop keeps its decision reason while refund is pending', async () => {
  const request = {
    workspaceId: settlement.workspaceId,
    executionSnapshot: {
      quote: { id: settlement.quoteId, revision: settlement.quoteRevision },
    },
    usageReservation: { id: 'usage-reservation-hard-cap', units: [] },
  } as unknown as HarnessWorkflowInput;
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
  const request = {
    workspaceId: settlement.workspaceId,
    executionSnapshot: {
      quote: { id: settlement.quoteId, revision: settlement.quoteRevision },
    },
    usageReservation: { id: 'usage-reservation-hold', units: [] },
  } as unknown as HarnessWorkflowInput;
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
    request: { workspaceId: 'workspace-no-reservation' } as HarnessWorkflowInput,
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
      request: {
        usageReservation: { id: 'usage-reservation-missing-billing', units: [] },
        workspaceId: 'workspace-missing-billing',
      } as unknown as HarnessWorkflowInput,
      runStep: async (_name, operation) => operation(),
      workflowId: 'task-missing-billing',
    }),
    /requires its reserved billing input/u,
  );
});

test('execution receipt forwards trusted per-bucket product units to settlement', () => {
  const request = {
    workspaceId: 'workspace-note-units',
    executionSnapshot: {
      quote: { id: 'quote-note-units', revision: 'quote-r1' },
    },
  } as HarnessWorkflowInput;

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
