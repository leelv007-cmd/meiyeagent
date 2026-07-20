import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import {
  QueryClient,
  QueryClientProvider,
  type QueryFunction,
} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { readProductEnvelope } from './client';

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

test('the unified workbench renders a source failure for failed product-state envelopes', async () => {
  const [
    { SidebarProvider },
    { GlobalCommandProvider },
    { p1QueryKeys },
    { UnifiedCreationWorkbench },
  ] = await Promise.all([
    import('../components/ui/sidebar'),
    import('./global-command-palette'),
    import('../p1/query-keys'),
    import('./unified-creation-workbench'),
  ]);
  const productQueryKey = ['product', 'creative-sources'] as const;
  type ProductQuery = QueryFunction<unknown, typeof productQueryKey>;
  let productQuery: ProductQuery | undefined;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false } },
  });
  const queryDefaults = queryClient.getDefaultOptions().queries as
    | (NonNullable<ReturnType<QueryClient['getDefaultOptions']>['queries']> & {
        _experimental_beforeQuery?: (options: {
          queryFn?: unknown;
          queryKey: readonly unknown[];
        }) => void;
      })
    | undefined;
  assert.ok(queryDefaults);
  queryDefaults._experimental_beforeQuery = (options) => {
    if (
      options.queryKey.length === productQueryKey.length &&
      options.queryKey.every(
        (part, index) => part === productQueryKey[index]
      ) &&
      typeof options.queryFn === 'function'
    ) {
      productQuery = options.queryFn as ProductQuery;
    }
  };
  queryClient.setQueryData(
    p1QueryKeys.request('operations', 'creative_workbench'),
    { assets: [], contents: [], events: [], jobs: [], works: [] }
  );

  const rootRoute = createRootRoute({ component: Outlet });
  const workbenchRoute = createRoute({
    component: () =>
      createElement(
        SidebarProvider,
        null,
        createElement(
          GlobalCommandProvider,
          null,
          createElement(UnifiedCreationWorkbench)
        )
      ),
    getParentRoute: () => rootRoute,
    path: '/',
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: rootRoute.addChildren([workbenchRoute]),
  });
  await router.load();
  const renderWorkbench = () =>
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router })
      )
    );

  renderWorkbench();
  assert.ok(productQuery);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(input, '/api/core/product/state');
    return Response.json(
      {
        error: {
          code: 'PRODUCT_STATE_FAILED',
          message: 'raw upstream product-state failure',
        },
        meta: { correlationId: 'corr-workbench-source-failure' },
      },
      { status: 500 }
    );
  };
  try {
    await assert.rejects(
      queryClient.fetchQuery({
        queryFn: productQuery,
        queryKey: productQueryKey,
        retry: false,
      }),
      /\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528/u
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const html = renderWorkbench();
  assert.match(html, /已有素材暂时无法读取/u);
  assert.match(html, /重新读取素材/u);
  assert.doesNotMatch(html, /raw upstream product-state failure/u);
});

test('product client replaces server messages and details with stable copy', async () => {
  const response = Response.json(
    {
      error: {
        code: 'PROVIDER_SECRET',
        details: { reason: 'raw provider key and stack trace' },
        message: 'upstream 500 with private payload',
      },
      meta: { correlationId: 'corr-safe-product-123' },
    },
    { status: 500 }
  );

  await assert.rejects(readProductEnvelope(response), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /服务暂时不可用/);
    assert.match(error.message, /corr-safe-product-123/);
    assert.doesNotMatch(error.message, /provider|private|stack|upstream/i);
    return true;
  });
});

test('product client also hides malformed response bodies', async () => {
  const response = new Response('<private upstream html>', { status: 502 });

  await assert.rejects(readProductEnvelope(response), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /服务暂时不可用/);
    assert.doesNotMatch(error.message, /private|html|upstream/i);
    return true;
  });
});

test('workbench keeps an unready projection in bounded recovery before failing closed', async () => {
  const {
    isWorkbenchProjectionPreparing,
    shouldRetryWorkbenchProjection,
    workbenchProjectionRetryDelay,
  } = await import('./unified-creation-workbench');

  assert.equal(isWorkbenchProjectionPreparing(false, true), true);
  assert.equal(isWorkbenchProjectionPreparing(false, false), false);
  assert.equal(isWorkbenchProjectionPreparing(true, true), false);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map(workbenchProjectionRetryDelay),
    [500, 1_000, 2_000, 4_000, 4_000]
  );
  assert.equal(shouldRetryWorkbenchProjection(0), true);
  assert.equal(shouldRetryWorkbenchProjection(3), true);
  assert.equal(shouldRetryWorkbenchProjection(4), false);
});

test('workbench can replace an adopted candidate without re-adopting the same revision choice', async () => {
  const { canAdoptHarnessCandidate } = await import(
    './unified-creation-workbench'
  );

  assert.equal(canAdoptHarnessCandidate(false, undefined, 'candidate-a'), true);
  assert.equal(
    canAdoptHarnessCandidate(false, 'candidate-a', 'candidate-a'),
    false
  );
  assert.equal(
    canAdoptHarnessCandidate(false, 'candidate-a', 'candidate-b'),
    true
  );
  assert.equal(
    canAdoptHarnessCandidate(true, 'candidate-a', 'candidate-b'),
    false
  );
});

test('Harness launch failures preserve typed recovery paths', async () => {
  const [{ P1RequestError }, { harnessLaunchFailureKind }] = await Promise.all([
    import('../p1/client'),
    import('./unified-creation-workbench'),
  ]);

  assert.equal(
    harnessLaunchFailureKind(
      new P1RequestError('quota exhausted', 'INSUFFICIENT_ENTITLEMENT')
    ),
    'quota'
  );
  assert.equal(
    harnessLaunchFailureKind(
      new P1RequestError(
        'grounding incomplete',
        'CREATIVE_GROUNDING_INCOMPLETE'
      )
    ),
    'grounding'
  );
  assert.equal(
    harnessLaunchFailureKind(
      new P1RequestError(
        'authorization required',
        'ASSET_AUTHORIZATION_REQUIRED'
      )
    ),
    'authorization'
  );
  assert.equal(
    harnessLaunchFailureKind(
      new P1RequestError('unknown failure', 'HARNESS_PROVIDER_FAILED')
    ),
    'retry'
  );
});

test('persisted Harness candidates expose only one primary action', async () => {
  const { harnessCandidateActionVariant } = await import(
    './unified-creation-workbench'
  );

  assert.equal(harnessCandidateActionVariant(false, true), 'default');
  assert.equal(harnessCandidateActionVariant(false, false), 'outline');
  assert.equal(harnessCandidateActionVariant(true, true), 'secondary');
  assert.equal(harnessCandidateActionVariant(true, false), 'secondary');
});
