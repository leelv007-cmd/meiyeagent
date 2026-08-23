/**
 * Pure resolve semantics for WorkbenchSessionProjection (V31-05 / V3.1 §5.1).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryAgentSessionStore } from './memory-agent-session-store.js';
import {
  EMPTY_THREAD_WORK_AUTHORITY,
  type ThreadWorkAuthorityReader,
  type ThreadWorkRef,
} from './thread-work-authority.js';
import {
  canonicalThreadTaskId,
  listWorkbenchThreads,
  resolveWorkbenchSession,
} from './workbench-session.js';

const RESOURCE = 'resource-workbench';

/**
 * V31-105 §2: the Works a Thread produced, newest first — the shape
 * PostgresThreadWorkAuthorityReader returns from the submission's own
 * `agentBinding`.
 */
function workAuthorityOf(
  works: Readonly<Record<string, readonly ThreadWorkRef[]>>,
): ThreadWorkAuthorityReader {
  return {
    async readThreadWork({ threadId }) {
      return works[threadId] ?? [];
    },
  };
}
const TS = '2026-08-08T10:00:00.000Z';
const TS2 = '2026-08-08T11:00:00.000Z';

test('explicit threadId is preferred even when another thread has active turn', async () => {
  const store = new MemoryAgentSessionStore();
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-explicit',
    title: '显式',
    now: TS,
  });
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-active',
    title: '活跃',
    now: TS2,
  });
  await store.startWriteTurn({
    resourceId: RESOURCE,
    threadId: 'thread-active',
    expectedSessionRevision: 0,
    runId: 'run-active',
    trigger: 'merchant_turn',
    harnessReleaseId: 'harness-v1',
    now: TS2,
  });

  const result = await resolveWorkbenchSession(store, {
    resourceId: RESOURCE,
    explicitThreadId: 'thread-explicit',
    workAuthority: EMPTY_THREAD_WORK_AUTHORITY,
  });

  assert.equal(result.resolveSource, 'explicit_thread');
  assert.equal(result.session?.threadId, 'thread-explicit');
  assert.equal(result.session?.activeRunId, undefined);
});

test('without explicit target, active write turn wins over mere recency', async () => {
  const store = new MemoryAgentSessionStore();
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-quiet',
    title: '安静',
    now: TS2,
  });
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-busy',
    title: '进行中',
    now: TS,
  });
  await store.startWriteTurn({
    resourceId: RESOURCE,
    threadId: 'thread-busy',
    expectedSessionRevision: 0,
    runId: 'run-busy',
    trigger: 'merchant_turn',
    harnessReleaseId: 'harness-v1',
    now: TS,
  });

  const result = await resolveWorkbenchSession(store, {
    resourceId: RESOURCE,
    workAuthority: EMPTY_THREAD_WORK_AUTHORITY,
  });

  assert.equal(result.resolveSource, 'active_turn');
  assert.equal(result.session?.threadId, 'thread-busy');
  assert.equal(result.session?.activeRunId, 'run-busy');
});

test('without active turn, resume most recent active thread', async () => {
  const store = new MemoryAgentSessionStore();
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-older',
    title: '更早',
    now: TS,
  });
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-newer',
    title: '更新',
    now: TS2,
  });

  const result = await resolveWorkbenchSession(store, {
    resourceId: RESOURCE,
    workAuthority: EMPTY_THREAD_WORK_AUTHORITY,
  });

  assert.equal(result.resolveSource, 'recent_thread');
  assert.equal(result.session?.threadId, 'thread-newer');
});

test('empty store resolves Idle', async () => {
  const store = new MemoryAgentSessionStore();
  const result = await resolveWorkbenchSession(store, {
    resourceId: RESOURCE,
    workAuthority: EMPTY_THREAD_WORK_AUTHORITY,
  });
  assert.equal(result.resolveSource, 'idle');
  assert.equal(result.session, null);
});

async function completedTurn(input: {
  store: MemoryAgentSessionStore;
  threadId: string;
  expectedSessionRevision: number;
  runId: string;
  now: string;
}) {
  await input.store.startWriteTurn({
    resourceId: RESOURCE,
    threadId: input.threadId,
    expectedSessionRevision: input.expectedSessionRevision,
    runId: input.runId,
    trigger: 'merchant_turn',
    harnessReleaseId: 'harness-v1',
    now: input.now,
  });
  await input.store.updateRunStatus({
    resourceId: RESOURCE,
    runId: input.runId,
    status: 'completed',
    finishedAt: input.now,
  });
}

test('MEM-02: explicit delivered Thread T projects task A, not workspace-recent B', async () => {
  const store = new MemoryAgentSessionStore();
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-t',
    title: '已交付 T',
    now: TS,
  });
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-u',
    title: '更新的 U',
    now: TS2,
  });
  await completedTurn({
    store,
    threadId: 'thread-t',
    expectedSessionRevision: 0,
    runId: 'run-a',
    now: TS,
  });
  await completedTurn({
    store,
    threadId: 'thread-u',
    expectedSessionRevision: 0,
    runId: 'run-b',
    now: TS2,
  });

  const result = await resolveWorkbenchSession(store, {
    resourceId: RESOURCE,
    explicitThreadId: 'thread-t',
    workAuthority: workAuthorityOf({
      'thread-t': [{ taskId: 'task-a', workId: 'work-a', active: false }],
      'thread-u': [{ taskId: 'task-b', workId: 'work-b', active: false }],
    }),
  });

  assert.equal(result.resolveSource, 'explicit_thread');
  assert.equal(result.session?.threadId, 'thread-t');
  assert.equal(result.session?.recent?.taskId, 'task-a');
  assert.equal(result.session?.recent?.workId, 'work-a');
  assert.notEqual(result.session?.recent?.taskId, 'task-b');
  // Delivered: nothing is still in flight on this Thread.
  assert.equal(result.session?.current, undefined);
});

test('MEM-02: an unfinished Work is current while the newest one is recent', async () => {
  const store = new MemoryAgentSessionStore();
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-t',
    title: '进行中 T',
    now: TS,
  });
  await completedTurn({
    store,
    threadId: 'thread-t',
    expectedSessionRevision: 0,
    runId: 'run-a',
    now: TS,
  });

  const result = await resolveWorkbenchSession(store, {
    resourceId: RESOURCE,
    explicitThreadId: 'thread-t',
    workAuthority: workAuthorityOf({
      'thread-t': [
        { taskId: 'task-newer', active: false },
        { taskId: 'task-running', active: true },
      ],
    }),
  });

  assert.equal(result.session?.recent?.taskId, 'task-newer');
  assert.equal(result.session?.current?.taskId, 'task-running');
});

test('MEM-02: a prepared-attempt task id is canonicalised in the projection', async () => {
  const store = new MemoryAgentSessionStore();
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-t',
    title: '预备尝试',
    now: TS,
  });

  const result = await resolveWorkbenchSession(store, {
    resourceId: RESOURCE,
    explicitThreadId: 'thread-t',
    workAuthority: workAuthorityOf({
      'thread-t': [{ taskId: 'task-a:plan-r2', active: true }],
    }),
  });

  assert.equal(result.session?.recent?.taskId, 'task-a');
  assert.equal(result.session?.current?.taskId, 'task-a');
});

test('MEM-02: prepared-attempt workflow id canonicalizes to the task', () => {
  assert.equal(canonicalThreadTaskId('task-a:plan-r2'), 'task-a');
  assert.equal(canonicalThreadTaskId('task-a'), 'task-a');
});

test('MEM-02: a Thread with no Work/task projects honest empty authority', async () => {
  const store = new MemoryAgentSessionStore();
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-empty',
    title: '空会话',
    now: TS,
  });

  const result = await resolveWorkbenchSession(store, {
    resourceId: RESOURCE,
    explicitThreadId: 'thread-empty',
    workAuthority: EMPTY_THREAD_WORK_AUTHORITY,
  });

  assert.equal(result.session?.current, undefined);
  assert.equal(result.session?.recent, undefined);
});

test('listWorkbenchThreads projects activeRunId', async () => {
  const store = new MemoryAgentSessionStore();
  await store.createThread({
    resourceId: RESOURCE,
    threadId: 'thread-1',
    title: '一',
    now: TS,
  });
  await store.startWriteTurn({
    resourceId: RESOURCE,
    threadId: 'thread-1',
    expectedSessionRevision: 0,
    runId: 'run-1',
    trigger: 'merchant_turn',
    harnessReleaseId: 'harness-v1',
    now: TS,
  });

  const items = await listWorkbenchThreads(store, { resourceId: RESOURCE });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.activeRunId, 'run-1');
  assert.equal(items[0]?.sessionRevision, 1);
});
