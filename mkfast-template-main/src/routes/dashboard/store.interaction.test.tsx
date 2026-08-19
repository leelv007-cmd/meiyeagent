/**
 * STORE-01 / R-P1-05: first GET /api/core/product/state 500 must not leave
 * /dashboard/store on Skeleton forever. Merchant copy + retry, then the same
 * ready profile after a successful retry. Core stacks stay off the page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProductState } from '@meiye/contracts';
import { afterEach, expect, it, vi } from 'vitest';

const CORE_STACK =
  'Error: relation "workspaces" does not exist\n    at ProductService.bootstrap (/app/apps/core/src/product/product-service.ts:88:11)\n    at async Object.GET (/app/apps/core/src/server.ts:701:12)';

const productApi = vi.hoisted(() => ({
  telemetryFetch: vi.fn(),
}));
const p1Client = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('@/lib/product-telemetry', () => ({
  emitTelemetry: () => undefined,
  telemetryFetch: (...args: unknown[]) => productApi.telemetryFetch(...args),
}));
vi.mock('@/p1/client', () => ({
  queryP1: p1Client.query,
}));
vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));
vi.mock('@/product/store-intake/store-intake-wizard', () => ({
  StoreIntakeWizard: () => <div data-testid="store-intake-wizard" />,
}));

const { Route: storeFileRoute } = await import('./store');

afterEach(() => {
  vi.resetAllMocks();
});

function readyProfile(): ProductState {
  return {
    assets: [],
    contents: [],
    store: {
      accounts: [],
      address: '湖墅南路 88 号',
      booking: '提前一天预约',
      brandVoice: '真实、克制',
      city: '杭州',
      district: '拱墅区',
      name: '青禾美甲',
      prohibitions: [],
      projects: [
        {
          confirmed: true,
          durationMinutes: 90,
          id: 'project-cat-eye',
          name: '透亮猫眼',
          price: 299,
        },
      ],
      regulated: false,
      revision: 1,
    },
    workspaceId: 'workspace-store-01',
  } as unknown as ProductState;
}

function failedStateResponse() {
  return Response.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        details: { stack: CORE_STACK },
        message: CORE_STACK,
      },
      meta: { correlationId: 'corr-store-state-500' },
    },
    { status: 500 }
  );
}

function readyStateResponse() {
  return Response.json({
    data: readyProfile(),
    meta: { correlationId: 'corr-store-state-ok' },
  });
}

async function renderStore() {
  p1Client.query.mockResolvedValue([]);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: Outlet });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/dashboard/store'] }),
    routeTree: rootRoute.addChildren([
      createRoute({
        component: storeFileRoute.options.component,
        getParentRoute: () => rootRoute,
        path: '/dashboard/store',
      }),
      createRoute({
        component: Outlet,
        getParentRoute: () => rootRoute,
        path: '/dashboard/workspace',
      }),
    ]),
  });
  await router.load();

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function assertNoCoreStack() {
  expect(document.body.textContent ?? '').not.toMatch(
    /ProductService|product-service\.ts|relation "workspaces"|at async Object\.GET/i
  );
}

it('a first product-state 500 shows merchant copy and retry, then the ready profile', async () => {
  productApi.telemetryFetch.mockResolvedValueOnce(failedStateResponse());
  const user = userEvent.setup();

  await renderStore();

  expect(
    await screen.findByText('暂时无法读取当前工作区，请重试。')
  ).toBeInTheDocument();
  expect(screen.queryByTestId('store-state-loading')).not.toBeInTheDocument();
  expect(screen.queryByTestId('store-ambient-title')).not.toBeInTheDocument();
  expect(screen.queryByText('青禾美甲')).not.toBeInTheDocument();
  assertNoCoreStack();

  const retry = screen.getByTestId('store-state-retry');
  expect(retry).toHaveTextContent('重试');

  productApi.telemetryFetch.mockResolvedValueOnce(readyStateResponse());
  await user.click(retry);

  expect(await screen.findByText('青禾美甲')).toBeInTheDocument();
  expect(screen.getByTestId('store-ambient-title')).toBeInTheDocument();
  expect(screen.getByText('透亮猫眼 ¥299')).toBeInTheDocument();
  expect(
    screen.queryByText('暂时无法读取当前工作区，请重试。')
  ).not.toBeInTheDocument();
  expect(screen.queryByTestId('store-state-loading')).not.toBeInTheDocument();
  assertNoCoreStack();
});
