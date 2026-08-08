/**
 * V31-24 Idle Goal + proactive panel behaviour (accept / dismiss / why-now).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  queryP1: vi.fn(),
  commandP1: vi.fn(),
}));

vi.mock('@/p1/client', () => ({
  queryP1: harness.queryP1,
  commandP1: harness.commandP1,
}));

const { IdleGoalProactivePanel } = await import('./idle-goal-proactive');

afterEach(() => {
  cleanup();
  harness.queryP1.mockReset();
  harness.commandP1.mockReset();
});

function renderPanel(
  props: Partial<React.ComponentProps<typeof IdleGoalProactivePanel>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <IdleGoalProactivePanel {...props} />
    </QueryClientProvider>
  );
}

describe('IdleGoalProactivePanel', () => {
  it('renders primary goal progress and why-now evidence on every suggestion', async () => {
    harness.queryP1.mockResolvedValue({
      primaryGoal: {
        goalId: 'goal-1',
        statement: '本月多接咨询',
        objective: 'inquiry',
        priority: 'high',
        status: 'active',
      },
      progress: {
        goalId: 'goal-1',
        deliveredWorkCount: 3,
        evidenceCount: 2,
        statement: '本月多接咨询',
      },
      gate: { open: true, reason: 'workspace_allowlist' },
      suggestions: [
        {
          candidateId: 'cand-1',
          reason: '素材已积累，适合跟进目标',
          evidenceRefs: [
            { kind: 'asset_accumulation', ref: 'asset-pack-1' },
            { kind: 'goal_stalled', ref: 'goal-1' },
          ],
          goalId: 'goal-1',
          status: 'proposed',
        },
      ],
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('idle-primary-goal-statement')).toHaveTextContent(
        '本月多接咨询'
      );
    });
    expect(screen.getByTestId('idle-primary-goal-progress')).toHaveTextContent(
      '已交付 3'
    );
    expect(screen.getByTestId('idle-suggestion-why-now')).toHaveTextContent(
      '为什么现在'
    );
    expect(screen.getByTestId('idle-suggestion-why-now')).toHaveTextContent(
      'asset_accumulation:asset-pack-1'
    );
  });

  it('accept uses candidateId idempotency key and surfaces thread turn', async () => {
    harness.queryP1.mockResolvedValue({
      primaryGoal: null,
      progress: null,
      gate: { open: true, reason: 'coverage_met' },
      suggestions: [
        {
          candidateId: 'cand-accept',
          reason: '活动临近',
          evidenceRefs: [{ kind: 'campaign_approaching', ref: 'camp-1' }],
          status: 'proposed',
        },
      ],
    });
    harness.commandP1.mockResolvedValue({
      threadId: 'thread-from-accept',
      runId: 'run-from-accept',
      paidSideEffect: false,
      replayed: false,
    });
    const onAccept = vi.fn();

    renderPanel({ onAccept });
    await waitFor(() => {
      expect(screen.getByTestId('idle-suggestion-accept')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('idle-suggestion-accept'));

    await waitFor(() => {
      expect(harness.commandP1).toHaveBeenCalled();
    });
    const [module, body, key] = harness.commandP1.mock.calls[0]!;
    expect(module).toBe('goal-proactive');
    expect(body.action).toBe('accept_opportunity');
    expect(body.payload.candidateId).toBe('cand-accept');
    expect(key).toBe('accept-opportunity:cand-accept');
    expect(onAccept).toHaveBeenCalledWith({
      candidateId: 'cand-accept',
      threadId: 'thread-from-accept',
      runId: 'run-from-accept',
    });
  });

  it('dismiss posts dismiss_opportunity and clears after invalidate', async () => {
    harness.queryP1
      .mockResolvedValueOnce({
        primaryGoal: null,
        progress: null,
        gate: { open: true, reason: 'workspace_allowlist' },
        suggestions: [
          {
            candidateId: 'cand-dismiss',
            reason: '可忽略建议',
            evidenceRefs: [{ kind: 'merchant_hot_topic', ref: 'topic-1' }],
            status: 'proposed',
          },
        ],
      })
      .mockResolvedValueOnce({
        primaryGoal: null,
        progress: null,
        gate: { open: true, reason: 'workspace_allowlist' },
        suggestions: [],
      });
    harness.commandP1.mockResolvedValue({
      decision: { decision: 'dismissed' },
      replayed: false,
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('idle-suggestion-dismiss')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('idle-suggestion-dismiss'));

    await waitFor(() => {
      expect(harness.commandP1).toHaveBeenCalledWith(
        'goal-proactive',
        {
          action: 'dismiss_opportunity',
          payload: { candidateId: 'cand-dismiss' },
        },
        'dismiss-opportunity:cand-dismiss'
      );
    });
  });
});
