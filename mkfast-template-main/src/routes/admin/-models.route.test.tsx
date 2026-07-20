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

const { SidebarProvider } = await import('@/components/ui/sidebar');
const { p1QueryKeys } = await import('@/p1/query-keys');
const { ModelsPage } = await import('./models');

test('admin models route renders execution mode and adapter assembly controls', async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('admin-config', 'config_list'), [
    ...[
      ['model.execution.mode', 'recorded'],
      ['model.media.execution.mode', 'disabled'],
      ['byok.adapter.assembly', 'recorded'],
      ['douyin.adapter.assembly', 'recorded'],
      ['platform.defaultModel.copy', 'llm-copy-live'],
      ['platform.defaultModel.image', 'image-live'],
      ['platform.defaultModel.video', 'video-live'],
      ['platform.defaultModel.audio', 'audio-live'],
    ].map(([key, value], index) => ({
      activationEvidenceStatus: 'recorded_only',
      actorId: 'platform-admin',
      correlationId: `models-route-${index}`,
      createdAt: '2026-07-15T10:02:00.000Z',
      effectiveValue: value,
      key,
      reason: 'route behavior test',
      revision: 1,
      rolledBackToRevision: null,
      scope: 'global',
      status: 'applied',
      storedValue: value,
      wired: true,
    })),
  ]);

  const rootRoute = createRootRoute({ component: Outlet });
  const modelsRoute = createRoute({
    component: ModelsPage,
    getParentRoute: () => rootRoute,
    path: '/admin/models',
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/admin/models'] }),
    routeTree: rootRoute.addChildren([modelsRoute]),
  });
  await router.load();

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <RouterProvider router={router} />
      </SidebarProvider>
    </QueryClientProvider>
  );

  assert.match(html, /模型执行模式/);
  assert.match(html, /媒体执行模式/);
  assert.match(html, /BYOK 适配器装配/);
  assert.match(html, /抖音适配器装配/);
  assert.match(html, /platform\.defaultModel\.copy/);
  assert.match(html, /platform\.defaultModel\.image/);
  assert.match(html, /platform\.defaultModel\.video/);
  assert.match(html, /platform\.defaultModel\.audio/);
  assert.match(html, /未接入（pilot 前）/);
});
