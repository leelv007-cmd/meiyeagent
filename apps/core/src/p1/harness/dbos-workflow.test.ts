import assert from 'node:assert/strict';
import test from 'node:test';

import {
  autoContinuationDecision,
  commitHarnessBillingOrSchedule,
  failHarnessWorkflowPreservingExecutionError,
  harnessBillingSettlementInput,
  type HarnessBillingSettlementPort,
} from './dbos-workflow.js';
import type { HarnessWorkflowInput } from './task-admission.js';

test('safe confirmation timeout synthesizes the default decision while blocked cards stay pending', () => {
  const question = {
    questionId: 'task-note:confirm',
    workflowId: 'task-note',
    workflowRevision: 1,
    question: '我先按建议补齐并继续，可以吗？',
    options: [{ id: 'continue', label: '按建议继续' }],
    freeText: { enabled: true },
    response: {
      field: 'note_plan_confirmation',
      reason: '确认本次图文计划',
    },
    continuation: {
      autoContinue: true,
      timeoutSeconds: 30,
      defaultValue: '按建议继续',
      pauseOnEdit: true as const,
      blocker: null,
    },
    scope: 'current_task' as const,
  };

  assert.deepEqual(autoContinuationDecision(question), {
    idempotencyKey: 'auto-continue:task-note:confirm',
    questionId: 'task-note:confirm',
    workflowRevision: 1,
    patch: {
      field: 'note_plan_confirmation',
      value: '按建议继续',
      reason: '确认本次图文计划',
    },
    decision: { state: 'accepted', value: '按建议继续' },
  });
  assert.equal(
    autoContinuationDecision({
      ...question,
      continuation: {
        ...question.continuation,
        autoContinue: false,
        blocker: 'editing_paused',
      },
    }),
    null,
  );
});

const settlement = {
  workspaceId: 'workspace-billing-failure',
  taskId: 'task-billing-failure',
  quoteId: 'quote-billing-failure',
  quoteRevision: 'quote-revision-1',
};

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
      async recordTerminalFailure() {
        events.push('terminal');
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
    'terminal',
  ]);
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
