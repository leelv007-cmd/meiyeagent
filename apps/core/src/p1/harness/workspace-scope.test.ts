import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancelHarnessRuntimeWorkflows,
  harnessRuntimeId,
} from './workspace-scope.js';

test('cancelHarnessRuntimeWorkflows tries runtime id then logical id', async () => {
  const calls: string[] = [];
  await cancelHarnessRuntimeWorkflows({
    workspaceId: 'ws-1',
    workflowIds: ['task-1'],
    cancel: async (runtimeId) => {
      calls.push(runtimeId);
    },
  });
  assert.deepEqual(calls, [harnessRuntimeId('ws-1', 'task-1'), 'task-1']);
});

test('cancelHarnessRuntimeWorkflows continues when one cancel rejects', async () => {
  const calls: string[] = [];
  await cancelHarnessRuntimeWorkflows({
    workspaceId: 'ws-1',
    workflowIds: ['task-1', 'task-2'],
    cancel: async (runtimeId) => {
      calls.push(runtimeId);
      if (calls.length === 1) throw new Error('missing workflow');
    },
  });
  assert.equal(calls.length, 4);
});
