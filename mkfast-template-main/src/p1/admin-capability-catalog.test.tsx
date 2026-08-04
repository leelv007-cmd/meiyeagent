import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CAPABILITY_INVENTORY } from '@/p1/capability-inventory';
import { AdminCapabilityCatalog } from './admin-capability-catalog';
import {
  CAPABILITY_CATALOG_L1_ORDER,
  assertOpsPathHasNoD048BannedControls,
  buildCapabilityCatalog,
} from './admin-capability-catalog-model';
import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';

test('SSR catalog renders six L1 domains with operator language', () => {
  const html = renderToStaticMarkup(<AdminCapabilityCatalog />);

  assert.match(html, /data-testid="capability-catalog-panel"/);
  assert.match(html, /data-ops-path="daily"/);
  assert.match(html, /data-l1-excludes-workspace-id="true"/);
  assert.match(html, /能力目录（两层 IA）/);
  assert.match(html, /功能：/);
  assert.match(html, /用户影响：/);

  for (const domain of CAPABILITY_CATALOG_L1_ORDER) {
    assert.match(
      html,
      new RegExp(`data-domain="${domain}"`),
      `missing L1 section ${domain}`
    );
  }

  assert.match(html, /账号与商业化/);
  assert.match(html, /AI 供应与生成/);
  assert.match(html, /任务编排/);
  assert.match(html, /内容与资产/);
  assert.match(html, /外部集成/);
  assert.match(html, /运行与治理/);

  // L1 IA keys / domain titles must not elevate workspaceId (flag + section bodies).
  assert.match(html, /data-l1-excludes-workspace-id="true"/);
  for (const domain of CAPABILITY_CATALOG_L1_ORDER) {
    assert.doesNotMatch(domain, /workspace/i);
  }
});

test('SSR catalog lists inventory capabilities and eight evidence drilldowns', () => {
  const html = renderToStaticMarkup(<AdminCapabilityCatalog />);

  for (const item of CAPABILITY_INVENTORY.items) {
    assert.match(
      html,
      new RegExp(`data-capability-id="${item.id}"`),
      `catalog missing capability ${item.id}`
    );
  }

  for (const pageId of [
    'users',
    'plans',
    'redemptions',
    'models',
    'templates',
    'skills',
    'integrations',
    'audit',
  ]) {
    assert.match(
      html,
      new RegExp(`data-page-id="${pageId}"`),
      `missing evidence drilldown ${pageId}`
    );
  }

  assert.match(html, /href="\/admin\/models"/);
  assert.match(html, /href="\/admin\/audit"/);
  assert.match(html, /data-hosts-health="true"/);
  assert.match(html, /含运行健康/);
  assert.match(html, /data-testid="catalog-l2-dependencies"/);
  assert.match(html, /data-testid="catalog-handoff-note"/);
  assert.match(html, /不在运营界面伪装成一键修复/);
});

test('SSR daily ops catalog path has zero D-048 banned controls', () => {
  const html = renderToStaticMarkup(<AdminCapabilityCatalog />);
  assert.deepEqual(assertOpsPathHasNoD048BannedControls(html), []);
  assert.doesNotMatch(html, /data-testid="code-editor"/);
  assert.doesNotMatch(html, /data-testid="sql-console"/);
  assert.doesNotMatch(html, /data-testid="env-editor"/);
  assert.doesNotMatch(html, /data-testid="raw-json-editor"/);
  assert.doesNotMatch(html, /data-testid="cli-console"/);
  assert.doesNotMatch(html, /data-ops-control="(code|sql|env|raw-json|cli)"/);
});

test('SSR drilldown banners expose domain regroup for all eight pages', () => {
  const pageIds = [
    'users',
    'plans',
    'redemptions',
    'models',
    'templates',
    'skills',
    'integrations',
    'audit',
  ] as const;

  for (const pageId of pageIds) {
    const html = renderToStaticMarkup(
      <CapabilityDrilldownBanner pageId={pageId} />
    );
    assert.match(html, /data-testid="capability-drilldown-banner"/);
    assert.match(html, new RegExp(`data-page-id="${pageId}"`));
    assert.match(html, /data-testid="drilldown-function"/);
    assert.match(html, /data-testid="drilldown-user-impact"/);
    assert.match(html, /data-testid="drilldown-back-to-catalog"/);
    assert.match(html, /href="\/admin\/capabilities"/);
    assert.doesNotMatch(html, /workspaceId/);
  }

  const auditHtml = renderToStaticMarkup(
    <CapabilityDrilldownBanner pageId="audit" />
  );
  assert.match(auditHtml, /data-domain="runtime_and_governance"/);
  assert.match(auditHtml, /data-hosts-health="true"/);
  assert.match(auditHtml, /运行健康区块/);

  const modelsHtml = renderToStaticMarkup(
    <CapabilityDrilldownBanner pageId="models" />
  );
  assert.match(modelsHtml, /data-domain="ai_supply_and_generation"/);
});

test('catalog view fixture matches SSR domain count', () => {
  const view = buildCapabilityCatalog();
  const html = renderToStaticMarkup(<AdminCapabilityCatalog view={view} />);
  const l1Count = (html.match(/data-testid="catalog-l1-section"/g) ?? [])
    .length;
  assert.equal(l1Count, view.domains.length);
});
