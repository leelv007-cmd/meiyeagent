import type {
  CreativeWorkbenchProjection,
  ResultTargetResolveOutcome,
} from '@meiye/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UseNavigateResult } from '@tanstack/react-router';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

import { p1QueryKeys } from '@/p1/query-keys';

vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));

import { ResultCenterPage } from './result-center-page';
import { useResultCenterView } from './use-result-center-view';

const workbench: CreativeWorkbenchProjection = {
  works: [
    {
      id: 'work-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      intent: '写一条护理文案',
      mode: 'direct',
      operation: 'copy.generate',
      sourceReferences: [],
      status: 'completed',
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:01:00.000Z',
    },
  ],
  jobs: [],
  assets: [],
  contents: [],
  events: [],
};

test('view hook resolves the exact work and mounts ResultCenterPage props', async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  const target = { workId: 'work-1', panel: 'delivery' as const };
  const outcome: ResultTargetResolveOutcome = {
    kind: 'ok',
    target,
    mode: 'active',
    workspaceId: 'workspace-1',
  };
  queryClient.setQueryData(
    p1QueryKeys.request('result-delivery', 'result_target_resolve', { target }),
    outcome
  );
  queryClient.setQueryData(
    p1QueryKeys.request('operations', 'creative_workbench'),
    workbench
  );
  queryClient.setQueryData(
    p1QueryKeys.request('operations', 'content_packages'),
    []
  );
  queryClient.setQueryData(
    p1QueryKeys.request('result-delivery', 'assisted_list'),
    []
  );
  const navigate =
    vi.fn() as unknown as UseNavigateResult<'/dashboard/results/$workId'>;
  const view = renderHook(
    () => useResultCenterView('work-1', { panel: 'delivery' }, navigate),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    }
  );

  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  if (view.result.current.status !== 'ready') {
    throw new Error('Result Center view did not become ready.');
  }
  expect(view.result.current.view.resolveOutcome).toEqual(outcome);
  expect(view.result.current.view.facts.target).toEqual(target);
  expect(view.result.current.view.facts.workspaceKind).toBe('copy');
  expect(view.result.current.view.facts.requestedPanel).toBe('delivery');

  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ResultCenterPage {...view.result.current.view} />
    </QueryClientProvider>
  );
  expect(markup).toContain('结果中心');
  expect(markup).toContain('data-testid="result-center-shell"');
  expect(markup).toContain('data-testid="delivery-panel"');
});
