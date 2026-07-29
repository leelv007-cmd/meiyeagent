/**
 * 段③「继续上次工作」— D-164① / D-126.
 *
 * The distinction under test is the one the two surfaces on this page kept
 * getting wrong in different ways: a workspace with nothing in it, and a
 * workspace whose contents failed to load, must not look the same. Only the
 * first is the merchant's to fix.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
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

function projection(works: unknown[]) {
  return { assets: [], contents: [], events: [], jobs: [], works };
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

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('dashboardContinueItems', () => {
  it('puts unfinished work first — it is the part she cannot reconstruct', () => {
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

describe('DashboardContinueSection', () => {
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

  it('lists work in hand and marks what is unfinished', async () => {
    p1.operationsQuery.mockResolvedValue(
      projection([
        work('running-1', 'running', '母亲节朋友圈文案'),
        work('done-1', 'completed', '新客到店海报'),
      ])
    );

    renderSection();

    expect(
      await screen.findByTestId('dashboard-section-continue')
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('continue-item')).toHaveLength(2);
    const marks = screen.getAllByTestId('continue-item-unfinished');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toMatch(/未完成/u);
  });

  it('says the work could not be loaded instead of looking like a new shop', async () => {
    p1.operationsQuery.mockRejectedValue(new Error('network down'));

    renderSection();

    const pending = await screen.findByTestId('continue-pending');
    // The failure must read as ours, not as "you have not done anything".
    expect(pending.textContent).toMatch(/还在整理/u);
    expect(screen.queryByTestId('continue-item')).not.toBeInTheDocument();
  });
});
