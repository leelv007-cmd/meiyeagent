import type { ProductState } from '@meiye/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { __resetAgentWorkbenchHostStoreForTests } from '@/product/agent-workbench/agent-event-store';
import { ComposerHome } from './composer-home';

const productClient = vi.hoisted(() => ({
  execute: vi.fn(),
  refresh: vi.fn(),
  state: undefined as ProductState | undefined,
}));

vi.mock('@/product/client', () => ({
  useProductState: () => ({
    error: undefined,
    execute: productClient.execute,
    loading: false,
    pending: false,
    refresh: productClient.refresh,
    state: productClient.state,
  }),
}));
vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));

const MERCHANT_TEXT = '把这张门店案例图做成一条可直接发布的抖音项目成片';

const ACTIVE_TASK = {
  agentRunId: 'run:composer:restore-1',
  agentThreadId: 'thread:composer:restore-1',
  merchantText: MERCHANT_TEXT,
  packageId: 'content-package-restore-1',
  submittedAt: '2026-08-23T00:00:00.000Z',
  taskId: 'composer-task:restore-1',
  workId: 'work-restore-1',
};

let activeTaskReads = 0;
let emptyAnswersRemaining = 0;

beforeAll(() => {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  activeTaskReads = 0;
  emptyAnswersRemaining = 2;
  window.sessionStorage.clear();
  vi.stubGlobal(
    'EventSource',
    class extends EventTarget {
      static readonly CLOSED = 2;
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly withCredentials = false;
      readyState = 0;
      onerror = null;
      onmessage = null;
      onopen = null;
      constructor(readonly url: string) {
        super();
      }
      close() {
        this.readyState = 2;
      }
    }
  );
});

afterEach(() => {
  __resetAgentWorkbenchHostStoreForTests();
  productClient.state = undefined;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

/**
 * D-145 时间桥拉回. The tab that reopens after a close has no handle of its
 * own, so the active-task list is its only way back into a run that is still
 * going — and that list stops carrying the run the moment it finishes. A read
 * that lands in the window before the harness row is listable must not be the
 * tab's only chance: measured on the §37.4-D video journey, the next refetch
 * of this key came ~10s later, by which time the run had finished and every
 * later answer was empty for good.
 */
it('keeps asking for an in-flight run after the mount read comes back empty', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(restoreFetch);

  await renderComposerHome();

  await waitFor(
    () =>
      expect(screen.getByTestId('composer-intent-input')).toHaveValue(
        MERCHANT_TEXT
      ),
    { timeout: 15_000 }
  );
  expect(activeTaskReads).toBeGreaterThan(1);
});

async function restoreFetch(
  request: string | URL | Request,
  init?: RequestInit
) {
  const url =
    typeof request === 'string'
      ? request
      : request instanceof URL
        ? request.toString()
        : request.url;
  if (url === '/api/core/p1/harness/tasks') {
    activeTaskReads += 1;
    if (emptyAnswersRemaining > 0) {
      emptyAnswersRemaining -= 1;
      return successResponse({ tasks: [] });
    }
    return successResponse({ tasks: [ACTIVE_TASK] });
  }
  if (url.endsWith('/decision')) return new Response(null, { status: 404 });
  if (url.includes('/interaction')) return successResponse(null);
  if (url === '/api/core/p1/query') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string };
    if (body.action === 'marketing_identity_projection') {
      return successResponse({
        decisionRevision: 0,
        defaultDecision: null,
        defaultIdentity: null,
        identities: [],
      });
    }
  }
  return new Response(
    JSON.stringify({
      error: { code: 'INTERNAL_ERROR', message: 'Unavailable in this test.' },
      meta: { correlationId: 'corr-server-restore-interaction' },
    }),
    { headers: { 'content-type': 'application/json' }, status: 503 }
  );
}

function successResponse(data: unknown) {
  return new Response(
    JSON.stringify({
      data,
      meta: { correlationId: 'corr-server-restore-interaction' },
    }),
    { headers: { 'content-type': 'application/json' }, status: 200 }
  );
}

async function renderComposerHome() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const rootRoute = createRootRoute();
  const route = createRoute({
    component: () => <ComposerHome testHost={{ viewportWidth: 1240 }} />,
    getParentRoute: () => rootRoute,
    path: '/',
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: rootRoute.addChildren([route]),
  });
  await router.load();

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
