import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPreparedAttemptRunIdForTask,
  preparedAttemptRunIdForTask,
  taskIdFromPreparedAttemptRunId,
} from './prepared-attempt-run-id.js';

test('a prepared attempt run id round-trips back to its task id', () => {
  for (const revision of [1, 2, 12, 100]) {
    const runId = preparedAttemptRunIdForTask('composer-task:abc', revision);
    assert.ok(runId);
    assert.equal(taskIdFromPreparedAttemptRunId(runId), 'composer-task:abc');
  }
});

test('ids that are not prepared attempts are returned untouched', () => {
  // V31-105 §13 ①A: the media terminal joins a correlationId to
  // creation_submissions.task_id, so this must undo the prepared-attempt
  // spelling and nothing else — a wrong strip would terminate a sibling task.
  for (const id of [
    'composer-task:abc',
    'composer-task:abc:plan-r0',
    'composer-task:abc:plan-r01',
    'composer-task:abc:plan-r',
    'composer-task:abc:plan-r1:carrier-note',
    'composer-task:abc:plan-rx',
    ':plan-r1',
  ]) {
    assert.equal(taskIdFromPreparedAttemptRunId(id), id, id);
  }
});

test('the reader agrees with the family predicate on every id it strips', () => {
  const runId = 'composer-task:abc:plan-r3';
  const taskId = taskIdFromPreparedAttemptRunId(runId);
  assert.notEqual(taskId, runId);
  assert.equal(isPreparedAttemptRunIdForTask(runId, taskId), true);
  // A task id that merely shares a prefix must not adopt this run.
  assert.equal(isPreparedAttemptRunIdForTask(runId, 'composer-task:ab'), false);
});
