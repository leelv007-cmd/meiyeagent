import assert from 'node:assert/strict';
import test from 'node:test';
import type { QuestionCard } from '@meiye/contracts';

import {
  harnessDecisionInput,
  missingHarnessDecisionNotificationTask,
} from '@/product/harness-question-card';

test('submits the answer against the server-owned target and revision', () => {
  assert.deepEqual(harnessDecisionInput(question(), '¥398', 'decision-1'), {
    idempotencyKey: 'decision-1',
    questionId: 'question-1',
    workflowRevision: 3,
    patch: {
      field: 'offer_price',
      value: '¥398',
      reason: '补充当前任务所需的权威事实',
    },
    decision: { state: 'accepted', value: '¥398' },
  });
});

test('rejects an empty answer instead of creating a local ignore decision', () => {
  assert.throws(() => harnessDecisionInput(question(), '   ', 'decision-1'));
});

test('notifies a missing decision once per task across parent rerenders', () => {
  assert.equal(
    missingHarnessDecisionNotificationTask(false, 'task-1', undefined),
    'task-1'
  );
  assert.equal(
    missingHarnessDecisionNotificationTask(false, 'task-1', 'task-1'),
    undefined
  );
  assert.equal(
    missingHarnessDecisionNotificationTask(false, 'task-2', 'task-1'),
    'task-2'
  );
  assert.equal(
    missingHarnessDecisionNotificationTask(undefined, 'task-1', undefined),
    undefined
  );
  assert.equal(
    missingHarnessDecisionNotificationTask(true, 'task-1', undefined),
    undefined
  );
});

function question(): QuestionCard {
  return {
    questionId: 'question-1',
    workflowId: 'task-1',
    workflowRevision: 3,
    question: '这次团购价按哪个金额写？',
    options: [{ id: 'price-398', label: '¥398' }],
    freeText: { enabled: true },
    response: {
      field: 'offer_price',
      reason: '补充当前任务所需的权威事实',
    },
    scope: 'current_task',
  };
}
