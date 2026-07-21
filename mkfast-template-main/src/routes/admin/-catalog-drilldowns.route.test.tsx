/**
 * Seven-page drilldown reachability + D-048 ops-path ban (J3).
 * Memory-router / pure SSR style (no RTL); shared wiring untouched.
 */
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

const {
  ADMIN_DRILLDOWN_PAGES,
  assertOpsPathHasNoD048BannedControls,
  buildCapabilityCatalog,
  listDrilldownReachability,
} = await import('@/p1/admin-capability-catalog-model');
const { CapabilityDrilldownBanner } = await import(
  '@/components/admin/capability/capability-drilldown-banner'
);
const { CapabilityCatalogPanel } = await import(
  '@/components/admin/capability/capability-catalog-panel'
);

/** Mirrors `resolveAdminP1Redirect` targets (p1.tsx compat; paths unchanged in J3). */
function resolveAdminP1Redirect(tab: unknown): string {
  if (tab === 'templates') return '/admin/templates';
  if (tab === 'integrations') return '/admin/integrations';
  return '/admin/models';
}

test('seven drilldown pages are reachable from catalog projection', () => {
  const view = buildCapabilityCatalog();
  const fromCatalog = view.domains.flatMap((section) =>
    section.evidenceDrilldowns.map((d) => d.pageId)
  );
  const reachability = listDrilldownReachability();

  assert.equal(reachability.length, 7);
  for (const page of ADMIN_DRILLDOWN_PAGES) {
    assert.ok(
      fromCatalog.includes(page.pageId) || page.domain === 'task_orchestration',
      `${page.pageId} should appear under its domain evidence list`
    );
    assert.ok(
      reachability.some(
        (row) => row.pageId === page.pageId && row.path === page.path
      ),
      `${page.pageId} missing from reachability`
    );
  }

  // Every non-empty domain evidence link is one of the seven.
  for (const pageId of fromCatalog) {
    assert.ok(
      ADMIN_DRILLDOWN_PAGES.some((page) => page.pageId === pageId),
      `unknown pageId ${pageId}`
    );
  }
});

test('SSR catalog evidence anchors cover all seven admin paths', () => {
  const html = renderToStaticMarkup(
    <CapabilityCatalogPanel view={buildCapabilityCatalog()} />
  );

  for (const page of ADMIN_DRILLDOWN_PAGES) {
    assert.match(
      html,
      new RegExp(
        `data-page-id="${page.pageId}"[\\s\\S]*?href="${page.path.replace(/\//g, '\\/')}"|href="${page.path.replace(/\//g, '\\/')}"[\\s\\S]*?data-page-id="${page.pageId}"`
      ),
      `catalog missing reachable anchor for ${page.pageId} → ${page.path}`
    );
    // Simpler path presence check (href always present on drilldown cards).
    assert.match(html, new RegExp(`href="${page.path}"`));
  }
});

test('SSR drilldown banners are domain-tagged for memory-router page bodies', () => {
  const expectedDomain: Record<string, string> = {
    users: 'account_and_commerce',
    plans: 'account_and_commerce',
    redemptions: 'account_and_commerce',
    models: 'ai_supply_and_generation',
    templates: 'content_and_assets',
    integrations: 'external_integrations',
    audit: 'runtime_and_governance',
  };

  for (const page of ADMIN_DRILLDOWN_PAGES) {
    const html = renderToStaticMarkup(
      <CapabilityDrilldownBanner pageId={page.pageId} />
    );
    assert.match(html, /data-testid="capability-drilldown-banner"/);
    assert.match(
      html,
      new RegExp(`data-domain="${expectedDomain[page.pageId]}"`)
    );
    assert.match(html, /功能：/);
    assert.match(html, /用户影响：/);
    assert.doesNotMatch(html, /workspaceId/);
  }
});

test('p1.tsx compat redirect targets remain among seven regrouped pages', () => {
  assert.equal(resolveAdminP1Redirect(undefined), '/admin/models');
  assert.equal(resolveAdminP1Redirect('models'), '/admin/models');
  assert.equal(resolveAdminP1Redirect('templates'), '/admin/templates');
  assert.equal(resolveAdminP1Redirect('integrations'), '/admin/integrations');

  for (const path of [
    '/admin/models',
    '/admin/templates',
    '/admin/integrations',
  ]) {
    assert.ok(
      ADMIN_DRILLDOWN_PAGES.some((page) => page.path === path),
      `p1 redirect target ${path} must stay a catalog drilldown`
    );
  }
});

test('runtime_and_governance hosts health block via audit drilldown only', () => {
  const view = buildCapabilityCatalog();
  const runtime = view.domains.find(
    (section) => section.domain === 'runtime_and_governance'
  );
  assert.ok(runtime);
  const health = runtime.evidenceDrilldowns.filter(
    (d) => d.hostsOperationsHealth
  );
  assert.equal(health.length, 1);
  assert.equal(health[0]?.pageId, 'audit');
  assert.equal(health[0]?.path, '/admin/audit');

  const auditBanner = renderToStaticMarkup(
    <CapabilityDrilldownBanner pageId="audit" />
  );
  assert.match(auditBanner, /data-hosts-health="true"/);
  assert.match(auditBanner, /运行健康区块/);
});

test('D-048 ban: catalog ops path HTML has no raw JSON / env / SQL / code / CLI controls', () => {
  const html = renderToStaticMarkup(
    <CapabilityCatalogPanel view={buildCapabilityCatalog()} />
  );
  assert.deepEqual(assertOpsPathHasNoD048BannedControls(html), []);
  assert.match(html, /data-ops-path="daily"/);
  assert.match(html, /技术移交/);
  // Ops path explains handoff; must not advertise a fake one-click repair control.
  assert.match(html, /不在运营界面伪装成一键修复/);
  assert.doesNotMatch(html, /data-testid="one-click-repair"/);
  // Explicit ban surface ids must be absent on daily ops catalog.
  for (const id of [
    'code-editor',
    'sql-console',
    'env-editor',
    'raw-json-editor',
    'cli-console',
  ]) {
    assert.doesNotMatch(html, new RegExp(`data-testid="${id}"`));
  }
});
