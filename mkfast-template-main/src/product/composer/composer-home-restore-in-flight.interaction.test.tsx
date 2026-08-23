/**
 * V31-105 §10 residual — the in-flight bit has to survive the tab that set it.
 *
 * `useLivingPlanController.startInFlight` only records a start *this* tab
 * pressed. A merchant who closed the tab and came back was therefore offered
 * 开始制作 again on a run that was already going, and Core answered
 * 「这次制作正在进行或已经结束，不需要再开始了。」
 * (`COMPOSER_PLAN_START_RUN_STATE_UNSTARTABLE`).
 *
 * The server already knows: a `harness_runtime.task_requests` row is written by
 * `startHarness`, and the submit path returns before that for a paid plan still
 * waiting on 开始制作 (submission-coordinator.ts:1369). So a run present in the
 * active list is a run whose start Core accepted — in every tab.
 *
 * The Workbench host is stubbed here so the assertion is about the one thing
 * under test: what Composer tells the strip. The strip's own behaviour for that
 * flag is pinned in commit-strip-model.test.ts and living-plan.interaction.
 */
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
vi.mock('@/product/agent-workbench/agent-workbench', () => ({
  AgentWorkbenchHost: (props: {
    livingPlanRunInFlight?: boolean;
    processSlot?: React.ReactNode;
  }) => (
    <div
      data-run-in-flight={props.livingPlanRunInFlight ? 'true' : 'false'}
      data-testid="workbench-host-stub"
    >
      {props.processSlot}
    </div>
  ),
}));

const MERCHANT_TEXT = '把这张门店案例图做成一条可直接发布的抖音项目成片';

const RUNNING_TASK = {
  agentRunId: 'run:composer:inflight-1',
  agentThreadId: 'thread:composer:inflight-1',
  merchantText: MERCHANT_TEXT,
  packageId: 'content-package-inflight-1',
  submittedAt: '2026-08-23T00:00:00.000Z',
  taskId: 'composer-task:inflight-1',
  workId: 'work-inflight-1',
};

const FINISHED_TASK = {
  ...RUNNING_TASK,
  completedAt: '2026-08-23T00:00:06.000Z',
  outcome: 'delivered' as const,
};

const WORKSPACE_ID = 'ws-restore-in-flight';

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

let listBody: unknown = { tasks: [] };

beforeAll(() => {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  listBody = { tasks: [] };
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
  vi.spyOn(globalThis, 'fetch').mockImplementation(restoreFetch);
});

afterEach(() => {
  __resetAgentWorkbenchHostStoreForTests();
  productClient.state = undefined;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('a tab that adopts a still-running server run tells the strip the start is spent', async () => {
  listBody = { tasks: [RUNNING_TASK], recentlyCompleted: [] };

  await renderComposerHome();

  await waitFor(
    () =>
      expect(screen.getByTestId('composer-intent-input')).toHaveValue(
        MERCHANT_TEXT
      ),
    { timeout: 15_000 }
  );
  await waitFor(() =>
    expect(screen.getByTestId('workbench-host-stub')).toHaveAttribute(
      'data-run-in-flight',
      'true'
    )
  );
});

it('a tab that adopts a finished run leaves the in-flight state alone', async () => {
  listBody = { tasks: [], recentlyCompleted: [FINISHED_TASK] };
  productClient.state = productStateWithWorkspace();
  seedRestoreMarker(FINISHED_TASK);

  await renderComposerHome();

  await waitFor(
    () =>
      expect(screen.getByTestId('composer-intent-input')).toHaveValue(
        MERCHANT_TEXT
      ),
    { timeout: 15_000 }
  );
  // Nothing is running, so there is no start to describe as spent; the terminal
  // lifecycle is what freezes this strip.
  expect(screen.getByTestId('workbench-host-stub')).toHaveAttribute(
    'data-run-in-flight',
    'false'
  );
}, 30_000);

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
  if (url === '/api/core/p1/harness/tasks') return successResponse(listBody);
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
      meta: { correlationId: 'corr-restore-in-flight' },
    }),
    { headers: { 'content-type': 'application/json' }, status: 503 }
  );
}

function successResponse(data: unknown) {
  return new Response(
    JSON.stringify({
      data,
      meta: { correlationId: 'corr-restore-in-flight' },
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
