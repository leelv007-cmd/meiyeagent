import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import {
  agentSemanticEventWireSchema,
  type AgentSemanticEventWire,
} from '@meiye/contracts';

import {
  createAgentEventStore,
  useAgentWorkbenchState,
} from '@/product/agent-workbench/agent-event-store';
import type { WorkbenchSessionProjection } from '@/product/agent-workbench/agent-event-reducer';

import {
  bindComposerTask,
  createComposerSession,
  openComposerTurn,
} from './composer-session';
import { useComposerDeliveryController } from './use-composer-delivery-controller';
import { readComposerThreadSession } from './use-composer-thread-controller';
import { ComposerWorkbenchHost } from './use-composer-workbench-controller';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/product/agent-workbench/agent-workbench', () => ({
  AgentWorkbenchHost: (props: {
    subscribeLive?: unknown;
    loadReplay?: unknown;
    explicitThreadId?: string | null;
  }) => (
    <div
      data-has-replay={typeof props.loadReplay}
      data-has-sse={typeof props.subscribeLive}
      data-testid="workbench-host"
      data-thread={props.explicitThreadId ?? ''}
    />
  ),
}));

vi.mock(
  '@/product/agent-workbench/publish-handoff/use-publish-handoff',
  () => ({
    usePublishHandoff: () => ({
      onPublishHandoffCopy: () => false,
      onPublishHandoffDownloadZip: async () => undefined,
      onPublishHandoffRecordPublished: async () => undefined,
      onSelfReportChip: async () => undefined,
      onSelfReportIgnore: async () => undefined,
      publishHandoffError: null,
      publishHandoffView: null,
      selfReportChips: undefined,
      selfReportPrompt: null,
    }),
  })
);

afterEach(() => {
  navigate.mockReset();
});

const THREAD = 'thread-07a-ui';
const TASK = {
  taskId: 'task-ui-07a',
  workId: 'work-ui-07a',
  packageId: 'package-ui-07a',
  agentThreadId: THREAD,
  agentRunId: 'run-ui-07a',
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
    correlationId: 'corr-ui-07a',
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

test('workbench and thread overlay observe one phase/task transition per event', () => {
  const store = createAgentEventStore();
  store.dispatch({
    type: 'hydrate_replay',
    session: session(),
    snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
    events: [],
    recentTaskId: TASK.taskId,
  });
  const local = bindComposerTask(
    openComposerTurn(createComposerSession('session-ui-07a'), '写一条周末预约'),
    TASK
  );
  function View() {
    const workbench = useAgentWorkbenchState(store);
    const thread = readComposerThreadSession(local, workbench);
    return (
      <div
        data-composer-phase={thread.session.phase}
        data-task={thread.thread.taskId ?? ''}
        data-testid="thread-controller-phase"
      >
        {thread.thread.turnPhase ?? ''}
      </div>
    );
  }
  render(<View />);

  act(() => {
    store.dispatch({
      type: 'apply_semantic_event',
      event: turnEvent('planning', 'evt-planning', '1'),
    });
  });

  expect(screen.getByTestId('thread-controller-phase')).toHaveTextContent(
    'planning'
  );
  expect(screen.getByTestId('thread-controller-phase')).toHaveAttribute(
    'data-task',
    TASK.taskId
  );
  expect(screen.getByTestId('thread-controller-phase')).toHaveAttribute(
    'data-composer-phase',
    'running'
  );
});

test('ComposerWorkbenchHost injects SSE subscribe so the caller cannot omit it', () => {
  render(
    <ComposerWorkbenchHost
      accountId="acct-1"
      explicitThreadId={THREAD}
      publishHandoff={{
        onPublishHandoffCopy: () => false,
        onPublishHandoffDownloadZip: async () => undefined,
        onPublishHandoffRecordPublished: async () => undefined,
        onSelfReportChip: async () => undefined,
        onSelfReportIgnore: async () => undefined,
        publishHandoffError: null,
        publishHandoffView: null,
        selfReportChips: undefined,
        selfReportPrompt: null,
      }}
      workspaceId="workspace-1"
    />
  );
  expect(screen.getByTestId('workbench-host')).toHaveAttribute(
    'data-has-sse',
    'function'
  );
  expect(screen.getByTestId('workbench-host')).toHaveAttribute(
    'data-has-replay',
    'function'
  );
  expect(screen.getByTestId('workbench-host')).toHaveAttribute(
    'data-thread',
    THREAD
  );
});

test('delivery controller navigates Result Center and does not write export', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
  const view = renderHook(
    () =>
      useComposerDeliveryController({
        accountId: 'acct-1',
        enabled: false,
        packageId: 'package-note',
        phase: 'delivered',
        workId: 'work-note',
        workspaceId: 'workspace-1',
      }),
    { wrapper }
  );

  act(() => {
    view.result.current.openDelivery({
      action: 'export',
      revision: {
        packageId: 'package-note',
        revision: 3,
        versionId: 'version-1',
      },
      taskId: 'task-note',
      workId: 'work-note',
    });
  });

  expect(navigate).toHaveBeenCalledWith({
    params: { workId: 'work-note' },
    replace: false,
    search: expect.objectContaining({
      contentId: 'package-note',
      panel: 'delivery',
      versionId: 'version-1',
    }),
    to: '/dashboard/results/$workId',
  });
});
