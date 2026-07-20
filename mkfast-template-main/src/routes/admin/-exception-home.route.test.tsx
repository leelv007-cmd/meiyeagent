import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
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
const { AdminExceptionHome } = await import('@/p1/admin-exception-home');
const { assertNoAckAssignOwnerUi, buildExceptionHomeView } = await import(
  '@/p1/admin-exception-home-model'
);
const { buildCapabilityRegistry } = await import(
  '@/p1/admin-capability-registry-model'
);

test('admin index route exports home page (no models redirect)', () => {
  assert.equal(typeof routeModule.AdminHomePage, 'function');
  assert.ok(routeModule.Route, 'createFileRoute Route export required');
  // Source contract: index must not redirect to models.
  assert.equal(typeof routeModule.AdminHomePage, 'function');
});

test('admin home body is exception-first (list or empty panorama)', () => {
  const now = '2026-07-20T12:00:00.000Z';
  const defaultHtml = renderToStaticMarkup(
    <AdminExceptionHome input={{ now }} />
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
    <AdminExceptionHome view={buildExceptionHomeView({ registry: healthy, now })} />
  );
  assert.match(emptyHtml, /当前无待处理异常/);
  assert.match(emptyHtml, /data-testid="exception-panorama-stats"/);
  assert.match(emptyHtml, /href="\/admin\/capabilities"/);
});
