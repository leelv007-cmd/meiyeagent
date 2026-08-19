import {
  agentSemanticEventWireSchema,
  type AgentSemanticEventWire,
} from '@meiye/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import type { AgentEventStore } from '@/product/agent-workbench/agent-event-store';
import {
  createAgentEventStore,
  useAgentWorkbenchState,
} from '@/product/agent-workbench/agent-event-store';
import type { WorkbenchSessionProjection } from '@/product/agent-workbench/agent-event-reducer';

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

afterEach(() => {
  cleanup();
});

const THREAD = 'thread-arch02-ui';
const TASK = {
  taskId: 'task-ui-1',
  workId: 'work-ui-1',
  packageId: 'package-ui-1',
  agentThreadId: THREAD,
  agentRunId: 'run-ui-1',
};

function session(): WorkbenchSessionProjection {
  return {
    resourceId: 'workspace-ui',
    threadId: THREAD,
    sessionRevision: 1,
    activeRunId: TASK.agentRunId,
    recent: { taskId: TASK.taskId, workId: TASK.workId },
  };
}

function turnEvent(
  eventType: string,
  eventId: string,
  streamOffset: string
): AgentSemanticEventWire {
  return agentSemanticEventWireSchema.parse({
    schemaVersion: 'agent-semantic-event/v1',
    threadId: THREAD,
    contextRole: 'included',
    sourceDomain: 'agent_run',
    sourceEntityId: TASK.agentRunId,
    sourceRevision: '1',
    correlationId: 'corr-ui',
    payload: {
      taskId: TASK.taskId,
      runId: TASK.agentRunId,
      workId: TASK.workId,
    },
    occurredAt: '2026-08-20T08:00:00.000Z',
    eventId,
    streamOffset,
    eventType,
  });
}

function localComposer(): ComposerSession {
  return bindComposerTask(
    openComposerTurn(createComposerSession('session-ui'), '写一条周末预约'),
    TASK
  );
}

function WorkbenchSubscriber({ store }: { store: AgentEventStore }) {
  const state = useAgentWorkbenchState(store);
  return (
    <div data-task={state.recentTaskId ?? ''} data-testid="workbench-phase">
      {state.turnPhase ?? ''}
    </div>
  );
}

function ComposerAdapterSubscriber({
  store,
  local,
}: {
  store: AgentEventStore;
  local: ComposerSession;
}) {
  const state = useAgentWorkbenchState(store);
  const thread = projectComposerThread(state);
  const view = projectComposerSessionFromThread(local, state);
  return (
    <div
      data-composer-phase={view.phase}
      data-task={thread.taskId ?? ''}
      data-testid="composer-adapter-phase"
    >
      {thread.turnPhase ?? ''}
    </div>
  );
}

test('workbench and composer adapter subscribers observe one phase/task transition per event', () => {
  const store = createAgentEventStore();
  store.dispatch({
    type: 'hydrate_replay',
    session: session(),
    snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
    events: [],
    recentTaskId: TASK.taskId,
  });
  const local = localComposer();
  render(
    <>
      <WorkbenchSubscriber store={store} />
      <ComposerAdapterSubscriber local={local} store={store} />
    </>
  );

  act(() => {
    store.dispatch({
      type: 'apply_semantic_event',
      event: turnEvent('planning', 'evt-planning', '1'),
    });
  });

  expect(screen.getByTestId('workbench-phase')).toHaveTextContent('planning');
  expect(screen.getByTestId('composer-adapter-phase')).toHaveTextContent(
    'planning'
  );
  expect(screen.getByTestId('workbench-phase')).toHaveAttribute(
    'data-task',
    TASK.taskId
  );
  expect(screen.getByTestId('composer-adapter-phase')).toHaveAttribute(
    'data-task',
    TASK.taskId
  );
  expect(screen.getByTestId('composer-adapter-phase')).toHaveAttribute(
    'data-composer-phase',
    'running'
  );
});

test('store updates do not write the projection back into ComposerSession.setSession', () => {
  const store = createAgentEventStore();
  store.dispatch({
    type: 'hydrate_replay',
    session: session(),
    snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
    events: [],
    recentTaskId: TASK.taskId,
  });
  const setSession = vi.fn();

  function Host() {
    const [local, setLocal] = useState(localComposer);
    const writeThrough: typeof setLocal = (update) => {
      setSession(update);
      setLocal(update);
    };
    void writeThrough;
    const state = useAgentWorkbenchState(store);
    const view = projectComposerSessionFromThread(local, state);
    return (
      <div
        data-local-phase={local.phase}
        data-testid="adapter-host"
        data-view-phase={view.phase}
      />
    );
  }

  render(<Host />);
  act(() => {
    store.dispatch({
      type: 'apply_semantic_event',
      event: turnEvent('ready', 'evt-ready', '1'),
    });
  });

  expect(setSession).not.toHaveBeenCalled();
  expect(screen.getByTestId('adapter-host')).toHaveAttribute(
    'data-local-phase',
    'running'
  );
  expect(screen.getByTestId('adapter-host')).toHaveAttribute(
    'data-view-phase',
    'delivered'
  );
});
