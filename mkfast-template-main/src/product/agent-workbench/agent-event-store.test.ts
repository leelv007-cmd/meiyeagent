import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentSemanticEventWireSchema,
  type AgentSemanticEventWire,
} from '@meiye/contracts';

import { createAgentEventStore } from './agent-event-store';
import type {
  AgentWorkbenchAction,
  WorkbenchSessionProjection,
} from './agent-event-reducer';

const OCCURRED_AT = '2026-08-19T08:00:00.000Z';

function session(
  threadId: string,
  resourceId: string
): WorkbenchSessionProjection {
  return { resourceId, threadId, sessionRevision: 1 };
}

function event(input: {
  eventId: string;
  eventType: string;
  payload: unknown;
  streamOffset: string;
  threadId: string;
}): AgentSemanticEventWire {
  return agentSemanticEventWireSchema.parse({
    schemaVersion: 'agent-semantic-event/v1',
    contextRole: 'included',
    correlationId: 'corr-isolation',
    occurredAt: OCCURRED_AT,
    sourceDomain: 'agent_run',
    sourceEntityId: 'run-isolation',
    sourceRevision: '1',
    ...input,
  });
}

function projectEverySensitiveField(input: {
  accountId: string;
  threadId: string;
  workspaceId: string;
}) {
  const store = createAgentEventStore();
  store.dispatch({
    type: 'bind_identity',
    identity: input,
  } as AgentWorkbenchAction);
  store.dispatch({
    type: 'hydrate_replay',
    session: session(input.threadId, input.workspaceId),
    snapshot: {
      revision: '7',
      lastEventId: null,
      lastStreamOffset: null,
    },
    events: [
      event({
        eventId: `${input.threadId}-message`,
        eventType: 'message.final',
        payload: { text: `${input.threadId} only` },
        streamOffset: '1',
        threadId: input.threadId,
      }),
      event({
        eventId: `${input.threadId}-activity`,
        eventType: 'activity.snapshot',
        payload: {
          activityId: `${input.threadId}-activity`,
          status: 'running',
          title: '正在生成',
        },
        streamOffset: '2',
        threadId: input.threadId,
      }),
      event({
        eventId: `${input.threadId}-artifact`,
        eventType: 'artifact.revised',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: `${input.threadId}-artifact`,
          artifactType: 'note',
          revision: 1,
          status: 'skeleton',
          full: { pages: [{ pageIndex: 0, stage: 'skeleton' }] },
        },
        streamOffset: '3',
        threadId: input.threadId,
      }),
      event({
        eventId: `${input.threadId}-plan`,
        eventType: 'plan.created',
        payload: {
          planId: `${input.threadId}-plan`,
          revision: 1,
          goal: { summary: '门店活动' },
          deliverables: [{ kind: 'note', quantity: 1 }],
        },
        streamOffset: '4',
        threadId: input.threadId,
      }),
      event({
        eventId: `${input.threadId}-interrupt`,
        eventType: 'interrupt.requested',
        payload: {
          interruptId: `${input.threadId}-interrupt`,
          interruptType: 'execution_confirm',
          description: '请确认',
          revision: 1,
        },
        streamOffset: '5',
        threadId: input.threadId,
      }),
      event({
        eventId: `${input.threadId}-delivered`,
        eventType: 'work.delivered',
        payload: {
          deliveryKey: `${input.threadId}-delivery`,
          text: '交付完成',
        },
        streamOffset: '6',
        threadId: input.threadId,
      }),
    ],
  });
  return store;
}

function assertProjectionIsEmpty(
  state: ReturnType<ReturnType<typeof projectEverySensitiveField>['getState']>
) {
  assert.equal(state.session, null);
  assert.deepEqual(state.messages, []);
  assert.deepEqual(state.activities, {});
  assert.deepEqual(state.artifacts, {});
  assert.deepEqual(state.plans, {});
  assert.equal(state.activePlanId, null);
  assert.deepEqual(state.pendingInterrupts, []);
  assert.equal(state.deliveredKeys.size, 0);
  assert.equal(state.seenEventIds.size, 0);
  assert.equal(state.lastEventId, null);
  assert.equal(state.lastStreamOffset, null);
  assert.equal(state.snapshotRevision, null);
  assert.equal(state.turnPhase, null);
  assert.equal(state.turnRunId, null);
}

test('Thread A to B replaces the active projection before replaying only B', () => {
  const store = projectEverySensitiveField({
    accountId: 'account-a',
    threadId: 'thread-a',
    workspaceId: 'workspace-a',
  });
  assert.equal(store.getState().messages.length, 2);
  assert.equal(Object.keys(store.getState().activities).length, 1);
  assert.equal(Object.keys(store.getState().artifacts).length, 1);

  store.dispatch({
    type: 'bind_identity',
    identity: {
      accountId: 'account-a',
      threadId: 'thread-b',
      workspaceId: 'workspace-a',
    },
  } as AgentWorkbenchAction);

  assertProjectionIsEmpty(store.getState());
  assert.deepEqual(store.getState().identity, {
    accountId: 'account-a',
    threadId: 'thread-b',
    workspaceId: 'workspace-a',
  });

  store.dispatch({
    type: 'hydrate_replay',
    session: session('thread-b', 'workspace-a'),
    snapshot: {
      revision: '1',
      lastEventId: null,
      lastStreamOffset: null,
    },
    events: [
      event({
        eventId: 'thread-b-message',
        eventType: 'message.final',
        payload: { text: 'thread-b only' },
        streamOffset: '1',
        threadId: 'thread-b',
      }),
    ],
  });

  assert.deepEqual(
    store.getState().messages.map((message) => message.text),
    ['thread-b only']
  );
  assert.equal(store.getState().lastEventId, 'thread-b-message');
});

test('Thread to Idle clears every active projection and cursor', () => {
  const store = projectEverySensitiveField({
    accountId: 'account-a',
    threadId: 'thread-a',
    workspaceId: 'workspace-a',
  });

  store.dispatch({ type: 'set_session', session: null });

  assertProjectionIsEmpty(store.getState());
  assert.deepEqual(store.getState().identity, {
    accountId: 'account-a',
    threadId: null,
    workspaceId: 'workspace-a',
  });
});

test('account or workspace tuple change replaces the active store state', () => {
  const store = projectEverySensitiveField({
    accountId: 'account-a',
    threadId: 'thread-a',
    workspaceId: 'workspace-a',
  });

  store.dispatch({
    type: 'bind_identity',
    identity: {
      accountId: 'account-b',
      threadId: null,
      workspaceId: 'workspace-b',
    },
  } as AgentWorkbenchAction);

  assertProjectionIsEmpty(store.getState());
  assert.deepEqual(store.getState().identity, {
    accountId: 'account-b',
    threadId: null,
    workspaceId: 'workspace-b',
  });
});
