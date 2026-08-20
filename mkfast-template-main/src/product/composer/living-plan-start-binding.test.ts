import assert from 'node:assert/strict';
import test from 'node:test';

import {
  paidConfirmationRequestIdFromActiveTasks,
  shouldPollPaidConfirmationRequestId,
  shouldReconcileMissingPaidActiveTask,
} from './living-plan-start-binding';

const TASK = {
  taskId: 'composer-task:image-text',
  workId: 'work-image-text',
  packageId: 'package-image-text',
};

test('image_text keeps polling until the confirmation request id exists', () => {
  const waiting = {
    requiresMerchantConfirmation: true,
    task: TASK,
    phase: 'running' as const,
  };
  assert.equal(shouldPollPaidConfirmationRequestId(waiting), true);
  assert.equal(
    shouldPollPaidConfirmationRequestId({
      ...waiting,
      phase: 'awaiting_answer',
    }),
    true,
    'interrupt overlay must not stop the Campaign-equivalent poll'
  );
  assert.equal(
    shouldPollPaidConfirmationRequestId({
      ...waiting,
      phase: 'cancelled',
    }),
    false,
    'merchant cancel must not keep polling'
  );
  assert.equal(
    shouldPollPaidConfirmationRequestId({
      ...waiting,
      task: {
        ...TASK,
        executionConfirmationRequestId: 'confirmation:authority:image-text',
      },
    }),
    false
  );
});

test('copy never polls for a paid confirmation request id', () => {
  assert.equal(
    shouldPollPaidConfirmationRequestId({
      requiresMerchantConfirmation: false,
      task: TASK,
      phase: 'running',
    }),
    false
  );
});

test('settled paid sessions stop polling', () => {
  const waiting = {
    requiresMerchantConfirmation: true,
    task: TASK,
    phase: 'running' as const,
  };
  assert.equal(
    shouldPollPaidConfirmationRequestId({ ...waiting, phase: 'delivered' }),
    false
  );
  assert.equal(
    shouldPollPaidConfirmationRequestId({ ...waiting, phase: 'failed' }),
    false
  );
});

test('prepared-attempt active tasks bind the confirmation id onto the bare image_text task', () => {
  assert.equal(
    paidConfirmationRequestIdFromActiveTasks({
      sessionTaskId: TASK.taskId,
      activeTasks: [
        {
          taskId: `${TASK.taskId}:plan-r1`,
          executionConfirmationRequestId: 'confirmation:authority:image-text',
        },
      ],
    }),
    'confirmation:authority:image-text'
  );
  assert.equal(
    paidConfirmationRequestIdFromActiveTasks({
      sessionTaskId: TASK.taskId,
      activeTasks: [{ taskId: `${TASK.taskId}:plan-r1` }],
    }),
    null
  );
});

test('a live paid image_text plan is not reconciled as gone while confirmation is still preparing', () => {
  assert.equal(
    shouldReconcileMissingPaidActiveTask({
      waitingForPaidConfirmation: true,
    }),
    false
  );
  assert.equal(
    shouldReconcileMissingPaidActiveTask({
      waitingForPaidConfirmation: false,
    }),
    true
  );
});
