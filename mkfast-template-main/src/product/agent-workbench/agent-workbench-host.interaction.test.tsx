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

import { __resetAgentWorkbenchHostStoreForTests } from './agent-event-store';
import { AgentWorkbenchHost } from './agent-workbench';
import type { IdleGoalProactiveProjection } from './idle-goal-proactive';
import type { WorkbenchSessionResolveResponse } from './thread-session';

afterEach(() => {
  cleanup();
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
