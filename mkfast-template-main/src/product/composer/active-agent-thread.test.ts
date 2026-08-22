import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPublishHandoffThreadCurrent,
  pickComposerRestoreTask,
  selectActiveAgentThreadId,
  selectSubmissionAgentThreadId,
} from './active-agent-thread';

test('an explicit Thread deep link replaces a restored session Thread', () => {
  assert.equal(
    selectActiveAgentThreadId({
      agentBindingThreadId: 'thread-binding-a',
      continuedAgentThreadId: 'thread-continued-a',
      explicitThreadId: 'thread-b',
      phase: 'delivered',
      taskAgentThreadId: 'thread-task-a',
    }),
    'thread-b'
  );
});

test('a session Thread remains the fallback without an explicit deep link', () => {
  assert.equal(
    selectActiveAgentThreadId({
      agentBindingThreadId: 'thread-binding-a',
      continuedAgentThreadId: 'thread-continued-a',
      explicitThreadId: null,
      phase: 'delivered',
      taskAgentThreadId: 'thread-task-a',
    }),
    'thread-task-a'
  );
});

test('MEM-02: ?threadId=T does not adopt workspace-latest task B', () => {
  const tasks = [
    { taskId: 'task-b', agentThreadId: 'thread-u' },
    { taskId: 'task-a', agentThreadId: 'thread-t' },
  ];
  assert.equal(
    pickComposerRestoreTask({
      initialThreadId: 'thread-t',
      tasks,
    })?.taskId,
    'task-a'
  );
  assert.equal(
    pickComposerRestoreTask({
      initialThreadId: 'thread-t',
      tasks: [tasks[0]!],
    }),
    null
  );
  assert.equal(
    pickComposerRestoreTask({
      initialTaskId: 'task-explicit',
      initialThreadId: 'thread-t',
      tasks: [
        { taskId: 'task-explicit', agentThreadId: 'thread-other' },
        ...tasks,
      ],
    })?.taskId,
    'task-explicit'
  );
});

test('a delivered handoff cannot follow an explicit deep link to another Thread', () => {
  assert.equal(
    isPublishHandoffThreadCurrent({
      activeThreadId: 'thread-b',
      deliveredThreadId: 'thread-a',
    }),
    false
  );
  assert.equal(
    isPublishHandoffThreadCurrent({
      activeThreadId: 'thread-b',
      deliveredThreadId: 'thread-b',
    }),
    true
  );
  assert.equal(
    isPublishHandoffThreadCurrent({
      activeThreadId: 'thread-b',
      deliveredThreadId: null,
    }),
    false
  );
});

test('a creation started while a run is in flight opens its own Thread', () => {
  // The Thread of the running task is exactly what Core refuses a second write
  // turn on, so a submission must not name it.
  assert.equal(
    selectSubmissionAgentThreadId({
      activeAgentThreadId: 'thread-running',
      phase: 'running',
    }),
    null
  );
  assert.equal(
    selectSubmissionAgentThreadId({
      activeAgentThreadId: 'thread-waiting',
      phase: 'awaiting_answer',
    }),
    null
  );
});

test('a delivered Thread is still continued', () => {
  // §2.3 / EXEC-04: Delivered ≠ Thread complete.
  assert.equal(
    selectSubmissionAgentThreadId({
      activeAgentThreadId: 'thread-delivered',
      phase: 'delivered',
    }),
    'thread-delivered'
  );
  assert.equal(
    selectSubmissionAgentThreadId({
      activeAgentThreadId: null,
      phase: 'idle',
    }),
    null
  );
});

test('submitting is in flight here; the caller must ask before the press', () => {
  // This function has no way to tell "the press I am handling" from "a run
  // that started earlier" — both read `submitting`. useComposerRun therefore
  // captures the answer when attemptSubmit is entered, which is the only
  // moment the phase still describes the earlier run; the delivered-continues
  // case is pinned in use-composer-run.interaction.test.tsx.
  assert.equal(
    selectSubmissionAgentThreadId({
      activeAgentThreadId: 'thread-delivered',
      phase: 'submitting',
    }),
    null
  );
});
