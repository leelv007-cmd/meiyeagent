import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITY_INVENTORY } from '@meiye/contracts';
import {
  ADMIN_DRILLDOWN_PAGE_IDS,
  ADMIN_DRILLDOWN_PAGES,
  CAPABILITY_CATALOG_L1_ORDER,
  D048_BANNED_OPS_CONTROLS,
  assertL1ExcludesWorkspaceId,
  assertOpsPathHasNoD048BannedControls,
  buildCapabilityCatalog,
  buildRedactedHandoffContext,
  getCatalogDomain,
  getDrilldownDomainContext,
  getDrilldownPage,
  getDrilldownPageByPath,
  listDrilldownReachability,
} from './admin-capability-catalog-model';

test('two-level catalog projects all six L1 domains in D-054 order', () => {
  const view = buildCapabilityCatalog();
  assert.equal(view.revision, CAPABILITY_INVENTORY.revision);
  assert.deepEqual(
    view.domains.map((section) => section.domain),
    [...CAPABILITY_CATALOG_L1_ORDER]
  );
  assert.equal(view.domains.length, 6);

  for (const section of view.domains) {
    assert.ok(section.title.length > 0, section.domain);
    assert.ok(section.functionSummary.length > 0, section.domain);
    assert.ok(section.userImpact.length > 0, section.domain);
  }
});

test('every inventory capability appears under its L1 domain', () => {
  const view = buildCapabilityCatalog();
  const projectedIds = view.domains.flatMap((section) =>
    section.capabilities.map((cap) => cap.id)
  );
  assert.equal(projectedIds.length, CAPABILITY_INVENTORY.items.length);

  for (const item of CAPABILITY_INVENTORY.items) {
    const section = getCatalogDomain(view, item.group);
    assert.ok(section, `missing domain ${item.group}`);
    assert.ok(
      section.capabilities.some((cap) => cap.id === item.id),
      `${item.id} missing from ${item.group}`
    );
  }
});

test('L2 technical dependencies and evidence drilldowns are present', () => {
  const view = buildCapabilityCatalog();

  const ai = getCatalogDomain(view, 'ai_supply_and_generation');
  assert.ok(ai);
  assert.ok(ai.technicalDependencies.length > 0);
  assert.ok(ai.technicalDependencies.some((dep) => dep.id === 'job_queue_harness'));
  assert.ok(ai.evidenceDrilldowns.some((d) => d.pageId === 'models'));

  const commerce = getCatalogDomain(view, 'account_and_commerce');
  assert.ok(commerce);
  assert.deepEqual(
    commerce.evidenceDrilldowns.map((d) => d.pageId).sort(),
    ['plans', 'redemptions', 'users'].sort()
  );

  const runtime = getCatalogDomain(view, 'runtime_and_governance');
  assert.ok(runtime);
  const audit = runtime.evidenceDrilldowns.find((d) => d.pageId === 'audit');
  assert.ok(audit);
  assert.equal(audit.hostsOperationsHealth, true);

  const content = getCatalogDomain(view, 'content_and_assets');
  assert.ok(content?.evidenceDrilldowns.some((d) => d.pageId === 'templates'));

  const integrations = getCatalogDomain(view, 'external_integrations');
  assert.ok(
    integrations?.evidenceDrilldowns.some((d) => d.pageId === 'integrations')
  );
});

test('seven-page regroup maps every drilldown under a capability domain', () => {
  assert.equal(ADMIN_DRILLDOWN_PAGES.length, 7);
  assert.deepEqual(
    ADMIN_DRILLDOWN_PAGE_IDS.slice().sort(),
    ADMIN_DRILLDOWN_PAGES.map((p) => p.pageId).sort()
  );

  const reachability = listDrilldownReachability();
  assert.equal(reachability.length, 7);

  const expectedPaths = [
    '/admin/users',
    '/admin/plans',
    '/admin/redemptions',
    '/admin/models',
    '/admin/templates',
    '/admin/integrations',
    '/admin/audit',
  ];
  for (const path of expectedPaths) {
    const page = getDrilldownPageByPath(path);
    assert.ok(page, `missing page for ${path}`);
    assert.ok(
      CAPABILITY_CATALOG_L1_ORDER.includes(page.domain),
      `${path} domain not in L1`
    );
  }

  const healthPages = reachability.filter((row) => row.hostsOperationsHealth);
  assert.equal(healthPages.length, 1);
  assert.equal(healthPages[0]?.pageId, 'audit');
  assert.equal(healthPages[0]?.domain, 'runtime_and_governance');
});

test('operator language: capability / function / user impact; workspaceId not in L1', () => {
  const view = buildCapabilityCatalog();
  assert.equal(view.l1ExcludesWorkspaceId, true);
  assert.deepEqual(assertL1ExcludesWorkspaceId(view), []);

  for (const section of view.domains) {
    assert.match(section.functionSummary, /./);
    assert.match(section.userImpact, /影响/);
    // L1 titles are operator Chinese domains, not workspace keys.
    assert.doesNotMatch(section.title, /workspace/i);
    assert.doesNotMatch(section.functionSummary, /workspaceId/i);
    assert.doesNotMatch(section.userImpact, /workspaceId/i);
  }

  for (const page of ADMIN_DRILLDOWN_PAGES) {
    const ctx = getDrilldownDomainContext(page.pageId);
    assert.ok(ctx);
    assert.equal(ctx.domain.domain, page.domain);
    assert.ok(ctx.page.functionSummary.length > 0);
    assert.ok(ctx.page.userImpact.length > 0);
    assert.doesNotMatch(ctx.page.functionSummary, /workspaceId/i);
  }
});

test('D-048: ops path ban list + redacted handoff is not one-click repair', () => {
  const view = buildCapabilityCatalog();
  assert.deepEqual(view.opsPathBannedControls, [...D048_BANNED_OPS_CONTROLS]);
  assert.ok(view.opsPathBannedControls.includes('raw-json-editor'));
  assert.ok(view.opsPathBannedControls.includes('env-editor'));
  assert.ok(view.opsPathBannedControls.includes('sql-console'));
  assert.ok(view.opsPathBannedControls.includes('code-editor'));
  assert.ok(view.opsPathBannedControls.includes('cli-console'));

  const clean = '<div data-testid="capability-catalog-panel" data-ops-path="daily"></div>';
  assert.deepEqual(assertOpsPathHasNoD048BannedControls(clean), []);

  const dirty =
    '<div data-testid="raw-json-editor"></div><div data-ops-control="env"></div>';
  const hits = assertOpsPathHasNoD048BannedControls(dirty);
  assert.ok(hits.length >= 2);

  const handoff = buildRedactedHandoffContext({
    domain: 'ai_supply_and_generation',
    capabilityId: 'model_supply_routing_quality',
    pageId: 'models',
    correlationHints: ['catalog-head'],
  });
  assert.equal(handoff.kind, 'technical_handoff');
  assert.equal(handoff.oneClickRepair, false);
  assert.equal(handoff.pagePath, '/admin/models');
  assert.match(handoff.redactedContext.note, /not a one-click repair/i);
  assert.ok(!('secret' in handoff.redactedContext));
});

test('getDrilldownPage resolves all seven page ids', () => {
  for (const pageId of ADMIN_DRILLDOWN_PAGE_IDS) {
    const page = getDrilldownPage(pageId);
    assert.ok(page, pageId);
    assert.equal(page.pageId, pageId);
    assert.match(page.path, /^\/admin\//);
  }
});
