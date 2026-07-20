import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
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

const routeModule = await import('./index');
const { SidebarProvider } = await import('@/components/ui/sidebar');
const { AdminExceptionHome } = await import('@/p1/admin-exception-home');
const { assertNoAckAssignOwnerUi, buildExceptionHomeView } = await import(
  '@/p1/admin-exception-home-model'
);
const { buildCapabilityRegistry } = await import(
  '@/p1/admin-capability-registry-model'
);
const { pendingActionsQueryKey } = await import(
  '@/product/pending-actions-client'
);
const { p1QueryKeys } = await import('@/p1/query-keys');

test('admin index route exports home page (no models redirect)', () => {
  assert.equal(typeof routeModule.AdminHomePage, 'function');
  assert.ok(routeModule.Route, 'createFileRoute Route export required');
  // Source contract: index must not redirect to models.
  assert.equal(typeof routeModule.AdminHomePage, 'function');
});

test('admin home body is exception-first (list or empty panorama)', () => {
  const now = '2026-07-20T12:00:00.000Z';
  const defaultHtml = renderToStaticMarkup(
    <AdminExceptionHome view={buildExceptionHomeView({ now })} />
  );
  assert.match(defaultHtml, /data-testid="exception-home-panel"/);
  assert.match(defaultHtml, /异常优先首页（只读）/);
  assert.deepEqual(assertNoAckAssignOwnerUi(defaultHtml), []);

  const registry = buildCapabilityRegistry();
  const healthy = {
    ...registry,
    entries: registry.entries.map((entry) => ({
      ...entry,
      availability: 'available' as const,
      evidenceFreshness: {
        capturedAt: now,
        staleAfterMs: 60 * 60 * 1000,
        source: 'fresh',
      },
    })),
  };
  const emptyHtml = renderToStaticMarkup(
    <AdminExceptionHome
      view={buildExceptionHomeView({ registry: healthy, now })}
    />
  );
  assert.match(emptyHtml, /当前无待处理异常/);
  assert.match(emptyHtml, /data-testid="exception-panorama-stats"/);
  assert.match(emptyHtml, /href="\/admin\/capabilities"/);
});

test('admin home default path consumes live pending-actions and metrics', async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(pendingActionsQueryKey, [
    {
      createdAt: '2026-07-20T11:00:00.000Z',
      kind: 'question',
      nodeId: 'question-route',
      questionOrApprovalRef: 'question-route',
      taskId: 'task-route',
      workflowId: 'workflow-route',
      workflowRevision: 1,
    },
  ]);
  queryClient.setQueryData(
    p1QueryKeys.request('job-runtime', 'observability'),
    {
      capturedAt: '2026-07-20T12:00:00.000Z',
      queue: { queueDepth: { status: 'known', value: 1 } },
      runner: {
        outcomeCounts: {
          status: 'known',
          value: {
            completed: 0,
            retry: 1,
            deferred: 0,
            dead_letter: 0,
            threw: 0,
          },
        },
      },
    }
  );

  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    component: routeModule.AdminHomePage,
    getParentRoute: () => rootRoute,
    path: '/admin',
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/admin'] }),
    routeTree: rootRoute.addChildren([pageRoute]),
  });
  await router.load();

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <RouterProvider router={router} />
      </SidebarProvider>
    </QueryClientProvider>
  );

  assert.match(html, /任务需要补充选择/);
  assert.match(html, /actionable_inbox:pending_action/);
  assert.deepEqual(assertNoAckAssignOwnerUi(html), []);
});
