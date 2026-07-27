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

const productClient = vi.hoisted(() => ({
  execute: vi.fn(),
  refresh: vi.fn(),
  state: undefined as ProductState | undefined,
}));
const operationsClient = vi.hoisted(() => ({
  query: vi.fn(),
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
vi.mock('@/p1/client', () => ({
  operationsQuery: operationsClient.query,
}));
// The dashboard chrome needs sidebar and plan context that has nothing to do
// with the ledger's own behaviour.
vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));

const { Route: leadsFileRoute } = await import('./leads');

afterEach(() => {
  vi.resetAllMocks();
});

async function renderLedger(contentPackages: unknown[] = []) {
  operationsClient.query.mockResolvedValue(contentPackages);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: Outlet });
  const leadsRoute = createRoute({
    component: leadsFileRoute.options.component,
    getParentRoute: () => rootRoute,
    path: '/dashboard/leads',
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/dashboard/leads'] }),
    routeTree: rootRoute.addChildren([
      leadsRoute,
      createRoute({
        component: Outlet,
        getParentRoute: () => rootRoute,
        path: '/dashboard',
      }),
      createRoute({
        component: Outlet,
        getParentRoute: () => rootRoute,
        path: '/dashboard/leads/$leadId',
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

/**
 * T33 / #227: reshelling the ledger swapped the native <select> for a HeroUI
 * Select, the one change with a functional consequence. This drives the real
 * listbox and asserts the update_lead command still reaches the product client.
 *
 * It lives here rather than in an e2e spec because a lead needs a published
 * content, and legacy content creation is closed for new workspaces
 * (content_package_write_ownership defaults to 'contentpackage', so
 * generate_copy answers LEGACY_CONTENT_READ_ONLY) — the same wall that keeps
 * p0-golden-journey red at its seed.
 */
it('a status pick on the reshelled ledger issues update_lead', async () => {
  productClient.state = {
    assets: [],
    contents: [],
    insights: [],
    leads: [
      {
        amountCents: 29900,
        contentId: 'content-1',
        contentVersionId: 'version-1',
        createdAt: '2026-07-20T02:00:00.000Z',
        id: 'lead-1',
        note: '顾客私信问同款',
        projectId: 'project-1',
        retentionExpiresAt: '2026-10-18T02:00:00.000Z',
        source: 'direct_message',
        status: 'new',
        updatedAt: '2026-07-20T02:00:00.000Z',
      },
    ],
    // Only the slices the ledger reads are populated; the rest of ProductState
    // is out of this surface's reach.
  } as unknown as ProductState;

  const user = userEvent.setup();
  await renderLedger();

  await user.click(screen.getByRole('button', { name: /更新线索状态/u }));
  // The whole ledger vocabulary stays reachable — the reshell swapped the
  // control, not the follow-up states it can express.
  expect(
    (await screen.findAllByRole('option')).map((option) => option.textContent)
  ).toEqual(['新建', '已联系', '已预约', '已核销', '流失', '无效']);

  await user.click(screen.getByRole('option', { name: '已联系' }));

  expect(productClient.execute).toHaveBeenCalledWith({
    leadId: 'lead-1',
    status: 'contacted',
    type: 'update_lead',
  });
});

it('records a lead against a published canonical ContentPackage without legacy contents', async () => {
  productClient.state = {
    assets: [],
    contents: [],
    insights: [],
    leads: [],
  } as unknown as ProductState;
  productClient.execute.mockResolvedValue({});
  const user = userEvent.setup();

  await renderLedger([
    {
      currentVersionId: 'package-1-v2',
      deliveryEvents: [{ status: 'published', type: 'manual_publish_result' }],
      id: 'package-1',
      revision: 2,
      status: 'accepted',
      versions: [{ id: 'package-1-v2', title: 'Canonical lead source' }],
    },
  ]);

  await screen.findByText('Canonical lead source');
  const record = screen.getByRole('button', { name: '记录私信线索' });
  await user.click(record);

  expect(productClient.execute).toHaveBeenCalledWith({
    lead: {
      amountCents: undefined,
      note: undefined,
      source: 'direct_message',
    },
    packageId: 'package-1',
    type: 'create_lead',
  });
});
