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

const routeModule = await import('./capabilities');
const { AdminCapabilityCatalog } = await import(
  '@/p1/admin-capability-catalog'
);
const { AdminCapabilityRegistry } = await import(
  '@/p1/admin-capability-registry'
);
const { buildCapabilityRegistry } = await import(
  '@/p1/admin-capability-registry-model'
);
const { assertOpsPathHasNoD048BannedControls } = await import(
  '@/p1/admin-capability-catalog-model'
);

test('admin capabilities route module exports Route and CapabilitiesPage', () => {
  assert.equal(typeof routeModule.CapabilitiesPage, 'function');
  assert.ok(
    routeModule.Route,
    'createFileRoute Route export required for Z2 wiring'
  );
});

test('capabilities page body includes two-level catalog + registry six questions', () => {
  const catalogHtml = renderToStaticMarkup(<AdminCapabilityCatalog />);
  assert.match(catalogHtml, /能力目录（两层 IA）/);
  assert.match(catalogHtml, /data-testid="capability-catalog-panel"/);
  assert.match(catalogHtml, /账号与商业化/);
  assert.match(catalogHtml, /AI 供应与生成/);
  assert.match(catalogHtml, /data-page-id="models"/);
  assert.match(catalogHtml, /data-page-id="audit"/);
  assert.deepEqual(assertOpsPathHasNoD048BannedControls(catalogHtml), []);

  const registryHtml = renderToStaticMarkup(
    <AdminCapabilityRegistry view={buildCapabilityRegistry()} />
  );
  assert.match(registryHtml, /能力清单全景/);
  assert.match(registryHtml, /data-testid="capability-registry-panel"/);
  assert.match(registryHtml, /模型供应商与路由质量/);
  assert.match(registryHtml, /音频生成/);
  assert.match(registryHtml, /D-051 六问字段/);
});
