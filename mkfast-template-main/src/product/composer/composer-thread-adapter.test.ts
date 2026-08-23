/**
 * ARCH-02 / SUBMIT-01B: AgentEventStore is the unique Thread projection.
 * Behavior only — two subscribers, reconnect cursor, BFF recovery, read-only adapter.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentSemanticEventWireSchema,
  type AgentSemanticEventWire,
} from '@meiye/contracts';

import {
  reconnectAgentWorkbench,
  type AgentReplayLoader,
} from '@/product/agent-workbench/agent-event-client';
import {
  boundWorkbenchTaskId,
  type ThreadTurnPhase,
  type WorkbenchSessionProjection,
} from '@/product/agent-workbench/agent-event-reducer';
import { createAgentEventStore } from '@/product/agent-workbench/agent-event-store';

import {
  projectComposerSessionFromThread,
  projectComposerThread,
} from './composer-thread-adapter';
import {
  bindComposerTask,
  createComposerSession,
  openComposerTurn,
  type ComposerSession,
} from './composer-session';

const TS = '2026-08-20T08:00:00.000Z';
const THREAD = 'thread-arch02';
const RESOURCE = 'workspace-arch02';
const TASK = {
  taskId: 'task-1',
  workId: 'work-1',
  packageId: 'package-1',
  agentThreadId: THREAD,
  agentRunId: 'run-1',
};

function session(
  overrides: Partial<WorkbenchSessionProjection> = {}
): WorkbenchSessionProjection {
  return {
    resourceId: RESOURCE,
    threadId: THREAD,
    sessionRevision: 1,
    activeRunId: 'run-1',
    current: { taskId: TASK.taskId, workId: TASK.workId },
    ...overrides,
  };
}

function wire(input: {
  eventId: string;
  streamOffset: string;
  eventType: string;
  payload?: unknown;
}): AgentSemanticEventWire {
  return agentSemanticEventWireSchema.parse({
    schemaVersion: 'agent-semantic-event/v1',
    threadId: THREAD,
    contextRole: 'included',
    sourceDomain: 'agent_run',
    sourceEntityId: TASK.agentRunId,
    sourceRevision: '1',
    correlationId: 'corr-arch02',
    payload: input.payload ?? {
      taskId: TASK.taskId,
      runId: TASK.agentRunId,
      workId: TASK.workId,
    },
    occurredAt: TS,
    eventId: input.eventId,
    streamOffset: input.streamOffset,
    eventType: input.eventType,
  });
}

function localComposer(): ComposerSession {
  return bindComposerTask(
    openComposerTurn(createComposerSession('session-arch02'), '写一条周末预约'),
    TASK
  );
}

function hydrateThread() {
  const store = createAgentEventStore();
  store.dispatch({
    type: 'hydrate_replay',
    session: session({
      current: undefined,
      recent: { taskId: TASK.taskId, workId: TASK.workId },
    }),
    snapshot: {
      revision: '0',
      lastEventId: null,
      lastStreamOffset: null,
    },
    events: [],
    recentTaskId: TASK.taskId,
  });
  return store;
}

function recordTransitions<T>(read: () => T): {
  values: T[];
  onStore: () => void;
} {
  const values: T[] = [];
  return {
    values,
    onStore: () => {
      const next = read();
      if (values.at(-1) !== next) values.push(next);
    },
  };
}

test('one accepted/planning/ready/failure event yields one phase/task transition for two subscribers', () => {
  const store = hydrateThread();
  const local = localComposer();
  const workbench = recordTransitions(
    () => store.getState().turnPhase as ThreadTurnPhase | null
  );
  const adapter = recordTransitions(
    () => projectComposerThread(store.getState()).turnPhase
  );
  store.subscribe(workbench.onStore);
  store.subscribe(adapter.onStore);

  for (const [eventType, phase] of [
    ['accepted', 'accepted'],
    ['planning', 'planning'],
    ['ready', 'ready'],
    ['failure', 'failure'],
  ] as const) {
    workbench.values.length = 0;
    adapter.values.length = 0;
    store.dispatch({
      type: 'apply_semantic_event',
      event: wire({
        eventId: `evt-${eventType}`,
        streamOffset: String(
          eventType === 'accepted'
            ? 1
            : eventType === 'planning'
              ? 2
              : eventType === 'ready'
                ? 3
                : 4
        ),
        eventType,
      }),
    });
    assert.deepEqual(workbench.values, [phase]);
    assert.deepEqual(adapter.values, [phase]);
    assert.equal(projectComposerThread(store.getState()).taskId, TASK.taskId);
    assert.equal(
      projectComposerThread(store.getState()).runId,
      TASK.agentRunId
    );
    const view = projectComposerSessionFromThread(local, store.getState());
    assert.equal(
      view.phase,
      phase === 'failure'
        ? 'failed'
        : phase === 'ready'
          ? 'delivered'
          : 'running'
    );
    assert.equal(view.task?.taskId, TASK.taskId);
  }
});

test('reconnect with the same cursor does not double-apply a turn event', async () => {
  const store = createAgentEventStore();
  const accepted = wire({
    eventId: 'evt-accepted',
    streamOffset: '1',
    eventType: 'accepted',
  });
  const planning = wire({
    eventId: 'evt-planning',
    streamOffset: '2',
    eventType: 'planning',
  });
  const loadReplay: AgentReplayLoader = async () => ({
    session: session(),
    snapshot: {
      revision: '2',
      lastEventId: 'evt-planning',
      lastStreamOffset: '2',
    },
    events: [accepted, planning],
    recentTaskId: TASK.taskId,
  });

  await reconnectAgentWorkbench({ store, loadReplay, threadId: THREAD });
  const first = store.getState();
  assert.equal(first.turnPhase, 'planning');
  assert.equal(first.seenEventIds.size, 2);
  assert.equal(boundWorkbenchTaskId(first), TASK.taskId);

  await reconnectAgentWorkbench({ store, loadReplay, threadId: THREAD });
  const again = store.getState();
  assert.equal(again.turnPhase, 'planning');
  assert.equal(again.seenEventIds.size, 2);
  assert.equal(again.lastEventId, 'evt-planning');
  assert.equal(again.lastStreamOffset, '2');
  assert.equal(projectComposerThread(again).taskId, TASK.taskId);
});

test('after BFF disconnect recovery uses the same Task/Run phase as the server', async () => {
  const store = createAgentEventStore();
  await reconnectAgentWorkbench({
    store,
    threadId: THREAD,
    loadReplay: async () => ({
      session: session(),
      snapshot: {
        revision: '1',
        lastEventId: 'evt-accepted',
        lastStreamOffset: '1',
      },
      events: [
        wire({
          eventId: 'evt-accepted',
          streamOffset: '1',
          eventType: 'accepted',
        }),
      ],
      recentTaskId: TASK.taskId,
    }),
  });
  assert.equal(store.getState().turnPhase, 'accepted');
  assert.equal(store.getState().lastEventId, 'evt-accepted');

  const serverPhase: ThreadTurnPhase = 'planning';
  await reconnectAgentWorkbench({
    store,
    threadId: THREAD,
    loadReplay: async ({ clientLastEventId }) => {
      assert.equal(clientLastEventId, 'evt-accepted');
      return {
        session: session({
          sessionRevision: 2,
          activeRunId: 'run-1',
          current: { taskId: TASK.taskId, workId: TASK.workId },
        }),
        snapshot: {
          revision: '2',
          lastEventId: 'evt-planning',
          lastStreamOffset: '2',
        },
        events: [
          wire({
            eventId: 'evt-planning',
            streamOffset: '2',
            eventType: 'planning',
            payload: {
              taskId: TASK.taskId,
              runId: 'run-1',
              workId: TASK.workId,
              phase: serverPhase,
            },
          }),
        ],
        recentTaskId: TASK.taskId,
      };
    },
  });

  const recovered = store.getState();
  const adapter = projectComposerThread(recovered);
  assert.equal(recovered.turnPhase, serverPhase);
  assert.equal(adapter.turnPhase, serverPhase);
  assert.equal(adapter.taskId, TASK.taskId);
  assert.equal(adapter.runId, 'run-1');
  assert.equal(boundWorkbenchTaskId(recovered), TASK.taskId);
  assert.equal(recovered.session?.activeRunId, 'run-1');
});

test('server session current/recent recovers accepted Task/Run phase without a turn event', async () => {
  const store = createAgentEventStore();
  await reconnectAgentWorkbench({
    store,
    threadId: THREAD,
    loadReplay: async () => ({
      session: session(),
      snapshot: {
        revision: '0',
        lastEventId: null,
        lastStreamOffset: null,
      },
      events: [],
      recentTaskId: TASK.taskId,
    }),
  });
  const adapter = projectComposerThread(store.getState());
  assert.equal(adapter.turnPhase, 'accepted');
  assert.equal(adapter.taskId, TASK.taskId);
  assert.equal(adapter.runId, TASK.agentRunId);
});

test('composer adapter overlays store interrupts without mutating the local session', () => {
  const store = hydrateThread();
  const local = localComposer();
  const frozen = structuredClone(local);
  store.dispatch({
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-interrupt',
      streamOffset: '1',
      eventType: 'interrupt.requested',
      payload: {
        interruptId: 'composer-question:1',
        interruptType: 'answer_question',
        description: '请补充',
        revision: 1,
      },
    }),
  });
  const view = projectComposerSessionFromThread(local, store.getState());
  assert.deepEqual(local, frozen);
  assert.equal(view.phase, 'awaiting_answer');
  assert.ok(
    view.turns.some(
      (turn) =>
        turn.kind === 'question' && turn.questionId === 'composer-question:1'
    )
  );
});

test('adapter keeps a local derived task rebound instead of the parent Thread handle', () => {
  const store = hydrateThread();
  store.dispatch({
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-ready',
      streamOffset: '1',
      eventType: 'ready',
    }),
  });
  const derived = bindComposerTask(localComposer(), {
    taskId: 'task-derived',
    workId: 'work-derived',
    packageId: 'package-derived',
    agentThreadId: THREAD,
  });
  const view = projectComposerSessionFromThread(derived, store.getState());
  assert.equal(view.task?.taskId, 'task-derived');
  assert.equal(view.phase, 'running');
});

test('adapter is read-only: projecting the store does not mutate ComposerSession', () => {
  const store = hydrateThread();
  const local = localComposer();
  const frozen = structuredClone(local);
  store.dispatch({
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-ready',
      streamOffset: '1',
      eventType: 'ready',
    }),
  });
  const view = projectComposerSessionFromThread(local, store.getState());
  assert.deepEqual(local, frozen);
  assert.equal(view.phase, 'delivered');
  assert.notEqual(view.phase, local.phase);
  assert.equal(projectComposerThread.length, 1);
  assert.equal(projectComposerSessionFromThread.length, 2);
});

test('V31-105 §2 follow-up: a live `current` Work never rewinds a delivered session', () => {
  // Day-0 §37.4-A shape: the merchant already has the delivery, but the Work
  // row has not flipped to `completed` yet, so Core still reports it as the
  // Thread's `current`. Each replay poll rebuilds the projection from the
  // snapshot, so the delivery evidence is gone and `current` alone re-derives
  // `accepted` (agent-event-reducer.ts inferTurnPhase) and with it `running` —
  // which the overlay wrote back over the delivered session, leaving the
  // delivery card on screen while `data-delivered` stayed false.
  const store = hydrateThread();
  const local = localComposer();

  // The run delivers first.
  store.dispatch({
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-ready',
      streamOffset: '1',
      eventType: 'ready',
    }),
  });
  const delivered = projectComposerSessionFromThread(local, store.getState());
  assert.equal(delivered.phase, 'delivered');

  // Then a replay poll lands carrying a still-current Work for the same task.
  store.dispatch({
    type: 'hydrate_replay',
    session: session({ current: { taskId: TASK.taskId, workId: TASK.workId } }),
    snapshot: { revision: '1', lastEventId: null, lastStreamOffset: null },
    events: [],
    recentTaskId: TASK.taskId,
  });
  assert.equal(
    store.getState().turnPhase,
    'accepted',
    'the cold-start inference still reads a current Work as an accepted turn'
  );

  const afterReplay = projectComposerSessionFromThread(
    delivered,
    store.getState()
  );
  assert.equal(
    afterReplay.phase,
    'delivered',
    'a delivered session must not be dragged back to running'
  );
});
