/**
 * #426 restyle residual: page header already shows admin_sensitive_words_title
 * ("敏感词治理"); the panel body must not restate a near-synonym title or the
 * same description block.
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

const routeModule = await import('./sensitive-words');
const { AdminSensitiveWordsControl } = await import(
  '@/p1/admin-sensitive-words-control'
);

test('admin sensitive-words route module exposes its page through Route', () => {
  assert.equal(typeof routeModule.Route.options.component, 'function');
  assert.ok(
    routeModule.Route,
    'createFileRoute Route export required for Z2 wiring'
  );
});

/**
 * #426: page header owns 敏感词治理 + description; panel drops 违禁词库 and
 * the restated description, keeping only chrome (refresh) + CRUD body.
 */
test('sensitive-words control panel does not repeat the page header title', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminSensitiveWordsControl />
    </QueryClientProvider>
  );
  assert.match(html, /data-testid="admin-sensitive-words"/);
  assert.match(html, /data-testid="admin-sensitive-words-refresh"/);
  assert.doesNotMatch(html, /违禁词库/);
  assert.doesNotMatch(html, /美业专项词库/);
  // CRUD form remains.
  assert.match(html, /data-testid="admin-sensitive-words-create"/);
});
