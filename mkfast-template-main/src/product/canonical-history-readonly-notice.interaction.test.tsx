/**
 * D-137: the jobs island is a leftover from the previous workflow. The
 * decision ruled it read-only and explicitly ruled out investing in it
 * further, so the only thing owed to the merchant is one sentence saying
 * what she is looking at — on the list and on the record itself.
 *
 * The notice is asserted while the underlying queries are still loading,
 * because "this is old and you can only look at it" is true before the data
 * arrives. A notice that waits for data would leave the merchant guessing
 * during exactly the moment she is most likely to try acting on the page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Same reason as the other route-level tests: the header reaches the DB
// module, which imports cloudflare:workers and cannot resolve under vitest.
vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));

vi.mock('@/p1/client', () => ({
  operationsQuery: vi.fn(() => new Promise(() => {})),
}));

vi.mock('@/product/client', () => ({
  useProductState: () => ({ loading: true, state: null }),
}));

vi.mock('./creative-job-observer', () => ({
  useVideoWorkflowListObserver: () => ({
    data: undefined,
    isLoading: true,
    isSuccess: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const { CanonicalHistoryPage, CanvasImageJobDetailPage } = await import(
  './canonical-history-page'
);

function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

afterEach(cleanup);

describe('D-137 read-only positioning copy', () => {
  it('states on the jobs list that these records are view-only', () => {
    renderWithQuery(<CanonicalHistoryPage mode="jobs" />);

    const notice = screen.getByTestId('history-jobs-readonly-notice');
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toMatch(/仅供查看/u);
  });

  it('states the same on a single generation record', () => {
    renderWithQuery(<CanvasImageJobDetailPage jobId="job-1" />);

    const notice = screen.getByTestId('canvas-job-readonly-notice');
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toMatch(/仅供查看/u);
  });

  it('does not put the jobs notice on other history modes', () => {
    renderWithQuery(<CanonicalHistoryPage mode="recent" />);

    expect(
      screen.queryByTestId('history-jobs-readonly-notice')
    ).not.toBeInTheDocument();
  });
});
