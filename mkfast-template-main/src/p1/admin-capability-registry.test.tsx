import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CAPABILITY_INVENTORY } from '@meiye/contracts';
import { AdminCapabilityRegistry } from './admin-capability-registry';
import { buildCapabilityRegistry } from './admin-capability-registry-model';

test('SSR renders capability inventory panorama with instrumented and stub statuses', () => {
  const html = renderToStaticMarkup(<AdminCapabilityRegistry />);

  assert.match(html, /能力清单全景/);
  assert.match(html, /data-testid="capability-inventory-panorama"/);
  assert.match(html, /data-testid="capability-registry-panel"/);

  for (const item of CAPABILITY_INVENTORY.items) {
    assert.match(
      html,
      new RegExp(`data-capability-id="${item.id}"`),
      `inventory missing ${item.id}`
    );
    assert.match(html, new RegExp(item.name));
  }

  assert.match(html, /data-inventory-status="instrumented"/);
  assert.match(html, /data-inventory-status="stub"/);
  assert.match(html, /data-inventory-status="not_in_scope_for_supply_v1"/);
  assert.match(html, /已插桩/);
  assert.match(html, /存根/);
  assert.match(html, /供应 v1 范围外/);
});

test('SSR six-question carrier is present for selected capability', () => {
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry initialSelectedId="model_supply_routing_quality" />
  );

  assert.match(html, /data-testid="capability-detail-card"/);
  assert.match(html, /data-capability-id="model_supply_routing_quality"/);
  assert.match(html, /data-testid="six-question-projection"/);
  assert.match(html, /① 用途与可用状态/);
  assert.match(html, /② 配置 revision 与生效范围/);
  assert.match(html, /③ 依赖/);
  assert.match(html, /④ 运行事实摘要/);
  assert.match(html, /⑤ 最近变更与审计引用/);
  assert.match(html, /⑥ 安全操作 \/ 移交 envelope/);
  assert.match(html, /data-testid="runtime-facts-metrics"/);
  assert.match(html, /unknown \(domain_reporter_not_wired\)/);
  assert.match(html, /data-testid="dependency-join"/);
  assert.match(html, /data-testid="technical-handoff"/);
  assert.match(html, /data-testid="completeness-ok"/);
});

test('SSR presents not_instrumented honestly for stub domains', () => {
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry initialSelectedId="generation_audio" />
  );

  assert.match(html, /data-capability-id="generation_audio"/);
  assert.match(html, /data-testid="runtime-facts-not-instrumented"/);
  assert.match(html, /not_instrumented/);
  assert.match(html, /data-testid="not-instrumented-mark"/);
  assert.match(
    html,
    /data-question="runtimeFacts"[^>]*data-question-status="not_instrumented"/
  );
  // Other five questions remain complete (no missing marks on required keys).
  assert.match(
    html,
    /data-question="purposeStatus"[^>]*data-question-status="complete"/
  );
  assert.match(
    html,
    /data-question="configRevisionScope"[^>]*data-question-status="complete"/
  );
  assert.match(
    html,
    /data-question="dependencies"[^>]*data-question-status="complete"/
  );
  assert.match(
    html,
    /data-question="recentEvidence"[^>]*data-question-status="complete"/
  );
  assert.match(
    html,
    /data-question="safeActionsHandoff"[^>]*data-question-status="complete"/
  );
  // Must not paint fake healthy zeros.
  assert.doesNotMatch(html, /data-metric-status="known"[^>]*>[\s\S]*?>0</);
});

test('SSR deep entitlements domain shows headroom unknown envelope', () => {
  const view = buildCapabilityRegistry();
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry
      view={view}
      initialSelectedId="entitlements_billing_redemption"
    />
  );

  assert.match(html, /额度余量/);
  assert.match(html, /unknown \(entitlement_headroom_reporter_not_wired\)/);
  assert.match(html, /data-metric-status="unknown"/);
});

test('SSR job queue domain exposes reverse dependency join', () => {
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry initialSelectedId="job_queue_harness" />
  );

  assert.match(html, /被依赖（反向）/);
  assert.match(html, /model_supply_routing_quality/);
  assert.match(html, /generation_video/);
});
