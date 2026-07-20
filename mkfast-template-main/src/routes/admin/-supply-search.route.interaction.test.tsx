import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { buildDefaultSupplyControlSnapshot } from '@/p1/admin-supply-fixture';
import { Route as fileRoute } from './supply';

const p1Client = vi.hoisted(() => ({
  commandP1: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/p1/client', () => p1Client);
vi.mock('@/components/admin/admin-route-page', () => ({
  AdminRoutePage: ({ children }: { children?: ReactNode }) => children,
}));

afterEach(() => {
  vi.resetAllMocks();
});

it('forwards numeric page query values from the public URL to Core', async () => {
  p1Client.queryP1.mockResolvedValue(buildDefaultSupplyControlSnapshot());
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const rootRoute = createRootRoute({ component: Outlet });
  const supplyRoute = createRoute({
    component: fileRoute.options.component,
    getParentRoute: () => rootRoute,
    path: '/admin/supply',
    validateSearch: fileRoute.options.validateSearch,
  });
  const router = createRouter({
    history: createMemoryHistory({
      initialEntries: ['/admin/supply?page=2&pageSize=10'],
    }),
    routeTree: rootRoute.addChildren([supplyRoute]),
  });
  await router.load();

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  await waitFor(() =>
    expect(p1Client.queryP1).toHaveBeenCalledWith(
      'model-supply',
      {
        action: 'admin_supply_control',
        payload: {
          runQuery: expect.objectContaining({ page: 2, pageSize: 10 }),
        },
      },
      expect.any(AbortSignal)
    )
  );
});
