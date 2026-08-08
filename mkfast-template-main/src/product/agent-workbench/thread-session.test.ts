/**
 * V31-05 Thread-root restore policy (pure).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveDashboardThreadTarget,
  threadDashboardHref,
  workbenchRootMode,
} from './thread-session';

test('explicit threadId from search wins; taskId is independent', () => {
  assert.deepEqual(
    resolveDashboardThreadTarget({
      threadId: 'thread-1',
      taskId: 'task-9',
    }),
    { explicitThreadId: 'thread-1', explicitTaskId: 'task-9' }
  );
  assert.deepEqual(
    resolveDashboardThreadTarget({ taskId: 'task-only' }),
    { explicitThreadId: null, explicitTaskId: 'task-only' }
  );
  assert.deepEqual(resolveDashboardThreadTarget({}), {
    explicitThreadId: null,
    explicitTaskId: null,
  });
});

test('workbenchRootMode is idle without session, thread with session', () => {
  assert.equal(
    workbenchRootMode({ session: null, resolveSource: 'idle' }),
    'idle'
  );
  assert.equal(
    workbenchRootMode({
      session: {
        resourceId: 'ws',
        threadId: 't1',
        sessionRevision: 0,
      },
      resolveSource: 'explicit_thread',
    }),
    'thread'
  );
});

test('threadDashboardHref is the sole session entry deep link', () => {
  assert.equal(
    threadDashboardHref('thread-abc'),
    '/dashboard?threadId=thread-abc'
  );
});
