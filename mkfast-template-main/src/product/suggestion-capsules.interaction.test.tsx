/**
 * Idle light capsules — expand 今日建议 mini card + C3 prefill-only (#318).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  readDashboardHomeRecommendation: vi.fn(),
  operationsQuery: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/product/dashboard-home-recommendation', () => ({
  readDashboardHomeRecommendation: harness.readDashboardHomeRecommendation,
}));
vi.mock('@/p1/client', () => ({
  operationsQuery: harness.operationsQuery,
  queryP1: harness.queryP1,
}));

const { TodayRecommendationCard } = await import('./today-recommendation-card');

function renderCard(onUse = vi.fn(), onStart = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    onUse,
    onStart,
    ...render(
      <QueryClientProvider client={client}>
        <TodayRecommendationCard
          onStart={onStart}
          onUse={onUse}
          workspaceId="ws-1"
        />
      </QueryClientProvider>
    ),
  };
}

function emptyWorkbench() {
  return {
    assets: [],
    contents: [],
    events: [],
    jobs: [],
    works: [],
  };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('suggestion capsules', () => {
  it('renders light capsules (not the heavy entry card) with XHS recipes on first screen', async () => {
    harness.readDashboardHomeRecommendation.mockResolvedValue({
      workspaceId: 'ws-1',
      currentFactsRevision: 1,
      recommendation: null,
      stale: false,
    });
    harness.operationsQuery.mockResolvedValue(emptyWorkbench());

    renderCard();

    const root = await screen.findByTestId('today-recommendation');
    expect(root).toHaveAttribute('data-suggestion-capsules', 'true');
    expect(root.className).not.toMatch(/meiye-entry-card/u);
    expect(screen.getByTestId('suggestion-capsule-row')).toBeInTheDocument();
    expect(
      screen.getByTestId('suggestion-chip-xhs_image_text')
    ).toHaveTextContent('小红书图文');
    expect(screen.getByTestId('suggestion-chip-viral_adapt')).toHaveTextContent(
      '爆款复刻'
    );
  });

  it('C3: recipe chips only prefill via onUse — never call onStart/submit', async () => {
    const user = userEvent.setup();
    harness.readDashboardHomeRecommendation.mockResolvedValue({
      workspaceId: 'ws-1',
      currentFactsRevision: 1,
      recommendation: null,
      stale: false,
    });
    harness.operationsQuery.mockResolvedValue(emptyWorkbench());

    const onSubmit = vi.fn();
    const { onUse, onStart } = renderCard();

    await user.click(
      await screen.findByTestId('suggestion-chip-xhs_image_text')
    );
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse.mock.calls[0]?.[0]).toEqual({
      intent: expect.stringMatching(/小红书图文/u),
      outputHint: 'image_text',
      recipeChipId: 'xhs_image_text',
    });
    expect(onStart).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('suggestion-chip-viral_adapt'));
    expect(onUse).toHaveBeenCalledTimes(2);
    expect(onUse.mock.calls[1]?.[0].intent).toMatch(/复刻|粘贴/u);
    expect(onUse.mock.calls[1]?.[0].recipeChipId).toBe('viral_adapt');
    expect(onStart).not.toHaveBeenCalled();
  });

  it('cold vs pending chip labels stay honest and keep start CTA', async () => {
    const user = userEvent.setup();
    harness.readDashboardHomeRecommendation.mockResolvedValue({
      workspaceId: 'ws-1',
      currentFactsRevision: 0,
      recommendation: null,
      stale: false,
    });
    harness.operationsQuery.mockResolvedValue(emptyWorkbench());

    const { onStart, rerender } = renderCard();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId('today-recommendation')).toHaveAttribute(
        'data-recommendation-state',
        'cold'
      );
    });
    expect(screen.getByTestId('suggestion-chip-today')).toHaveTextContent(
      /还没有基于本店事实的推荐/u
    );
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: '还没有基于本店事实的推荐',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '开始下一次创作' })
    ).toBeInTheDocument();

    // Pending: workspace has produced work but no current recommendation.
    harness.readDashboardHomeRecommendation.mockResolvedValue({
      workspaceId: 'ws-1',
      currentFactsRevision: 3,
      recommendation: null,
      stale: false,
    });
    harness.operationsQuery.mockResolvedValue({
      ...emptyWorkbench(),
      works: [{ status: 'completed' }],
      assets: [{ kind: 'image' }],
    });

    cleanup();
    render(
      <QueryClientProvider client={client}>
        <TodayRecommendationCard
          onStart={onStart}
          onUse={vi.fn()}
          workspaceId="ws-1"
        />
      </QueryClientProvider>
    );

    await vi.waitFor(() => {
      expect(screen.getByTestId('today-recommendation')).toHaveAttribute(
        'data-recommendation-state',
        'pending'
      );
    });
    expect(screen.getByTestId('suggestion-chip-today')).toHaveTextContent(
      /今天的主推荐还没排出来/u
    );
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: '今天的主推荐还没排出来',
      })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '开始下一次创作' }));
    expect(onStart).toHaveBeenCalled();
    // silence unused
    void rerender;
  });

  it('今日建议 highlight chip opens the three-element mini card; use only prefills', async () => {
    const user = userEvent.setup();
    harness.readDashboardHomeRecommendation.mockResolvedValue({
      workspaceId: 'ws-1',
      currentFactsRevision: 1,
      stale: false,
      recommendation: {
        title: '换季头皮护理科普',
        body: '适合现在发的一篇护理科普。',
        whyNow: '换季咨询上升',
        customerAction: '私信预约',
        factReferences: [],
        sourceLabel: '上周任务',
        opportunity: null,
      },
    });
    harness.operationsQuery.mockResolvedValue(emptyWorkbench());
    harness.queryP1.mockResolvedValue([]);

    const { onUse, onStart } = renderCard();

    // Wait for the harness query to land before asserting the highlight face.
    await vi.waitFor(() => {
      expect(screen.getByTestId('suggestion-chip-today')).toHaveAttribute(
        'data-highlight',
        'true'
      );
    });
    const todayChip = screen.getByTestId('suggestion-chip-today');
    expect(todayChip).toHaveTextContent(/今日建议/u);

    // Mini card is collapsed until the merchant opens the chip.
    expect(
      screen.queryByTestId('today-recommendation-mini-card')
    ).not.toBeInTheDocument();

    await user.click(todayChip);
    expect(
      await screen.findByTestId('today-recommendation-mini-card')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('today-recommendation-three-elements')
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('today-recommendation-use'));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse.mock.calls[0]?.[0].intent).toMatch(/换季头皮护理科普/u);
    expect(onStart).not.toHaveBeenCalled();
  });
});
