import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commitHarnessBillingOrSchedule,
  failHarnessWorkflowPreservingExecutionError,
  type HarnessBillingSettlementPort,
} from './dbos-workflow.js';

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
