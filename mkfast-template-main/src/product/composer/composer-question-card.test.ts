import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composerQuestionDecision,
  composerQuestionEditingDecision,
} from './composer-question-card';

const question = {
  questionId: 'task-note:confirmation',
  workflowId: 'task-note',
  workflowRevision: 1,
  question: '继续吗？',
  options: [],
  freeText: { enabled: true },
  response: {
    field: 'note_plan_confirmation',
    reason: '确认图文计划',
  },
  scope: 'current_task' as const,
};

test('question editing uses the existing decision channel without accepting the answer', () => {
  const editing = composerQuestionEditingDecision({
    question,
    value: '正在补充案例重点',
    idempotencyKey: 'decision-editing',
  });
  const accepted = composerQuestionDecision({
    question,
    value: '补充完成',
    skipped: false,
    idempotencyKey: 'decision-accepted',
  });

  assert.equal(editing.decision.state, 'editing');
  assert.equal(editing.patch.value, '正在补充案例重点');
  assert.equal(accepted.decision.state, 'accepted');
});
