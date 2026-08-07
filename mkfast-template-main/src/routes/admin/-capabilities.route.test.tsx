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
const {
  admin_capability_capability_catalog_two_level_ia_6a9c70b1,
  admin_capability_capability_inventory_panorama_455d7cdf,
  admin_capability_d_051_six_question_fields_b4aaad1c,
  admin_capability_registry_section_title,
} = await import('@/locale/paraglide/messages');

test('admin capabilities route module exposes its page through Route', () => {
  assert.equal(typeof routeModule.Route.options.component, 'function');
  assert.ok(
    routeModule.Route,
    'createFileRoute Route export required for Z2 wiring'
  );
});

test('capabilities page body includes two-level catalog + registry six questions', () => {
  const catalogHtml = renderToStaticMarkup(<AdminCapabilityCatalog />);
  assert.match(
    catalogHtml,
    new RegExp(
      admin_capability_capability_catalog_two_level_ia_6a9c70b1().replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      )
    )
  );
  assert.match(catalogHtml, /data-testid="capability-catalog-panel"/);
  assert.match(catalogHtml, /账号与商业化/);
  assert.match(catalogHtml, /AI 供应与生成/);
  assert.match(catalogHtml, /data-page-id="models"/);
  assert.match(catalogHtml, /data-page-id="audit"/);
  assert.deepEqual(assertOpsPathHasNoD048BannedControls(catalogHtml), []);

  const registryHtml = renderToStaticMarkup(
    <AdminCapabilityRegistry view={buildCapabilityRegistry()} />
  );
  assert.match(
    registryHtml,
    new RegExp(
      admin_capability_capability_inventory_panorama_455d7cdf().replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      )
    )
  );
  assert.match(registryHtml, /data-testid="capability-registry-panel"/);
  assert.match(registryHtml, /模型供应商与路由质量/);
  assert.match(registryHtml, /音频生成/);
  assert.match(
    registryHtml,
    new RegExp(
      admin_capability_d_051_six_question_fields_b4aaad1c().replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      )
    )
  );
});

test('capabilities registry section title uses Paraglide messages', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const source = readFileSync(
    resolve(process.cwd(), 'src/routes/admin/capabilities.tsx'),
    'utf8'
  );
  // Route source must call the section title message (no bare CJK h2).
  assert.match(source, /admin_capability_registry_section_title\(\)/);
  assert.ok(admin_capability_registry_section_title().length > 0);
});
