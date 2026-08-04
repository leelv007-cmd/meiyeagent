import type {
  CreativeWorkbenchProjection,
  ResultTargetResolveOutcome,
} from '@meiye/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UseNavigateResult } from '@tanstack/react-router';
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

import { p1QueryKeys } from '@/p1/query-keys';

vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));

import { ResultCenterPage } from './result-center-page';
import { useResultCenterView } from './use-result-center-view';
import type { ResultCommandTransport } from './use-result-commands';

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

test('adjust flow renders the themed modal through injected commands', async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  const target = { workId: 'work-1', panel: 'adjust' as const };
  queryClient.setQueryData(
    p1QueryKeys.request('result-delivery', 'result_target_resolve', { target }),
    {
      kind: 'ok',
      target,
      mode: 'active',
      workspaceId: 'workspace-1',
    } satisfies ResultTargetResolveOutcome
  );
  queryClient.setQueryData(
    p1QueryKeys.request('operations', 'creative_workbench'),
    {
      ...workbench,
      works: [{ ...workbench.works[0], currentJobId: 'job-1' }],
      jobs: [
        {
          id: 'job-1',
          workspaceId: 'workspace-1',
          workId: 'work-1',
          status: 'completed',
          contract: {
            operation: 'copy.generate',
            catalogModelId: 'copy-model',
            catalogRevision: 'catalog-1',
            quoteRevision: 'quote-1',
            quoteAcceptedAt: '2026-08-04T00:00:00.000Z',
            outputLabel: '文案',
            estimatedAmount: 1,
            currency: 'CNY',
            outputCount: 1,
            dataClass: [],
            watermarkEnabled: false,
            aigcLabelEnabled: true,
          },
          submissionKey: 'submit-1',
          outputAssetIds: [],
          outputContentIds: [],
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:01:00.000Z',
        },
      ],
    } satisfies CreativeWorkbenchProjection
  );
  queryClient.setQueryData(
    p1QueryKeys.request('operations', 'content_packages'),
    []
  );
  queryClient.setQueryData(
    p1QueryKeys.request('result-delivery', 'assisted_list'),
    []
  );
  const transport = vi.fn<ResultCommandTransport>(async (_module, call) => {
    if (call.action === 'result_adjust_prepare') {
      return {
        quoteIntent: {
          catalogModelId: 'copy-model',
          operation: 'copy.generate',
          quantity: 1,
        },
        task: { id: 'task-2' },
        work: { id: 'work-2' },
      };
    }
    return {
      quoteId: 'quote-adjust-1',
      catalogModelId: 'copy-model',
      revision: 'quote-revision-1',
      formula: { currency: 'CNY' },
      debitUnits: [{ resource: 'copy_generation', quantity: 1 }],
      outputLabel: '一版文案',
      outputCount: 1,
    };
  });
  const navigate =
    vi.fn() as unknown as UseNavigateResult<'/dashboard/results/$workId'>;
  const view = renderHook(
    () =>
      useResultCenterView('work-1', { panel: 'adjust' }, navigate, {
        commandTransport: transport,
      }),
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
  const adjust = view.result.current.view.onAdjust;
  await act(async () => {
    await adjust?.('语气更温和');
  });
  await waitFor(() => {
    expect(view.result.current.status).toBe('ready');
    if (view.result.current.status === 'ready') {
      expect(view.result.current.view.adjustConfirmation).toBeTruthy();
    }
  });
  if (view.result.current.status !== 'ready') return;

  render(
    <QueryClientProvider client={queryClient}>
      {view.result.current.view.adjustConfirmation}
    </QueryClientProvider>
  );
  const modal = screen.getByTestId('image-adjust-confirmation');
  expect(modal).toHaveAttribute('aria-modal', 'true');
  expect(modal).toHaveClass('meiye-product-shell');
});
