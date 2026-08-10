import assert from 'node:assert/strict';
import test from 'node:test';

import type { CreationSubmissionRecord } from '../p1/execution-spine/submission-coordinator.js';
import { composerRunId } from '../p1/agent-session/composer-plan-session.js';
import { fingerprintValue } from '../p1/job-runtime/job-contracts.js';
import type { HarnessWorkflowInput } from '../p1/harness/task-admission.js';
import { interruptProjectionTaskId } from './api-runtime.js';

function submission(
  workspaceId: string,
  taskId: string,
): CreationSubmissionRecord {
  return {
    snapshot: { workspaceId },
    task: { id: taskId },
  } as unknown as CreationSubmissionRecord;
}

function request(sourceTaskId?: string): HarnessWorkflowInput {
  return { ...(sourceTaskId ? { sourceTaskId } : {}) } as unknown as HarnessWorkflowInput;
}

test('4C: prefers request.sourceTaskId over workflowId when a Living Plan revision set one', () => {
  const selected = interruptProjectionTaskId(
    'task-1:plan-r2',
    request('task-1'),
  );
  assert.equal(selected, 'task-1');
});

test('4C: falls back to workflowId when no sourceTaskId (first, non-versioned attempt)', () => {
  const selected = interruptProjectionTaskId('task-1', request());
  assert.equal(selected, 'task-1');
});

test('4C formula consistency: interrupt projection lands on the exact Agent Run id the Composer committed, for a prepared re-plan attempt', () => {
  // Mirrors creation-stage-port.ts's real wiring: a merchant-confirmed
  // freeze makes the DBOS workflowId `${task.id}:plan-r${revision}` while
  // sourceTaskId carries the original task.id forward (creation-stage-port.ts:49-52).
  const sub = submission('ws-9', 'task-original-1');
  const expectedRunId = composerRunId(sub);

  const workflowId = 'task-original-1:plan-r2';
  const projectedRunId = `run:composer:${fingerprintValue({
    workspaceId: sub.snapshot.workspaceId,
    taskId: interruptProjectionTaskId(workflowId, request('task-original-1')),
  }).slice(0, 32)}`;

  assert.equal(projectedRunId, expectedRunId);
});

test('4C formula consistency: first, non-versioned attempts stay consistent too (workflowId === task.id, no sourceTaskId)', () => {
  const sub = submission('ws-9', 'task-first-1');
  const expectedRunId = composerRunId(sub);

  const projectedRunId = `run:composer:${fingerprintValue({
    workspaceId: sub.snapshot.workspaceId,
    taskId: interruptProjectionTaskId('task-first-1', request()),
  }).slice(0, 32)}`;

  assert.equal(projectedRunId, expectedRunId);
});
