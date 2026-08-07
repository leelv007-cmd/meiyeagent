/**
 * 段③ Activity Shelf — D-164① / D6 / P1-3 (#318).
 *
 * The distinction under test is the one the two surfaces on this page kept
 * getting wrong in different ways: a workspace with nothing in it, and a
 * workspace whose contents failed to load, must not look the same. Only the
 * first is the merchant's to fix.
 *
 * P1-3 adds object-card face: ≤3 cards, each with status + next action.
 * Accessible name keeps full intent for recorded journeys.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const p1 = vi.hoisted(() => ({ operationsQuery: vi.fn() }));

vi.mock('@/p1/client', () => ({ operationsQuery: p1.operationsQuery }));
// Spread the rest: the real Link forwards data-* through, and a mock that
// silently drops them turns "the element is missing" into a test artefact.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params: _params,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { DashboardContinueSection, dashboardContinueItems } = await import(
  './dashboard-continue-section'
);

function work(id: string, status: string, intent: string) {
  return { id, status, intent, works: [] } as never;
}

function projection(works: unknown[], assets: unknown[] = []) {
  return { assets, contents: [], events: [], jobs: [], works };
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DashboardContinueSection />
    </QueryClientProvider>
  );
}

async function expandShelf() {
  const user = userEvent.setup();
  const expand = await screen.findByTestId('activity-shelf-expand');
  await user.click(expand);
  return screen.findByTestId('activity-shelf');
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('dashboardContinueItems', () => {
  it('puts needs-attention work first — it is the part she cannot reconstruct', () => {
    const items = dashboardContinueItems(
      projection([
        work('done-1', 'completed', 'finished one'),
        work('running-1', 'running', 'still going'),
        work('draft-1', 'draft', 'never sent'),
      ]) as never
    );

    expect(items.map((item) => item.id)).toEqual([
      'running-1',
      'draft-1',
      'done-1',
    ]);
  });

  it('caps the list so the section stays a nudge, not a content list', () => {
    const items = dashboardContinueItems(
      projection(
        Array.from({ length: 8 }, (_, index) =>
          work(`w-${index}`, 'completed', `intent ${index}`)
        )
      ) as never
    );

    expect(items).toHaveLength(3);
  });
});

describe('Activity Shelf (DashboardContinueSection)', () => {
  it('stays out of the way on a workspace that has produced nothing', async () => {
    p1.operationsQuery.mockResolvedValue(projection([]));

    renderSection();

    // Wait for the query to settle before concluding it rendered nothing.
    await vi.waitFor(() => {
      expect(p1.operationsQuery).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId('dashboard-section-continue')
    ).not.toBeInTheDocument();
  });

  it('P1-3: lists ≤3 object cards with status + next action each', async () => {
    p1.operationsQuery.mockResolvedValue(
      projection([
        work('running-1', 'running', '母亲节朋友圈文案'),
        work('done-1', 'completed', '新客到店海报'),
        work('done-2', 'completed', '第三张不该挤爆'),
        work('done-3', 'completed', '第四张应被裁掉'),
      ])
    );

    renderSection();

    expect(
      await screen.findByTestId('dashboard-section-continue')
    ).toBeInTheDocument();
    expect(screen.getByTestId('activity-shelf-expand')).toBeInTheDocument();
    await expandShelf();

    const cards = screen.getAllByTestId('activity-shelf-card');
    expect(cards.length).toBeLessThanOrEqual(3);
    expect(cards).toHaveLength(3);

    for (const card of cards) {
      expect(
        card.querySelector('[data-testid="activity-shelf-status"]')
      ).not.toBeNull();
      expect(
        card.querySelector('[data-testid="activity-shelf-thumb"]')
      ).not.toBeNull();
    }

    // Next-action entries keep full intent in accessible name (recorded journey).
    const actions = screen.getAllByTestId('continue-item');
    expect(actions).toHaveLength(3);
    expect(actions[0]).toHaveAccessibleName(/母亲节朋友圈文案/u);
    expect(actions[0]).toHaveAccessibleName(/查看进度|继续/u);

    const marks = screen.getAllByTestId('continue-item-unfinished');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toMatch(/未完成|Unfinished/u);
  });

  it('binds intent into action accessible name so completed cards stay distinct', async () => {
    p1.operationsQuery.mockResolvedValue(
      projection([
        work('a', 'completed', '春季染发活动套图'),
        work('b', 'completed', '抖音护理成片'),
      ])
    );

    renderSection();
    await expandShelf();

    expect(
      screen.getByRole('link', { name: /春季染发活动套图/u })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /抖音护理成片/u })
    ).toBeInTheDocument();
  });

  it('renders video thumbs with a video element, not img', async () => {
    p1.operationsQuery.mockResolvedValue(
      projection(
        [work('v1', 'completed', '15秒护理成片')],
        [
          {
            id: 'asset-v',
            workspaceId: 'ws-1',
            workId: 'v1',
            jobId: 'j1',
            kind: 'video',
            title: '成片',
            objectKey: 'ws-1/clip.mp4',
            contentType: 'video/mp4',
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ]
      )
    );

    renderSection();
    await expandShelf();
    const thumb = await screen.findByTestId('activity-shelf-thumb');
    expect(thumb).toHaveAttribute('data-thumb-kind', 'video');
    expect(thumb.querySelector('video')).not.toBeNull();
    expect(thumb.querySelector('img')).toBeNull();
  });

  it('says the work could not be loaded instead of looking like a new shop', async () => {
    p1.operationsQuery.mockRejectedValue(new Error('network down'));

    renderSection();

    const pending = await screen.findByTestId('continue-pending');
    // The failure must read as ours, not as "you have not done anything".
    expect(pending.textContent).toMatch(/还在整理/u);
    expect(screen.queryByTestId('continue-item')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-shelf-card')).not.toBeInTheDocument();
  });
});
