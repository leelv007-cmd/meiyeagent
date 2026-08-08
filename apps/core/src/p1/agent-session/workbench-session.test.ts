/**
 * Pure resolve semantics for WorkbenchSessionProjection (V31-05 / V3.1 §5.1).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryAgentSessionStore } from './memory-agent-session-store.js';
import {
  listWorkbenchThreads,
  resolveWorkbenchSession,
} from './workbench-session.js';

const RESOURCE = 'resource-workbench';
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
  });

  assert.equal(result.resolveSource, 'recent_thread');
  assert.equal(result.session?.threadId, 'thread-newer');
});

test('empty store resolves Idle', async () => {
  const store = new MemoryAgentSessionStore();
  const result = await resolveWorkbenchSession(store, {
    resourceId: RESOURCE,
  });
  assert.equal(result.resolveSource, 'idle');
  assert.equal(result.session, null);
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
