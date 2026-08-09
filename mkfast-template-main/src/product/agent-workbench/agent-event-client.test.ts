/**
 * V31-04 reconnect client — sole implementation of §27.6 recovery order.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentSemanticEventWireSchema,
  type AgentSemanticEventWire,
} from '@meiye/contracts';

import {
  createAgentEventStore,
  type AgentEventStore,
} from './agent-event-store';
import {
  applyLiveSemanticEvent,
  reconnectAgentWorkbench,
  type AgentReplayLoader,
} from './agent-event-client';
import {
  projectVisibleNarratives,
  type WorkbenchSessionProjection,
} from './agent-event-reducer';

const TS = '2026-08-08T12:00:00.000Z';
const THREAD = 'thread-reconnect';
const RESOURCE = 'resource-reconnect';

function session(
  overrides: Partial<WorkbenchSessionProjection> = {}
): WorkbenchSessionProjection {
  return {
    resourceId: RESOURCE,
    threadId: THREAD,
    sessionRevision: 2,
    ...overrides,
  };
}

function wire(overrides: {
  eventId: string;
  streamOffset: string;
  eventType: string;
  threadId?: string;
  payload?: unknown;
}): AgentSemanticEventWire {
  return agentSemanticEventWireSchema.parse({
    schemaVersion: 'agent-semantic-event/v1',
    threadId: overrides.threadId ?? THREAD,
    contextRole: 'included',
    sourceDomain: 'agent_run',
    sourceEntityId: 'run-1',
    sourceRevision: '1',
    correlationId: 'corr-1',
    payload: overrides.payload ?? {},
    occurredAt: TS,
    eventId: overrides.eventId,
    streamOffset: overrides.streamOffset,
    eventType: overrides.eventType,
  });
}

function loader(events: AgentSemanticEventWire[]): AgentReplayLoader {
  return async ({ clientLastEventId }) => {
    const after = clientLastEventId
      ? events.filter((event) => {
          // simple cursor: return events after matching id by order
          const idx = events.findIndex((e) => e.eventId === clientLastEventId);
          return idx >= 0 ? events.indexOf(event) > idx : true;
        })
      : events;
    return {
      session: session(),
      snapshot: {
        revision: events.at(-1)?.streamOffset ?? '0',
        lastEventId: clientLastEventId ?? null,
        lastStreamOffset: clientLastEventId
          ? (events.find((e) => e.eventId === clientLastEventId)
              ?.streamOffset ?? null)
          : null,
      },
      events: after,
    };
  };
}

test('reconnect order: session → snapshot → replay events (sole recovery API)', async () => {
  const store = createAgentEventStore();
  store.dispatch({ type: 'set_explicit_task_id', taskId: 'task-url' });

  await reconnectAgentWorkbench({
    store,
    loadReplay: loader([
      wire({
        eventId: 'e1',
        streamOffset: '1',
        eventType: 'message.final',
        payload: { text: '恢复叙事' },
      }),
      wire({
        eventId: 'e2',
        streamOffset: '2',
        eventType: 'interrupt.requested',
        payload: {
          interruptId: 'int-1',
          interruptType: 'answer_question',
          description: '待回答',
          revision: 1,
        },
      }),
    ]),
  });

  const state = store.getState();
  assert.equal(state.connection, 'live');
  assert.equal(state.session?.threadId, THREAD);
  assert.equal(state.explicitTaskId, 'task-url');
  assert.equal(projectVisibleNarratives(state).length, 1);
  assert.equal(state.pendingInterrupts.length, 1);
});

test('patch failure triggers automatic snapshot resync via reconnect only', async () => {
  const store: AgentEventStore = createAgentEventStore();
  let loads = 0;
  const events = [
    wire({
      eventId: 'e1',
      streamOffset: '1',
      eventType: 'message.final',
      payload: { text: '稳定行' },
    }),
  ];

  await reconnectAgentWorkbench({
    store,
    loadReplay: async () => {
      loads += 1;
      return {
        session: session(),
        snapshot: {
          revision: '0',
          lastEventId: null,
          lastStreamOffset: null,
        },
        events,
      };
    },
  });
  assert.equal(loads, 1);
  assert.equal(projectVisibleNarratives(store.getState()).length, 1);

  // Simulate live patch failure → client must call reconnect (not ad-hoc fold)
  store.dispatch({ type: 'patch_failed', reason: 'apply_threw' });
  assert.equal(store.getState().needsSnapshotResync, true);

  await reconnectAgentWorkbench({
    store,
    loadReplay: async () => {
      loads += 1;
      return {
        session: session(),
        snapshot: {
          revision: '0',
          lastEventId: null,
          lastStreamOffset: null,
        },
        events,
      };
    },
  });

  assert.equal(loads, 2);
  assert.equal(store.getState().needsSnapshotResync, false);
  assert.equal(projectVisibleNarratives(store.getState()).length, 1);
});

test('same-Thread cursor replay preserves the materialized projection', async () => {
  const store = createAgentEventStore();
  const first = wire({
    eventId: 'e1',
    streamOffset: '1',
    eventType: 'message.final',
    payload: { text: '第一条' },
  });
  const second = wire({
    eventId: 'e2',
    streamOffset: '2',
    eventType: 'message.final',
    payload: { text: '第二条' },
  });

  await reconnectAgentWorkbench({ store, loadReplay: loader([first]) });
  await reconnectAgentWorkbench({ store, loadReplay: loader([first, second]) });

  assert.deepEqual(
    projectVisibleNarratives(store.getState()).map(({ text }) => text),
    ['第一条', '第二条']
  );
  assert.equal(store.getState().lastEventId, 'e2');
});

test('switching Threads starts replay without the previous Thread cursor', async () => {
  const store = createAgentEventStore();
  store.dispatch({
    type: 'hydrate_replay',
    session: session({ threadId: 'thread-old' }),
    snapshot: {
      revision: '9',
      lastEventId: 'event-old-9',
      lastStreamOffset: '9',
    },
    events: [],
  });
  let receivedCursor: string | null | undefined;

  await reconnectAgentWorkbench({
    store,
    threadId: 'thread-new',
    loadReplay: async (input) => {
      receivedCursor = input.clientLastEventId;
      return {
        session: session({ threadId: 'thread-new' }),
        snapshot: {
          revision: '0',
          lastEventId: null,
          lastStreamOffset: null,
        },
        events: [],
      };
    },
  });

  assert.equal(receivedCursor, null);
  assert.equal(store.getState().session?.threadId, 'thread-new');
});

test('live apply that fails marks resync and does not keep partial bad state', () => {
  const store = createAgentEventStore();
  store.dispatch({
    type: 'hydrate_replay',
    session: session(),
    snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
    events: [],
  });

  // Invalid: missing required shape for activity — client treats as patch fail
  const result = applyLiveSemanticEvent(
    store,
    wire({
      eventId: 'bad',
      streamOffset: '1',
      eventType: 'activity.snapshot',
      payload: { activityId: '' }, // empty activity id → patch fail
    })
  );

  assert.equal(result.ok, false);
  assert.equal(store.getState().needsSnapshotResync, true);
  assert.equal(store.getState().connection, 'resyncing');
});
