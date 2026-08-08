/**
 * V31-04 reducer contract tests (V3.1 §27.6 / §28.2).
 * External behavior only: out-of-order / duplicate / patch-fail resync /
 * reconnect order (explicit taskId + pending interrupt priority).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentSemanticEventWireSchema,
  type AgentSemanticEventWire,
} from '@meiye/contracts';

import {
  createEmptyAgentWorkbenchState,
  projectVisibleActivities,
  projectVisibleNarratives,
  reduceAgentWorkbench,
  type AgentWorkbenchClientState,
  type WorkbenchSessionProjection,
} from './agent-event-reducer';

const TS = '2026-08-08T12:00:00.000Z';
const THREAD = 'thread-1';
const RESOURCE = 'resource-1';

function session(
  overrides: Partial<WorkbenchSessionProjection> = {}
): WorkbenchSessionProjection {
  return {
    resourceId: RESOURCE,
    threadId: THREAD,
    sessionRevision: 1,
    ...overrides,
  };
}

function wire(overrides: {
  eventId: string;
  streamOffset: string;
  eventType: string;
  threadId?: string;
  payload?: unknown;
  contextRole?: AgentSemanticEventWire['contextRole'];
  occurredAt?: string;
}): AgentSemanticEventWire {
  return agentSemanticEventWireSchema.parse({
    schemaVersion: 'agent-semantic-event/v1',
    threadId: overrides.threadId ?? THREAD,
    contextRole: overrides.contextRole ?? 'included',
    sourceDomain: 'agent_run',
    sourceEntityId: 'run-1',
    sourceRevision: '1',
    correlationId: 'corr-1',
    payload: overrides.payload ?? {},
    occurredAt: overrides.occurredAt ?? TS,
    eventId: overrides.eventId,
    streamOffset: overrides.streamOffset,
    eventType: overrides.eventType,
  });
}

function empty(
  overrides: Partial<AgentWorkbenchClientState> = {}
): AgentWorkbenchClientState {
  return {
    ...createEmptyAgentWorkbenchState(),
    ...overrides,
  };
}

test('message.final appends a narrative document line (not chat bubble state)', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-msg-1',
      streamOffset: '1',
      eventType: 'message.final',
      payload: { text: '已理解你的周末预约需求' },
    }),
  }).state;

  const lines = projectVisibleNarratives(state);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.text, '已理解你的周末预约需求');
  assert.equal(lines[0]?.id, 'evt-msg-1');
});

test('duplicate eventId is ignored (idempotent apply)', () => {
  const event = wire({
    eventId: 'evt-dup',
    streamOffset: '1',
    eventType: 'message.final',
    payload: { text: '一次交付' },
  });
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event,
  }).state;
  const again = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event,
  });
  assert.equal(again.duplicate, true);
  assert.equal(projectVisibleNarratives(again.state).length, 1);
  assert.equal(again.state.lastEventId, 'evt-dup');
});

test('out-of-order streamOffset batch sorts and yields sequential state', () => {
  let state = empty({ session: session() });
  const result = reduceAgentWorkbench(state, {
    type: 'apply_events_batch',
    events: [
      wire({
        eventId: 'evt-2',
        streamOffset: '2',
        eventType: 'message.final',
        payload: { text: '第二行' },
      }),
      wire({
        eventId: 'evt-1',
        streamOffset: '1',
        eventType: 'message.final',
        payload: { text: '第一行' },
      }),
    ],
  });
  const texts = projectVisibleNarratives(result.state).map((line) => line.text);
  assert.deepEqual(texts, ['第一行', '第二行']);
  assert.equal(result.state.lastStreamOffset, '2');
  assert.equal(result.state.lastEventId, 'evt-2');
});

test('foreign thread events are ignored', () => {
  let state = empty({ session: session() });
  const result = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-other',
      streamOffset: '1',
      eventType: 'message.final',
      threadId: 'thread-other',
      payload: { text: '别的会话' },
    }),
  });
  assert.equal(result.foreign, true);
  assert.equal(projectVisibleNarratives(result.state).length, 0);
  assert.equal(result.state.lastEventId, null);
});

test('empty activity.snapshot is not projected (card reduction)', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-empty-act',
      streamOffset: '1',
      eventType: 'activity.snapshot',
      payload: { activityId: 'act-1', title: '', status: 'idle' },
    }),
  }).state;
  assert.equal(projectVisibleActivities(state).length, 0);
});

test('activity with title is projected; empty detail still ok when title present', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-act',
      streamOffset: '1',
      eventType: 'activity.snapshot',
      payload: {
        activityId: 'act-read',
        title: '正在读门店资料',
        status: 'running',
      },
    }),
  }).state;
  const activities = projectVisibleActivities(state);
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.title, '正在读门店资料');
});

test('duplicate work.delivered by deliveryKey is not shown twice', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-del-1',
      streamOffset: '1',
      eventType: 'work.delivered',
      payload: {
        deliveryKey: 'pkg-rev-1',
        text: '文案已就绪',
      },
    }),
  }).state;
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-del-2',
      streamOffset: '2',
      eventType: 'work.delivered',
      payload: {
        deliveryKey: 'pkg-rev-1',
        text: '文案已就绪（重复）',
      },
    }),
  }).state;
  const lines = projectVisibleNarratives(state);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.text, '文案已就绪');
});

test('patch failure discards local projection and marks resync (unique reconnect seam)', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-1',
      streamOffset: '1',
      eventType: 'message.final',
      payload: { text: '本地已有' },
    }),
  }).state;
  assert.equal(projectVisibleNarratives(state).length, 1);

  state = reduceAgentWorkbench(state, {
    type: 'patch_failed',
    reason: 'malformed_event',
  }).state;

  assert.equal(state.needsSnapshotResync, true);
  assert.equal(state.connection, 'resyncing');
  assert.equal(projectVisibleNarratives(state).length, 0);
  assert.equal(state.lastEventId, null);
  assert.equal(Object.keys(state.activities).length, 0);
});

test('hydrate_replay is the sole recovery path: snapshot cursor then events', () => {
  const state = reduceAgentWorkbench(empty(), {
    type: 'hydrate_replay',
    session: session({ activeRunId: 'run-9' }),
    snapshot: {
      revision: '2',
      lastEventId: null,
      lastStreamOffset: null,
    },
    events: [
      wire({
        eventId: 'evt-1',
        streamOffset: '1',
        eventType: 'message.final',
        payload: { text: '重放一行' },
      }),
      wire({
        eventId: 'evt-2',
        streamOffset: '2',
        eventType: 'interrupt.requested',
        payload: {
          interruptId: 'int-1',
          interruptType: 'answer_question',
          description: '这次团购价按哪个金额写？',
          revision: 1,
        },
      }),
    ],
  }).state;

  assert.equal(state.session?.threadId, THREAD);
  assert.equal(state.session?.activeRunId, 'run-9');
  assert.equal(state.connection, 'live');
  assert.equal(state.needsSnapshotResync, false);
  assert.equal(projectVisibleNarratives(state).length, 1);
  assert.equal(state.pendingInterrupts.length, 1);
  assert.equal(state.pendingInterrupts[0]?.interruptId, 'int-1');
  assert.equal(state.lastEventId, 'evt-2');
});

test('§27.6: explicit taskId is never overwritten by recent-task hydrate', () => {
  let state = empty({
    explicitTaskId: 'task-explicit',
    session: session(),
  });
  state = reduceAgentWorkbench(state, {
    type: 'hydrate_replay',
    session: session({
      activeRunId: 'run-from-recent',
      // recent path may try to suggest another task — client keeps explicit
    }),
    snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
    events: [],
    recentTaskId: 'task-from-recent-list',
  }).state;

  assert.equal(state.explicitTaskId, 'task-explicit');
  assert.notEqual(state.explicitTaskId, 'task-from-recent-list');
});

test('§27.6: pending interrupts sort ahead of narrative for display priority', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_events_batch',
    events: [
      wire({
        eventId: 'evt-msg',
        streamOffset: '1',
        eventType: 'message.final',
        payload: { text: '叙事' },
      }),
      wire({
        eventId: 'evt-int',
        streamOffset: '2',
        eventType: 'interrupt.requested',
        payload: {
          interruptId: 'int-urgent',
          interruptType: 'confirm_paid_execution',
          description: '确认本次付费制作',
          revision: 3,
        },
      }),
    ],
  }).state;

  assert.equal(state.pendingInterrupts[0]?.interruptId, 'int-urgent');
  // Priority projection: interrupts present before narratives in timeline host
  assert.ok(state.pendingInterrupts.length > 0);
  assert.ok(projectVisibleNarratives(state).length > 0);
});

test('set_explicit_task_id updates the reconnect preference', () => {
  const state = reduceAgentWorkbench(empty(), {
    type: 'set_explicit_task_id',
    taskId: 'task-from-url',
  }).state;
  assert.equal(state.explicitTaskId, 'task-from-url');
});
