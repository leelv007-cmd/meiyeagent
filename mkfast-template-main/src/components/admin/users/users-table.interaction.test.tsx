import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminUserListItem } from '@/api/users';
import { UsersTable } from './users-table';

vi.mock('@/api/users', () => ({
  listUsers: vi.fn(),
  getUserById: vi.fn(),
}));

const activeUser = {
  id: 'user-active',
  name: 'Active Merchant',
  email: 'active@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  role: 'user',
  banned: false,
  banReason: null,
  banExpires: null,
  provisioningAttribution: { kind: 'self_registered' as const },
} as AdminUserListItem;

const bannedUser = {
  ...activeUser,
  id: 'user-banned',
  name: 'Banned Merchant',
  email: 'banned@example.com',
  banned: true,
  banReason: 'spam',
} as AdminUserListItem;

async function renderUsersTable(
  users: AdminUserListItem[],
  initialEntries: string[] = ['/admin/users'],
  initialIndex = 0
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const rootRoute = createRootRoute({
    component: () => (
      <div>
        <UsersTable
          data={users}
          total={users.length}
          pageIndex={0}
          pageSize={10}
          search=""
          sorting={[{ id: 'createdAt', desc: true }]}
          loading={false}
          onSearch={() => {}}
          onPageChange={() => {}}
          onPageSizeChange={() => {}}
          onSortingChange={() => {}}
        />
        <Outlet />
      </div>
    ),
  });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/users',
    component: () => <div data-testid="list-route-marker">list</div>,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/users/$userId',
    component: () => (
      <div data-testid="detail-route-marker">detail route open</div>
    ),
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries, initialIndex }),
    routeTree: rootRoute.addChildren([listRoute, detailRoute]),
  });
  await router.load();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return { ...view, router, queryClient };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('users table route-driven detail + permission gates', () => {
  it('opens detail via name link and updates the URL', async () => {
    const user = userEvent.setup();
    const { router } = await renderUsersTable([activeUser]);

    expect(router.state.location.pathname).toBe('/admin/users');

    await user.click(await screen.findByTestId('user-name-link'));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/users/user-active');
    });
    expect(screen.getByTestId('detail-route-marker')).toBeTruthy();
  });

  it('navigating back from the detail path leaves the list route', async () => {
    const { router } = await renderUsersTable(
      [activeUser],
      ['/admin/users', '/admin/users/user-active'],
      1
    );

    expect(router.state.location.pathname).toBe('/admin/users/user-active');

    router.history.back();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/users');
    });
  });

  it('disables row actions that the predicates refuse', async () => {
    const user = userEvent.setup();
    await renderUsersTable([activeUser, bannedUser]);

    const rows = await screen.findAllByTestId('user-row-actions');
    expect(rows).toHaveLength(2);

    await user.click(rows[0]!);
    const activeMenu = await screen.findByRole('menu');
    // Base UI marks disabled menu items with a present data-disabled attr
    // (value may be empty string), not data-disabled="true".
    expect(
      within(activeMenu)
        .getByTestId('user-row-ban')
        .hasAttribute('data-disabled')
    ).toBe(false);
    expect(
      within(activeMenu)
        .getByTestId('user-row-unban')
        .hasAttribute('data-disabled')
    ).toBe(true);
    await user.keyboard('{Escape}');

    await user.click(rows[1]!);
    const bannedMenu = await screen.findByRole('menu');
    expect(
      within(bannedMenu)
        .getByTestId('user-row-ban')
        .hasAttribute('data-disabled')
    ).toBe(true);
    expect(
      within(bannedMenu)
        .getByTestId('user-row-unban')
        .hasAttribute('data-disabled')
    ).toBe(false);
  });
});
