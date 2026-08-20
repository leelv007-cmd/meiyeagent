import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adoptSameThreadSuccessor,
  matchingActiveHarnessTask,
  reconcileComposerCanonicalState,
  reconcileRestoredSessionPhase,
  sessionTaskPresentInActiveList,
} from './canonical-work-state';

test('semantic first-version delivery cannot override a still-running work', () => {
  const reconciled = reconcileComposerCanonicalState({
    workStatus: 'running',
    semanticDelivered: true,
    sessionPhase: 'delivered',
  });
  assert.equal(reconciled.inspectorPhase, 'running');
  assert.equal(reconciled.sessionPhase, 'running');
  assert.deepEqual(reconciled.correction, {
    kind: 'semantic_delivery_without_terminal_work',
  });
});

test('a failed work wins over a premature delivery card', () => {
  const reconciled = reconcileComposerCanonicalState({
    workStatus: 'failed',
    semanticDelivered: true,
    sessionPhase: 'delivered',
  });
  assert.equal(reconciled.inspectorPhase, 'failed');
  assert.equal(reconciled.sessionPhase, 'failed');
  assert.equal(
    reconciled.correction?.kind,
    'semantic_delivery_without_terminal_work'
  );
});

test('matching terminal states do not invent a correction', () => {
  assert.equal(
    reconcileComposerCanonicalState({
      workStatus: 'completed',
      semanticDelivered: true,
      sessionPhase: 'delivered',
    }).correction,
    null
  );
  assert.equal(
    reconcileComposerCanonicalState({
      workStatus: 'running',
      semanticDelivered: false,
      sessionPhase: 'running',
    }).inspectorPhase,
    'running'
  );
});

test('a restored session whose task left the active list stops claiming a run', () => {
  assert.equal(
    reconcileRestoredSessionPhase({
      sessionPhase: 'running',
      taskPresentInActiveList: false,
      semanticDelivered: false,
    }),
    'cancelled'
  );
  assert.equal(
    reconcileRestoredSessionPhase({
      sessionPhase: 'submitting',
      taskPresentInActiveList: false,
      semanticDelivered: true,
    }),
    'delivered'
  );
  assert.equal(
    reconcileRestoredSessionPhase({
      sessionPhase: 'running',
      taskPresentInActiveList: false,
      semanticDelivered: false,
      hasLastDelivered: true,
    }),
    'delivered'
  );
});

test('a restored session adopts the same-thread reprice successor', () => {
  const successor = adoptSameThreadSuccessor({
    sessionTaskId: 'task-pred',
    sessionThreadId: 'thread-1',
    activeTasks: [
      { taskId: 'task-succ', agentThreadId: 'thread-1' },
      { taskId: 'task-other', agentThreadId: 'thread-2' },
    ],
  });
  assert.equal(successor?.taskId, 'task-succ');
  assert.equal(
    adoptSameThreadSuccessor({
      sessionTaskId: 'task-pred',
      sessionThreadId: 'thread-1',
      activeTasks: [{ taskId: 'task-other', agentThreadId: 'thread-2' }],
    }),
    null
  );
});

test('a prepared attempt of the same task is the current run, not a successor', () => {
  assert.equal(
    matchingActiveHarnessTask({
      sessionTaskId: 'composer-task:abc',
      activeTasks: [
        {
          taskId: 'composer-task:abc:plan-r1',
          executionConfirmationRequestId: 'confirmation:authority:abc',
        },
      ],
    })?.executionConfirmationRequestId,
    'confirmation:authority:abc'
  );
  assert.equal(
    sessionTaskPresentInActiveList({
      sessionTaskId: 'composer-task:abc',
      activeTasks: [{ taskId: 'composer-task:abc:plan-r1' }],
    }),
    true
  );
  assert.equal(
    sessionTaskPresentInActiveList({
      sessionTaskId: 'composer-task:abc',
      activeTasks: [{ taskId: 'composer-task:abc:plan-r2' }],
    }),
    true
  );
  assert.equal(
    sessionTaskPresentInActiveList({
      sessionTaskId: 'task-1',
      activeTasks: [{ taskId: 'task-12:plan-r1' }],
    }),
    false
  );
  assert.equal(
    adoptSameThreadSuccessor({
      sessionTaskId: 'composer-task:abc',
      sessionThreadId: 'thread-1',
      activeTasks: [
        { taskId: 'composer-task:abc:plan-r2', agentThreadId: 'thread-1' },
      ],
    }),
    null
  );
  assert.equal(
    adoptSameThreadSuccessor({
      sessionTaskId: 'composer-task:abc',
      sessionThreadId: 'thread-1',
      activeTasks: [
        { taskId: 'composer-task:abc:plan-r1', agentThreadId: 'thread-1' },
        { taskId: 'task-succ:plan-r2', agentThreadId: 'thread-1' },
      ],
    })?.taskId,
    'task-succ:plan-r2'
  );
});

test('a live run and an already-terminal session are both left alone', () => {
  assert.equal(
    reconcileRestoredSessionPhase({
      sessionPhase: 'running',
      taskPresentInActiveList: true,
      semanticDelivered: false,
    }),
    null
  );
  assert.equal(
    reconcileRestoredSessionPhase({
      sessionPhase: 'delivered',
      taskPresentInActiveList: false,
      semanticDelivered: true,
    }),
    null
  );
});
