/**
 * Admin users list + route-driven detail sheet (ticket #423).
 * Memory-router / pure SSR style where possible; shared wiring untouched.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = {}',
      };
    }
    return nextResolve(specifier, context);
  },
});

const usersRoute = await import('./users');
const userDetailRoute = await import('./users.$userId');
const { UserNameLink } = await import(
  '@/components/admin/users/user-name-link'
);

const sampleUser = {
  id: 'user-deep-1',
  name: 'Deep Link User',
  email: 'deep@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  role: 'user',
  banned: false,
  banReason: null,
  banExpires: null,
  provisioningAttribution: { kind: 'self_registered' as const },
};

test('admin users route modules export Route and list keeps Outlet for sheet', () => {
  assert.equal(typeof usersRoute.Route.options.component, 'function');
  assert.ok(usersRoute.Route, 'createFileRoute Route export required');
  assert.equal(typeof userDetailRoute.Route.options.component, 'function');
  assert.ok(userDetailRoute.Route);

  const listSource = readFileSync(
    resolve(process.cwd(), 'src/routes/admin/users.tsx'),
    'utf8'
  );
  assert.match(listSource, /<Outlet\s*\/>/);
  assert.match(listSource, /AdminUsersContent/);

  const detailSource = readFileSync(
    resolve(process.cwd(), 'src/routes/admin/users.$userId.tsx'),
    'utf8'
  );
  assert.match(detailSource, /useUser/);
  assert.match(detailSource, /UserDetailSheet/);
  assert.match(detailSource, /UserDetailLoadingState/);
  assert.match(detailSource, /UserDetailNotFoundState/);
  assert.match(detailSource, /errorComponent:\s*UserDetailErrorState/);
});

test('useRouteSheet is the sole consumer for user detail sheet animation', () => {
  const viewerSource = readFileSync(
    resolve(process.cwd(), 'src/components/admin/users/user-detail-viewer.tsx'),
    'utf8'
  );
  assert.match(viewerSource, /useRouteSheet/);
  assert.match(
    viewerSource,
    /from '@\/components\/admin\/shared\/use-route-sheet'/
  );
  // Pending / not-found / error + success all share route-sheet chrome.
  assert.match(viewerSource, /export function UserDetailSheet/);
  assert.match(viewerSource, /export function UserDetailStateSheet/);
  assert.match(viewerSource, /export function UserDetailLoadingState/);
  assert.match(viewerSource, /export function UserDetailNotFoundState/);
  assert.match(viewerSource, /export function UserDetailErrorState/);
  assert.match(viewerSource, /export function UserDetailPanel/);
});

test('detail route three-state contract is wired in source', () => {
  const detailSource = readFileSync(
    resolve(process.cwd(), 'src/routes/admin/users.$userId.tsx'),
    'utf8'
  );
  assert.match(detailSource, /userQuery\.isPending/);
  assert.match(detailSource, /userQuery\.isError/);
  assert.match(detailSource, /if \(!user\)/);
  assert.match(detailSource, /return <UserDetailSheet user=\{user\} \/>/);
});

test('deep-link name cell points at /admin/users/$userId under a router', async () => {
  const rootRoute = createRootRoute({
    component: () => (
      <div>
        <UserNameLink user={sampleUser as never} />
        <Outlet />
      </div>
    ),
  });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/users',
    component: () => null,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/users/$userId',
    component: () => null,
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/admin/users'] }),
    routeTree: rootRoute.addChildren([listRoute, detailRoute]),
  });
  await router.load();

  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  assert.match(html, /data-testid="user-name-link"/);
  assert.match(html, /href="\/admin\/users\/user-deep-1"/);
  assert.match(html, /Deep Link User/);
});

test('route overlay tree keeps list parent while detail child path is active', async () => {
  const rootRoute = createRootRoute({ component: Outlet });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/users',
    component: () => (
      <div data-testid="users-list-shell">
        <span>Users list stays mounted</span>
        <Outlet />
      </div>
    ),
  });
  const detailRoute = createRoute({
    getParentRoute: () => listRoute,
    path: '$userId',
    component: () => (
      <div data-testid="user-detail-route-body">Deep Link User</div>
    ),
  });
  const router = createRouter({
    history: createMemoryHistory({
      initialEntries: [`/admin/users/${sampleUser.id}`],
    }),
    routeTree: rootRoute.addChildren([listRoute.addChildren([detailRoute])]),
  });
  await router.load();

  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  assert.match(html, /data-testid="users-list-shell"/);
  assert.match(html, /Users list stays mounted/);
  assert.match(html, /data-testid="user-detail-route-body"/);
  assert.match(html, /Deep Link User/);
  assert.equal(router.state.location.pathname, `/admin/users/${sampleUser.id}`);
});

test('routeTree.gen registers the users detail child route', () => {
  const tree = readFileSync(
    resolve(process.cwd(), 'src/routeTree.gen.ts'),
    'utf8'
  );
  assert.match(tree, /users\.\$userId/);
  assert.match(tree, /\/admin\/users\/\$userId/);
  assert.match(tree, /AdminUsersUserIdRoute/);
});
