import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asAgentThreadIdentity,
  type CreationSubmissionRecord,
} from '../p1/execution-spine/submission-coordinator.js';
import { composerRunId } from '../p1/agent-session/composer-plan-session.js';
import { fingerprintValue } from '../p1/job-runtime/job-contracts.js';
import type { HarnessWorkflowInput } from '../p1/harness/task-admission.js';
import {
  interruptProjectionTaskId,
  resolveInterruptAgentCoordinates,
} from './api-runtime.js';

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

test('interrupt projection resolves the exact persisted non-formula Agent Run', async () => {
  const lookups: Array<{ resourceId: string; runId: string }> = [];
  const resolved = await resolveInterruptAgentCoordinates(
    {
      async getRun(input) {
        lookups.push(input);
        return {
          runId: 'run:persisted-authority',
          threadId: 'thread:persisted-authority',
        };
      },
    },
    {
      workspaceId: 'ws-9',
      workflowId: 'task-formula-would-select-another-run',
      request: {
        ...request('task-formula-would-select-another-run'),
        agentRunId: 'run:persisted-authority',
        agentThreadId: asAgentThreadIdentity('thread:persisted-authority'),
      },
    },
  );

  assert.deepEqual(lookups, [
    { resourceId: 'ws-9', runId: 'run:persisted-authority' },
  ]);
  assert.deepEqual(resolved, {
    runId: 'run:persisted-authority',
    threadId: 'thread:persisted-authority',
  });
});

test('interrupt projection fails closed when lookup returns a different Agent Run', async () => {
  await assert.rejects(
    resolveInterruptAgentCoordinates(
      {
        async getRun() {
          return {
            runId: 'run:other',
            threadId: 'thread:persisted-authority',
          };
        },
      },
      {
        workspaceId: 'ws-9',
        workflowId: 'task-1',
        request: {
          ...request('task-1'),
          agentRunId: 'run:persisted-authority',
          agentThreadId: asAgentThreadIdentity('thread:persisted-authority'),
        },
      },
    ),
    /Agent Run lookup returned run:other for requested run:persisted-authority/u,
  );
});

test('interrupt projection fails closed when a durable agentRunId has no Agent Thread', async () => {
  await assert.rejects(
    resolveInterruptAgentCoordinates(
      {
        async getRun() {
          return {
            runId: 'run:persisted-authority',
            threadId: 'thread:persisted-authority',
          };
        },
      },
      {
        workspaceId: 'ws-9',
        workflowId: 'task-1',
        request: {
          ...request('task-1'),
          agentRunId: 'run:persisted-authority',
        },
      },
    ),
    /Agent Run run:persisted-authority requires an Agent Thread identity/u,
  );
});

test('interrupt projection fails closed when persisted Run and Thread disagree', async () => {
  await assert.rejects(
    resolveInterruptAgentCoordinates(
      {
        async getRun() {
          return {
            runId: 'run:persisted-authority',
            threadId: 'thread:other',
          };
        },
      },
      {
        workspaceId: 'ws-9',
        workflowId: 'task-1',
        request: {
          ...request('task-1'),
          agentRunId: 'run:persisted-authority',
          agentThreadId: asAgentThreadIdentity('thread:persisted-authority'),
        },
      },
    ),
    /Agent Run run:persisted-authority belongs to Thread thread:other, not thread:persisted-authority/u,
  );
});

test('legacy durable requests still resolve by sourceTaskId formula', async () => {
  const sub = submission('ws-9', 'task-original-legacy');
  const expectedRunId = composerRunId(sub);
  const lookups: Array<{ resourceId: string; runId: string }> = [];

  const resolved = await resolveInterruptAgentCoordinates(
    {
      async getRun(input) {
        lookups.push(input);
        return {
          runId: expectedRunId,
          threadId: 'thread:legacy',
        };
      },
    },
    {
      workspaceId: sub.snapshot.workspaceId,
      workflowId: 'task-original-legacy:plan-r2',
      request: {
        ...request(sub.task.id),
        agentThreadId: asAgentThreadIdentity('thread:legacy'),
      },
    },
  );

  assert.deepEqual(lookups, [
    { resourceId: 'ws-9', runId: expectedRunId },
  ]);
  assert.deepEqual(resolved, {
    runId: expectedRunId,
    threadId: 'thread:legacy',
  });
});

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
