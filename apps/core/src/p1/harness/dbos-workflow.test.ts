import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  questionCardSchema,
  type StructuredDecisionInput,
} from '@meiye/contracts';

import {
  commitHarnessBillingOrSchedule,
  confirmationCardDecision,
  failHarnessWorkflowPreservingExecutionError,
  harnessBillingSettlementInput,
  readConfirmationCardHoldTimeoutSeconds,
  readConfirmationCardTimeoutSeconds,
  resolveHarnessBoundedExecutionContinuation,
  resumeHarnessDbosWorkflow,
  suspensionQuestionFailOpen,
  settleHarnessCancellation,
  settleHarnessTerminalSuccess,
  type HarnessBillingSettlementPort,
} from './dbos-workflow.js';
import type { AdminConfigRepository } from '../admin-config/foundation-module.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import { HarnessWorkflowCancellation } from './workflow-core.js';

const settlement = {
  workspaceId: 'workspace-billing-failure',
  taskId: 'task-billing-failure',
  quoteId: 'quote-billing-failure',
  quoteRevision: 'quote-revision-1',
};

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
    ],
  ]);
});

test('bounded continuation applies only the server-resolved raised limit', async () => {
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
    questionId: 'workflow-1:execution-selection:bounded',
    workflowRevision: 1,
    patch: {
      field: 'bounded_execution_continuation',
      reason: '请求服务端为本次有界执行生成后继钉扎',
      value: '999',
    },
    decision: { state: 'accepted', value: '999' },
  };

  const resumed = await resolveHarnessBoundedExecutionContinuation(
    {
      workflowId: 'workflow-1',
      request,
      suspension,
      command,
    },
    {
      async resolve(input) {
        assert.equal(input.command.decision.value, '999');
        return { limit: 'maxIterations', value: 2 };
      },
    },
  );

  assert.equal(resumed.boundedExecution?.maxIterations, 2);
  assert.equal(resumed.boundedExecution?.consumption.iterations, 1);
  assert.equal(resumed.boundedExecution?.stopReason, null);
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
  assert.match(
    pendingStep,
    /await readConfirmationCardHoldTimeoutSeconds\(config\)/u,
  );

  const mainSource = readFileSync(
    new URL('../../main.ts', import.meta.url),
    'utf8',
  );
  const hotReadKeys = mainSource.match(
    /hotReadKeys:\s*\[([\s\S]*?)\],\s*wiredKeys:/u,
  )?.[1];
  const wiredKeys = mainSource.match(
    /wiredKeys:\s*\[([\s\S]*?)\],\s*\}\),/u,
  )?.[1];
  assert.match(
    hotReadKeys ?? '',
    /HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY/u,
  );
  assert.match(
    wiredKeys ?? '',
    /HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY/u,
  );
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
    'commit',
    'step:schedule-product-usage-commit',
    'scheduled:commit:quote-revision-1',
  ]);
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
    'commit',
    'step:schedule-product-usage-commit',
    'schedule',
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
    'refund',
    'step:schedule-product-usage-refund',
    'scheduled:refund',
    'step:persist-terminal-failure',
    // The 申报卡 quotes this. A scheduled compensation has given nothing back
    // yet, so claiming 「已退回」 here would be the card's one possible lie.
    'terminal:refunded=false',
  ]);
});

test('a refund that lands is the only thing that lets the card say 额度已退回', async () => {
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
    },
    cancellation: new HarnessWorkflowCancellation(
      '超时未选择，本次任务已取消，额度已退回',
    ),
    request,
    runStep: async (name, operation) => {
      events.push(`step:${name}`);
      return operation();
    },
    workflowId: settlement.taskId,
  });

  assert.deepEqual(events, ['step:refund-product-usage', 'refund']);
  assert.deepEqual(result, {
    delivery: null,
    merchantMessage: '超时未选择，本次任务已取消，额度已退回',
    outcome: 'cancelled',
    resolutionSource: 'core_hold_expired',
  });
});

test('hold expiry without a reservation has nothing to refund', async () => {
  const result = await settleHarnessCancellation({
    cancellation: new HarnessWorkflowCancellation(
      '超时未选择，本次任务已取消，额度已退回',
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
        '超时未选择，本次任务已取消，额度已退回',
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
