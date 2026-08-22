/**
 * V31-05 Thread-root host: explicit threadId restore vs Idle projection.
 * V31-24: Idle primary goal + proactive suggestions on Idle first screen.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  agentSemanticEventWireSchema,
  interruptPayloadSchema,
} from '@meiye/contracts';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetAgentWorkbenchHostStoreForTests,
  getAgentWorkbenchHostStore,
} from './agent-event-store';
import { AgentWorkbenchHost } from './agent-workbench';
import type { IdleGoalProactiveProjection } from './idle-goal-proactive';
import type { WorkbenchSessionResolveResponse } from './thread-session';

/**
 * Seam for the one case that needs to watch the receipt read leave the host.
 * With no implementation set the real client runs, so every other case in this
 * file keeps its current behaviour.
 */
const p1Client = vi.hoisted(() => ({
  queryP1:
    vi.fn<
      (
        module: string,
        call: { action: string; payload?: Record<string, unknown> },
        signal?: AbortSignal
      ) => Promise<unknown> | undefined
    >(),
}));

vi.mock('@/p1/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/p1/client')>();
  const queryP1 = ((
    module: Parameters<typeof actual.queryP1>[0],
    call: Parameters<typeof actual.queryP1>[1],
    signal?: AbortSignal
  ) =>
    p1Client.queryP1(module, call, signal) ??
    actual.queryP1(module, call, signal)) as typeof actual.queryP1;
  return { ...actual, queryP1 };
});

afterEach(() => {
  cleanup();
  p1Client.queryP1.mockReset();
  __resetAgentWorkbenchHostStoreForTests();
});

function renderWithQuery(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

describe('AgentWorkbenchHost Thread-root restore', () => {
  it('clears Thread A before restoring Thread B into the same active store', async () => {
    let releaseThreadB: (() => void) | undefined;
    const threadBReady = new Promise<void>((resolve) => {
      releaseThreadB = resolve;
    });
    const loadSession = vi.fn(async ({ explicitThreadId }) => ({
      resolveSource: 'explicit_thread' as const,
      session: {
        resourceId: 'workspace-a',
        threadId: explicitThreadId ?? 'thread-a',
        sessionRevision: 1,
      },
    }));
    const loadReplay = vi.fn(async ({ threadId }) => {
      if (threadId === 'thread-b') await threadBReady;
      return {
        session: {
          resourceId: 'workspace-a',
          threadId: threadId ?? 'thread-a',
          sessionRevision: 1,
        },
        snapshot: {
          revision: '1',
          lastEventId: null,
          lastStreamOffset: null,
        },
        events: [
          agentSemanticEventWireSchema.parse({
            schemaVersion: 'agent-semantic-event/v1',
            threadId: threadId ?? 'thread-a',
            contextRole: 'included',
            sourceDomain: 'agent_run',
            sourceEntityId: `run-${threadId ?? 'thread-a'}`,
            sourceRevision: '1',
            correlationId: 'corr-thread-switch',
            payload: {
              text: threadId === 'thread-b' ? 'B 会话内容' : 'A 会话内容',
            },
            occurredAt: '2026-08-19T08:00:00.000Z',
            eventId: `event-${threadId ?? 'thread-a'}`,
            streamOffset: '1',
            eventType: 'message.final',
          }),
        ],
      };
    });
    const view = render(
      <AgentWorkbenchHost
        accountId="account-a"
        enableIdleGoalProactive={false}
        explicitThreadId="thread-a"
        loadPendingInterrupts={async () => []}
        loadReplay={loadReplay}
        loadSession={loadSession}
        workspaceId="workspace-a"
      />
    );
    expect(await screen.findByText('A 会话内容')).toBeInTheDocument();

    view.rerender(
      <AgentWorkbenchHost
        accountId="account-a"
        enableIdleGoalProactive={false}
        explicitThreadId="thread-b"
        loadPendingInterrupts={async () => []}
        loadReplay={loadReplay}
        loadSession={loadSession}
        workspaceId="workspace-a"
      />
    );

    expect(screen.queryByText('A 会话内容')).toBeNull();
    releaseThreadB?.();
    expect(await screen.findByText('B 会话内容')).toBeInTheDocument();
  });

  it('clears the active Thread projection when restore resolves to Idle', async () => {
    const view = render(
      <AgentWorkbenchHost
        accountId="account-a"
        enableIdleGoalProactive={false}
        explicitThreadId="thread-a"
        loadPendingInterrupts={async () => []}
        loadReplay={async () => ({
          session: {
            resourceId: 'workspace-a',
            threadId: 'thread-a',
            sessionRevision: 1,
          },
          snapshot: {
            revision: '1',
            lastEventId: null,
            lastStreamOffset: null,
          },
          events: [
            agentSemanticEventWireSchema.parse({
              schemaVersion: 'agent-semantic-event/v1',
              threadId: 'thread-a',
              contextRole: 'included',
              sourceDomain: 'agent_run',
              sourceEntityId: 'run-a',
              sourceRevision: '1',
              correlationId: 'corr-idle',
              payload: { text: '只属于活动会话' },
              occurredAt: '2026-08-19T08:00:00.000Z',
              eventId: 'event-a',
              streamOffset: '1',
              eventType: 'message.final',
            }),
          ],
        })}
        loadSession={async ({ explicitThreadId }) =>
          explicitThreadId
            ? {
                resolveSource: 'explicit_thread',
                session: {
                  resourceId: 'workspace-a',
                  threadId: explicitThreadId,
                  sessionRevision: 1,
                },
              }
            : { resolveSource: 'idle', session: null }
        }
        workspaceId="workspace-a"
      />
    );
    expect(await screen.findByText('只属于活动会话')).toBeInTheDocument();

    view.rerender(
      <AgentWorkbenchHost
        accountId="account-a"
        enableIdleGoalProactive={false}
        explicitThreadId={null}
        loadPendingInterrupts={async () => []}
        loadSession={async () => ({ resolveSource: 'idle', session: null })}
        workspaceId="workspace-a"
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
        'data-workbench-root',
        'idle'
      )
    );
    expect(screen.queryByText('只属于活动会话')).toBeNull();
  });

  it('replaces and restores when the account/workspace tuple changes', async () => {
    let activeWorkspace = 'workspace-a';
    const loadSession = vi.fn(async ({ explicitThreadId }) => ({
      resolveSource: 'explicit_thread' as const,
      session: {
        resourceId: activeWorkspace,
        threadId: explicitThreadId ?? 'thread-shared',
        sessionRevision: 1,
      },
    }));
    const loadReplay = vi.fn(async ({ threadId }) => ({
      session: {
        resourceId: activeWorkspace,
        threadId: threadId ?? 'thread-shared',
        sessionRevision: 1,
      },
      snapshot: {
        revision: '1',
        lastEventId: null,
        lastStreamOffset: null,
      },
      events: [
        agentSemanticEventWireSchema.parse({
          schemaVersion: 'agent-semantic-event/v1',
          threadId: threadId ?? 'thread-shared',
          contextRole: 'included',
          sourceDomain: 'agent_run',
          sourceEntityId: `run-${activeWorkspace}`,
          sourceRevision: '1',
          correlationId: 'corr-account-switch',
          payload: { text: `${activeWorkspace} 会话` },
          occurredAt: '2026-08-19T08:00:00.000Z',
          eventId: `event-${activeWorkspace}`,
          streamOffset: '1',
          eventType: 'message.final',
        }),
      ],
    }));
    const view = render(
      <AgentWorkbenchHost
        accountId="account-a"
        enableIdleGoalProactive={false}
        explicitThreadId="thread-shared"
        loadPendingInterrupts={async () => []}
        loadReplay={loadReplay}
        loadSession={loadSession}
        workspaceId="workspace-a"
      />
    );
    expect(await screen.findByText('workspace-a 会话')).toBeInTheDocument();

    activeWorkspace = 'workspace-b';
    view.rerender(
      <AgentWorkbenchHost
        accountId="account-b"
        enableIdleGoalProactive={false}
        explicitThreadId="thread-shared"
        loadPendingInterrupts={async () => []}
        loadReplay={loadReplay}
        loadSession={loadSession}
        workspaceId="workspace-b"
      />
    );

    expect(screen.queryByText('workspace-a 会话')).toBeNull();
    expect(await screen.findByText('workspace-b 会话')).toBeInTheDocument();
    expect(loadSession).toHaveBeenCalledTimes(2);
  });

  it('reloads pending interrupts for the resolved auto-resume Thread', async () => {
    let releaseInitialPending:
      | ((value: ReturnType<typeof interruptPayloadSchema.parse>[]) => void)
      | undefined;
    const initialPending = new Promise<
      ReturnType<typeof interruptPayloadSchema.parse>[]
    >((resolve) => {
      releaseInitialPending = resolve;
    });
    let releaseResolvedPending:
      | ((value: ReturnType<typeof interruptPayloadSchema.parse>[]) => void)
      | undefined;
    const resolvedPending = new Promise<
      ReturnType<typeof interruptPayloadSchema.parse>[]
    >((resolve) => {
      releaseResolvedPending = resolve;
    });
    const resumedInterrupt = interruptPayloadSchema.parse({
      schemaVersion: 'interrupt-payload/v1',
      interruptId: 'interrupt-thread-a',
      threadId: 'thread-a',
      runId: 'run-a',
      workflowId: 'workflow-a',
      step: 'context_injection',
      revision: 1,
      action: 'answer_question',
      args: {},
      config: {
        allowAccept: true,
        allowEdit: false,
        allowReject: true,
        allowRespond: false,
      },
      description: 'A 会话待确认',
      resourceId: 'workspace-a',
    });
    const staleInterrupt = interruptPayloadSchema.parse({
      ...resumedInterrupt,
      interruptId: 'interrupt-stale',
      description: '无 Thread 首次查询的旧结果',
    });
    const loadPendingInterrupts = vi
      .fn()
      .mockImplementationOnce(() => initialPending)
      .mockImplementationOnce(() => resolvedPending)
      .mockResolvedValue([resumedInterrupt]);

    render(
      <AgentWorkbenchHost
        accountId="account-a"
        enableIdleGoalProactive={false}
        loadPendingInterrupts={loadPendingInterrupts}
        loadReplay={async () => ({
          session: {
            resourceId: 'workspace-a',
            threadId: 'thread-a',
            sessionRevision: 1,
          },
          snapshot: {
            revision: '1',
            lastEventId: null,
            lastStreamOffset: null,
          },
          events: [],
        })}
        loadSession={async () => ({
          resolveSource: 'recent_thread',
          session: {
            resourceId: 'workspace-a',
            threadId: 'thread-a',
            sessionRevision: 1,
          },
        })}
        subscribeLive={async ({ signal }) =>
          new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true })
          )
        }
        workspaceId="workspace-a"
      />
    );

    await waitFor(() => expect(loadPendingInterrupts).toHaveBeenCalledTimes(2));
    expect(loadPendingInterrupts.mock.calls[0]?.[0]).toEqual(
      expect.not.objectContaining({ threadId: expect.anything() })
    );
    expect(loadPendingInterrupts.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ threadId: 'thread-a' })
    );
    expect(getAgentWorkbenchHostStore().getState().identity).toEqual({
      accountId: 'account-a',
      workspaceId: 'workspace-a',
      threadId: 'thread-a',
    });
    releaseResolvedPending?.([resumedInterrupt]);
    await waitFor(() =>
      expect(
        getAgentWorkbenchHostStore().getState().pendingInterrupts
      ).toHaveLength(1)
    );
    expect(await screen.findByText('A 会话待确认')).toBeInTheDocument();

    releaseInitialPending?.([staleInterrupt]);
    await waitFor(() =>
      expect(screen.queryByText('无 Thread 首次查询的旧结果')).toBeNull()
    );
    expect(screen.getByText('A 会话待确认')).toBeInTheDocument();
  });

  it('shows a pending-interrupt load error even when no rows can be rendered', async () => {
    render(
      <AgentWorkbenchHost
        enableIdleGoalProactive={false}
        enableSessionRestore={false}
        loadPendingInterrupts={async () => {
          throw new Error('待处理确认格式无效，请刷新后重试。');
        }}
      />
    );

    expect(
      await screen.findByTestId('agent-interrupt-error')
    ).toHaveTextContent('待处理确认格式无效，请刷新后重试。');
    expect(screen.queryByTestId('agent-pending-interrupt')).toBeNull();
  });

  it('loads a refresh-safe typed interrupt and resumes the exact id/revision', async () => {
    let pending = [
      interruptPayloadSchema.parse({
        schemaVersion: 'interrupt-payload/v1' as const,
        interruptId: 'interrupt-live-1',
        threadId: 'thread-live',
        runId: 'run-live',
        workflowId: 'workflow-live',
        step: 'context_injection',
        revision: 7,
        action: 'answer_question',
        args: {},
        config: {
          allowAccept: true,
          allowEdit: false,
          allowReject: true,
          allowRespond: false,
        },
        description: '价格已变化，请确认后继续。',
        resourceId: 'ws-live',
      }),
    ];
    const loadPendingInterrupts = vi.fn(async () => pending);
    const resumeInterrupt = vi.fn(async ({ interrupt }) => {
      expect(interrupt.interruptId).toBe('interrupt-live-1');
      expect(interrupt.revision).toBe(7);
      pending = [];
      return { outcome: 'applied' };
    });
    render(
      <AgentWorkbenchHost
        enableIdleGoalProactive={false}
        enableSessionRestore={false}
        loadPendingInterrupts={loadPendingInterrupts}
        resumeInterrupt={resumeInterrupt}
      />
    );

    const row = await screen.findByTestId('agent-pending-interrupt');
    expect(row).toHaveAttribute('data-interrupt-id', 'interrupt-live-1');
    expect(row).toHaveAttribute('data-interrupt-revision', '7');
    fireEvent.click(screen.getByTestId('agent-interrupt-accept'));
    await waitFor(() => expect(resumeInterrupt).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByTestId('agent-pending-interrupt')).toBeNull()
    );
  });

  it('resumes the authenticated live seam from replay cursors and applies plan events', async () => {
    const subscribeLive = vi.fn(async (input) => {
      await input.onEvent(
        agentSemanticEventWireSchema.parse({
          schemaVersion: 'agent-semantic-event/v1',
          threadId: 'thread-live',
          contextRole: 'included',
          sourceDomain: 'marketing_plan',
          sourceEntityId: 'plan-live',
          sourceRevision: '1',
          correlationId: 'run-live',
          payload: {
            planId: 'plan-live',
            revision: 1,
            goal: { summary: '实时计划' },
            deliverables: [{ kind: 'note', quantity: 4 }],
          },
          occurredAt: '2026-08-09T08:00:00.000Z',
          eventId: 'event-plan-live',
          streamOffset: '8',
          eventType: 'plan.created',
        })
      );
      await new Promise<void>((resolve) =>
        input.signal.addEventListener('abort', () => resolve(), { once: true })
      );
    });

    render(
      <AgentWorkbenchHost
        enableIdleGoalProactive={false}
        explicitThreadId="thread-live"
        loadSession={async () => ({
          resolveSource: 'explicit_thread',
          session: {
            resourceId: 'ws-live',
            threadId: 'thread-live',
            sessionRevision: 2,
          },
        })}
        loadReplay={async () => ({
          session: {
            resourceId: 'ws-live',
            threadId: 'thread-live',
            sessionRevision: 2,
          },
          snapshot: {
            revision: '7',
            lastEventId: 'event-7',
            lastStreamOffset: '7',
          },
          events: [],
        })}
        subscribeLive={subscribeLive}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-living-plan')).toHaveAttribute(
        'data-plan-id',
        'plan-live'
      );
    });
    expect(subscribeLive).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-live',
        lastEventId: 'event-7',
        lastStreamOffset: '7',
      })
    );
  });

  it('restores explicit threadId into host session projection', async () => {
    const loadSession = vi.fn(
      async (): Promise<WorkbenchSessionResolveResponse> => ({
        resolveSource: 'explicit_thread',
        session: {
          resourceId: 'ws-1',
          threadId: 'thread-explicit',
          sessionRevision: 3,
          title: '显式会话',
          activeRunId: 'run-1',
        },
      })
    );

    render(
      <AgentWorkbenchHost
        enableIdleGoalProactive={false}
        enableSessionRestore
        explicitThreadId="thread-explicit"
        loadSession={loadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
        'data-workbench-root',
        'thread'
      );
    });
    expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-thread-id',
      'thread-explicit'
    );
    expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-resolve-source',
      'explicit_thread'
    );
    expect(loadSession).toHaveBeenCalledWith({
      explicitThreadId: 'thread-explicit',
    });
  });

  it('MEM-02: ?threadId=T binds receipt/experience of task A, not Recent B', async () => {
    renderWithQuery(
      <AgentWorkbenchHost
        enableIdleGoalProactive={false}
        explicitTaskId={null}
        explicitThreadId="thread-t"
        loadPendingInterrupts={async () => []}
        loadReplay={async () => ({
          recentTaskId: 'task-a',
          session: {
            resourceId: 'workspace-a',
            threadId: 'thread-t',
            sessionRevision: 1,
            recent: { taskId: 'task-a', workId: 'work-a' },
          },
          snapshot: {
            revision: '1',
            lastEventId: null,
            lastStreamOffset: null,
          },
          events: [],
        })}
        loadSession={async () => ({
          resolveSource: 'explicit_thread',
          session: {
            resourceId: 'workspace-a',
            threadId: 'thread-t',
            sessionRevision: 1,
            recent: { taskId: 'task-a', workId: 'work-a' },
          },
        })}
        workspaceId="workspace-a"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
        'data-task-id',
        'task-a'
      );
    });
    expect(screen.getByTestId('this-run-experience')).toHaveAttribute(
      'data-task-id',
      'task-a'
    );
    expect(screen.queryByTestId('this-run-experience-empty')).toBeNull();
    expect(getAgentWorkbenchHostStore().getState().recentTaskId).toBe('task-a');
    expect(getAgentWorkbenchHostStore().getState().explicitTaskId).toBeNull();
  });

  it('MEM-02: a Thread with no task shows honest empty experience', async () => {
    renderWithQuery(
      <AgentWorkbenchHost
        enableIdleGoalProactive={false}
        explicitTaskId={null}
        explicitThreadId="thread-empty"
        loadPendingInterrupts={async () => []}
        loadReplay={async () => ({
          recentTaskId: null,
          session: {
            resourceId: 'workspace-a',
            threadId: 'thread-empty',
            sessionRevision: 1,
          },
          snapshot: {
            revision: '0',
            lastEventId: null,
            lastStreamOffset: null,
          },
          events: [],
        })}
        loadSession={async () => ({
          resolveSource: 'explicit_thread',
          session: {
            resourceId: 'workspace-a',
            threadId: 'thread-empty',
            sessionRevision: 1,
          },
        })}
        workspaceId="workspace-a"
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('this-run-experience-empty')
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-task-id',
      ''
    );
    expect(screen.getByTestId('this-run-experience')).toHaveAttribute(
      'data-task-id',
      ''
    );
  });

  it('MEM-02: explicit taskId still wins over thread recentTaskId', async () => {
    renderWithQuery(
      <AgentWorkbenchHost
        enableIdleGoalProactive={false}
        explicitTaskId="task-explicit"
        explicitThreadId="thread-t"
        loadPendingInterrupts={async () => []}
        loadReplay={async () => ({
          recentTaskId: 'task-from-recent-list',
          session: {
            resourceId: 'workspace-a',
            threadId: 'thread-t',
            sessionRevision: 1,
            recent: { taskId: 'task-from-recent-list' },
          },
          snapshot: {
            revision: '0',
            lastEventId: null,
            lastStreamOffset: null,
          },
          events: [],
        })}
        loadSession={async () => ({
          resolveSource: 'explicit_thread',
          session: {
            resourceId: 'workspace-a',
            threadId: 'thread-t',
            sessionRevision: 1,
            recent: { taskId: 'task-from-recent-list' },
          },
        })}
        workspaceId="workspace-a"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
        'data-task-id',
        'task-explicit'
      );
    });
    expect(screen.getByTestId('this-run-experience')).toHaveAttribute(
      'data-task-id',
      'task-explicit'
    );
  });

  /**
   * Regression: production identity arrives asynchronously (Better Auth
   * accountId, then workspaceId), so the host re-binds identity after the
   * first paint. `bind_identity` empties the projection for the new identity,
   * and the prop -> store effect does not re-run while `?taskId=` is
   * unchanged, so the URL task used to be dropped on that flip and the receipt
   * panel fell back to the Thread's (here: absent) recent task.
   */
  it('MEM-02: explicit taskId survives an account/workspace identity flip', async () => {
    p1Client.queryP1.mockImplementation((module, call) => {
      if (module === 'memory' && call.action === 'injection_receipt') {
        return Promise.resolve({
          receipt: {
            schemaVersion: 'memory-injection-receipt/v1',
            taskId: String(call.payload?.taskId ?? ''),
            runId: 'run-explicit',
            harnessReleaseId: 'release-1',
            entries: [
              {
                memoryId: 'pref-inject',
                statement: '文案要克制',
                revision: 1,
                currentStatus: 'confirmed',
                source: {
                  preview: '以后每次文案都少一点强促销感',
                  observedAt: '2026-08-08T09:00:00.000Z',
                  deleted: false,
                },
              },
            ],
            injectedAt: '2026-08-08T10:00:00.000Z',
          },
        });
      }
      return Promise.reject(
        new Error(`unexpected p1 query: ${module}.${call.action}`)
      );
    });
    // The Thread itself carries no task: the receipt can only be bound by the
    // explicit `?taskId=`, never by recent-task recovery.
    const loadSession = vi.fn(async () => ({
      resolveSource: 'explicit_thread' as const,
      session: {
        resourceId: 'workspace-a',
        threadId: 'thread-t',
        sessionRevision: 1,
      },
    }));
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const hostAt = (accountId: string | null, workspaceId: string | null) => (
      <QueryClientProvider client={client}>
        <AgentWorkbenchHost
          accountId={accountId}
          enableIdleGoalProactive={false}
          explicitTaskId="task-explicit"
          explicitThreadId="thread-t"
          loadPendingInterrupts={async () => []}
          loadSession={loadSession}
          workspaceId={workspaceId}
        />
      </QueryClientProvider>
    );

    // First paint: session not resolved yet, identity is (null, null, thread).
    const view = render(hostAt(null, null));
    await waitFor(() => {
      expect(
        screen.getByTestId('memory-injection-receipt-panel')
      ).toHaveAttribute('data-task-id', 'task-explicit');
    });

    // Auth + workspace land: identity flips, the store re-binds.
    view.rerender(hostAt('account-a', 'workspace-a'));
    await waitFor(() => {
      expect(loadSession).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-task-id',
      'task-explicit'
    );
    expect(screen.getByTestId('this-run-experience')).toHaveAttribute(
      'data-task-id',
      'task-explicit'
    );
    expect(screen.queryByTestId('this-run-experience-empty')).toBeNull();
    expect(getAgentWorkbenchHostStore().getState().explicitTaskId).toBe(
      'task-explicit'
    );
    expect(
      screen.getByTestId('memory-injection-receipt-panel')
    ).toHaveAttribute('data-task-id', 'task-explicit');
    expect(p1Client.queryP1).toHaveBeenCalledWith(
      'memory',
      { action: 'injection_receipt', payload: { taskId: 'task-explicit' } },
      expect.anything()
    );
    for (const [, call] of p1Client.queryP1.mock.calls) {
      expect(call.payload?.taskId ?? 'task-explicit').toBe('task-explicit');
    }
  });

  it('enters Idle when projection returns null session', async () => {
    const loadSession = vi.fn(
      async (): Promise<WorkbenchSessionResolveResponse> => ({
        resolveSource: 'idle',
        session: null,
      })
    );

    render(
      <AgentWorkbenchHost
        enableIdleGoalProactive={false}
        enableSessionRestore
        loadSession={loadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
        'data-workbench-root',
        'idle'
      );
    });
    expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-thread-id',
      ''
    );
    expect(loadSession).toHaveBeenCalledWith({ explicitThreadId: null });
  });

  it('keeps processSlot as Work inline projection under Thread-root', async () => {
    render(
      <AgentWorkbenchHost
        enableIdleGoalProactive={false}
        enableSessionRestore={false}
        processSlot={
          <div data-testid="work-inline-projection">work stream</div>
        }
      />
    );

    expect(screen.getByTestId('work-inline-projection')).toBeInTheDocument();
    expect(screen.getByTestId('agent-workstream-process')).toBeInTheDocument();
  });

  it('Idle first screen shows primary goal and why-now suggestions (V31-24)', async () => {
    const loadSession = vi.fn(
      async (): Promise<WorkbenchSessionResolveResponse> => ({
        resolveSource: 'idle',
        session: null,
      })
    );
    const loadIdleGoalProactive = vi.fn(
      async (): Promise<IdleGoalProactiveProjection> => ({
        primaryGoal: {
          goalId: 'goal-1',
          statement: '8 月头皮护理新客',
          objective: 'inquiry',
          priority: 'high',
          status: 'active',
        },
        progress: {
          goalId: 'goal-1',
          deliveredWorkCount: 2,
          evidenceCount: 1,
          statement: '8 月头皮护理新客',
        },
        gate: { open: true, reason: 'workspace_allowlist' },
        suggestions: [
          {
            candidateId: 'cand-1',
            reason: '目标两周未推进，素材已积累',
            evidenceRefs: [{ kind: 'goal_stalled', ref: 'goal-1' }],
            goalId: 'goal-1',
            status: 'proposed',
          },
        ],
      })
    );
    const onAccept = vi.fn();

    // commandP1 is only needed for accept — inject via panel mutation mock path:
    // IdleGoalProactivePanel calls commandP1; stub with vi.mock would need module
    // hoist. Here we only assert render + why-now copy on Idle mount.
    renderWithQuery(
      <AgentWorkbenchHost
        enableIdleGoalProactive
        enableSessionRestore
        loadIdleGoalProactive={loadIdleGoalProactive}
        loadSession={loadSession}
        onAcceptProactiveSuggestion={onAccept}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('idle-goal-proactive')).toHaveAttribute(
        'data-state',
        'ready'
      );
    });
    expect(screen.getByTestId('idle-primary-goal-statement')).toHaveTextContent(
      '8 月头皮护理新客'
    );
    expect(screen.getByTestId('idle-suggestion-why-now')).toHaveTextContent(
      '为什么现在'
    );
    expect(screen.getByTestId('idle-suggestion-why-now')).toHaveTextContent(
      'goal_stalled:goal-1'
    );
    expect(loadIdleGoalProactive).toHaveBeenCalled();
  });

  it('Idle gate closed shows empty proactive surface without suggestions', async () => {
    renderWithQuery(
      <AgentWorkbenchHost
        enableIdleGoalProactive
        enableSessionRestore
        loadIdleGoalProactive={async () => ({
          primaryGoal: null,
          progress: null,
          gate: { open: false, reason: 'threshold_unset' },
          suggestions: [],
        })}
        loadSession={async () => ({
          resolveSource: 'idle',
          session: null,
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('idle-goal-proactive')).toHaveAttribute(
        'data-state',
        'empty'
      );
    });
    expect(screen.getByTestId('idle-goal-proactive')).toHaveAttribute(
      'data-gate-reason',
      'threshold_unset'
    );
    expect(screen.queryByTestId('idle-proactive-suggestions')).toBeNull();
  });
});
