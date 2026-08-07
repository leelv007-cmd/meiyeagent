/**
 * #426 restyle residual: page header already shows admin_audit_title();
 * the panel body must not repeat that same title.
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

const routeModule = await import('./audit');
const { AdminAuditControl } = await import('@/p1/admin-audit-control');
const { admin_audit_title } = await import('@/locale/paraglide/messages');

test('admin audit route module exposes its page through Route', () => {
  assert.equal(typeof routeModule.Route.options.component, 'function');
  assert.ok(
    routeModule.Route,
    'createFileRoute Route export required for Z2 wiring'
  );
});

/**
 * #426: page header owns `admin_audit_title()`; panel chrome keeps the
 * refresh control but must not restate the same heading.
 */
test('audit control panel does not repeat the page header title', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminAuditControl />
    </QueryClientProvider>
  );
  assert.match(html, /data-testid="admin-audit-control"/);
  assert.match(html, /刷新|Refresh/i);
  const pageTitle = admin_audit_title();
  assert.doesNotMatch(
    html,
    new RegExp(pageTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
});
