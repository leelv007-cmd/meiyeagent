/**
 * V31-22: ops-console route + panel chrome behaviour assertions.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

const routeModule = await import('./ops-console');
const { AdminOpsConsoleControl } = await import(
  '@/p1/admin-ops-console-control'
);

test('admin ops-console route module exposes its page through Route', () => {
  assert.equal(typeof routeModule.Route.options.component, 'function');
  assert.ok(routeModule.Route, 'createFileRoute Route export required');
});

test('ops-console control panel renders release / tool policy / kill switch / audit regions', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminOpsConsoleControl />
    </QueryClientProvider>,
  );
  assert.match(html, /data-testid="admin-ops-console"/);
  assert.match(html, /data-testid="admin-ops-console-refresh"/);
  assert.match(html, /data-testid="admin-ops-console-releases"/);
  assert.match(html, /data-testid="admin-ops-console-tool-policy"/);
  assert.match(html, /data-testid="admin-ops-console-kill-switch"/);
  assert.match(html, /data-testid="admin-ops-console-audit"/);
  assert.match(html, /data-testid="admin-ops-console-rollback-reason"/);
  assert.match(html, /data-testid="admin-ops-console-rollback-evidence"/);
  assert.match(html, /data-testid="admin-ops-console-promote-submit"/);
});
