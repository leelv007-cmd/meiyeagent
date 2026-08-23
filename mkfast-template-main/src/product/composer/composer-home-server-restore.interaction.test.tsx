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

const WORKSPACE_ID = 'ws-server-restore';

/**
 * The marker is the browser's own memory of a run it started. Seeding it is
 * what makes this "the same merchant reopening her tab" rather than "any tab
 * adopting any recent run" (V31-105 §12 boundary).
 */
function seedRestoreMarker(task: { taskId: string; workId: string }) {
  window.localStorage.setItem(
    `composer-restore-marker::v1::${WORKSPACE_ID}`,
    JSON.stringify({
      workId: task.workId,
      taskId: task.taskId,
      boundAt: '2026-08-24T00:00:00.000Z',
    })
  );
}

function productStateWithWorkspace() {
  return {
    workspaceId: WORKSPACE_ID,
    exampleStores: [],
    store: null,
    assets: [],
    contents: [],
    storyboards: [],
    videoJobs: [],
    videoArtifactShells: [],
    videoRenderEvidence: [],
    videoArtifacts: [],
    complianceResults: [],
    agentRuns: [],
    toolCalls: [],
    handoffPackages: [],
    preflightEvents: [],
    responsibilityConfirmations: [],
    operationalEvidence: { generatedCandidateCount: 0 },
  } as unknown as ProductState;
}

const COMPLETED_TASK = {
  ...ACTIVE_TASK,
  completedAt: '2026-08-23T00:00:06.000Z',
  outcome: 'delivered' as const,
};

let activeTaskReads = 0;
let emptyAnswersRemaining = 0;
let activeListAlwaysEmpty = false;

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
  activeListAlwaysEmpty = false;
  window.sessionStorage.clear();
  window.localStorage.clear();
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

/**
 * V31-105 §12. The active list is the run's own lifetime. A fixture video lives
 * about six seconds, so a merchant who reopened the tab a moment late got an
 * empty list on every read, for good — the conversation was unreachable even
 * though the work had been delivered and billed. The finished handle is the way
 * back, and it must land on the card the run actually reached.
 */
it('adopts a run that already finished when nothing is still running', async () => {
  activeListAlwaysEmpty = true;
  productClient.state = productStateWithWorkspace();
  seedRestoreMarker(COMPLETED_TASK);
  vi.spyOn(globalThis, 'fetch').mockImplementation(restoreFetch);

  await renderComposerHome();

  await waitFor(
    () =>
      expect(screen.getByTestId('composer-intent-input')).toHaveValue(
        MERCHANT_TEXT
      ),
    { timeout: 15_000 }
  );
  // Not merely "some session": the delivered card is what the merchant came
  // back for, carrying the work the Result Center opens from.
  await waitFor(() =>
    expect(screen.getByTestId('composer-delivery-card')).toBeInTheDocument()
  );
  expect(activeTaskReads).toBeGreaterThan(0);
}, 30_000);

/**
 * V31-105 §12 boundary — live-caught in CI, where several specs share one Core
 * and one database: the next spec's brand-new Composer adopted the previous
 * spec's delivered run and sat frozen on it (`agent-workstream`
 * `data-delivered` never flipped for its own run). A Composer that never
 * started anything here must stay a blank Composer.
 */
it('a Composer that started nothing here never adopts a run someone else finished', async () => {
  activeListAlwaysEmpty = true;
  productClient.state = productStateWithWorkspace();
  // No marker: this browser has no memory of starting anything.
  vi.spyOn(globalThis, 'fetch').mockImplementation(restoreFetch);

  await renderComposerHome();

  await waitFor(() => expect(activeTaskReads).toBeGreaterThan(0));
  // Give the restore effect the same room the adopting test gets.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  expect(screen.queryByTestId('composer-delivery-card')).toBeNull();
  expect(screen.getByTestId('composer-intent-input')).toHaveValue('');
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
    if (activeListAlwaysEmpty) {
      return successResponse({
        tasks: [],
        recentlyCompleted: [COMPLETED_TASK],
      });
    }
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
