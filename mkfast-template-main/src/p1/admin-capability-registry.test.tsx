import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { CAPABILITY_INVENTORY } from '@/p1/capability-inventory';
import {
  AdminCapabilityRegistry,
  adminCapabilitySupplySnapshotQueryKey,
  adminOperationalMetricsQueryKey,
  projectAdminCapabilityRegistry,
  projectOperationalMetricsCapabilityRegistry,
  projectSupplySnapshotCapabilityRegistry,
} from '@/p1/admin-capability-registry';
import { buildCapabilityRegistry } from '@/p1/admin-capability-registry-model';
import { buildDefaultSupplyControlSnapshot } from '@/p1/admin-supply-fixture';
import { DEFAULT_RUN_TABLE_URL_STATE } from '@/p1/admin-supply-run-table-model';
import { p1QueryKeys } from '@/p1/query-keys';
import type { SupplyControlSnapshot } from '@/p1/admin-supply-types';

const SKELETON = buildCapabilityRegistry();

const LIVE_OPERATIONAL_METRICS = {
  capturedAt: '2026-07-20T12:00:00.000Z',
  queue: {
    queueDepth: { status: 'known', value: 7, scope: 'configured_job_runtime' },
    averageClaimLatencyMs: {
      status: 'known',
      value: 41,
      scope: 'configured_job_runtime',
    },
  },
  runner: {
    windowMinutes: 30,
    outcomeCounts: {
      status: 'known',
      value: {
        completed: 8,
        retry: 1,
        deferred: 0,
        dead_letter: 1,
        threw: 0,
      },
    },
    failuresByKind: { status: 'known', value: { provider: 1 } },
  },
};

test('SSR renders capability inventory panorama with instrumented and stub statuses', () => {
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry view={SKELETON} />
  );

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
    <AdminCapabilityRegistry
      view={SKELETON}
      initialSelectedId="model_supply_routing_quality"
    />
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
    <AdminCapabilityRegistry
      view={SKELETON}
      initialSelectedId="generation_audio"
    />
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
    <AdminCapabilityRegistry
      view={SKELETON}
      initialSelectedId="job_queue_harness"
    />
  );

  assert.match(html, /被依赖（反向）/);
  assert.match(html, /model_supply_routing_quality/);
  assert.match(html, /generation_video/);
});

test('live control consumes Core OperationalMetric evidence from TanStack Query', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('job-runtime', 'observability'),
    LIVE_OPERATIONAL_METRICS
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminCapabilityRegistry initialSelectedId="job_queue_harness" />
    </QueryClientProvider>
  );

  assert.match(html, /2026-07-20T12:00:00.000Z/);
  assert.match(html, /live_job_runtime_operational_metrics/);
  assert.match(html, /queueDepth=7/);
  assert.match(html, /10/);
  assert.match(html, /80.0%/);
  assert.doesNotMatch(html, /operational_metrics_collector_not_projected/);
});

test('OperationalMetric query failure is stale and never becomes known zero', () => {
  const view = projectOperationalMetricsCapabilityRegistry(undefined, {
    failed: true,
  });
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry
      view={view}
      initialSelectedId="job_queue_harness"
    />
  );

  assert.match(
    html,
    /data-testid="availability-status-badge"[^>]*data-status="stale"/
  );
  assert.match(html, /unknown \(operational_metrics_query_failed\)/);
  assert.doesNotMatch(html, /data-metric-status="known"[^>]*>[\s\S]*?>0</);
});

test('OperationalMetric refresh failure marks retained live evidence stale', () => {
  const view = projectOperationalMetricsCapabilityRegistry(
    LIVE_OPERATIONAL_METRICS,
    { failed: true }
  );
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry
      view={view}
      initialSelectedId="job_queue_harness"
    />
  );

  assert.match(
    html,
    /data-testid="availability-status-badge"[^>]*data-status="stale"/
  );
  assert.match(html, /refresh failed; showing stale retained evidence/);
  assert.match(html, /operational_metrics_refresh_failed_using_stale_data/);
});

test('supply snapshot reports real model-supply runtime facts', () => {
  const view = projectSupplySnapshotCapabilityRegistry(
    buildDefaultSupplyControlSnapshot()
  );
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry
      view={view}
      initialSelectedId="model_supply_routing_quality"
    />
  );

  assert.match(html, /catalog-default-expand/);
  assert.match(html, /live_model_supply_snapshot/);
  assert.match(html, /2026-07-20T12:00:00.000Z/);
  assert.match(html, />5</);
  assert.match(html, /40.0%/);
  assert.match(html, /45000 ms/);
  assert.match(html, /unknown \(supply_run_cost_evidence_incomplete\)/);
  assert.doesNotMatch(html, /domain_reporter_not_wired/);
});

test('supply snapshot reports entitlement policy and account allocation evidence', () => {
  const view = projectSupplySnapshotCapabilityRegistry(
    buildDefaultSupplyControlSnapshot()
  );
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry
      view={view}
      initialSelectedId="entitlements_billing_redemption"
    />
  );

  assert.match(html, /pool-shared-default:r2/);
  assert.match(html, /entitlement-policy:growth:r1/);
  assert.match(html, /allocation-fixture-a/);
  assert.match(html, /supply concurrency=40/);
  assert.match(html, /live_entitlement_supply_snapshot/);
  assert.match(html, /entitlement policies=1 \(published=1\)/);
  assert.match(html, /account allocations=1 \(active=1\)/);
  assert.match(html, /unknown \(usage_ledger_not_in_supply_snapshot\)/);
  assert.doesNotMatch(html, /reporter absent/);
  assert.doesNotMatch(html, /entitlement_headroom_reporter_not_wired/);
});

test('supply snapshot query failure stays stale and never becomes known zero', () => {
  const view = projectSupplySnapshotCapabilityRegistry(undefined, {
    failed: true,
  });
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry
      view={view}
      initialSelectedId="model_supply_routing_quality"
    />
  );

  assert.match(
    html,
    /data-testid="availability-status-badge"[^>]*data-status="stale"/
  );
  assert.match(html, /unknown \(supply_snapshot_query_failed\)/);
  assert.doesNotMatch(html, /data-metric-status="known"[^>]*>[\s\S]*?>0</);
});

test('supply snapshot refresh failure marks retained evidence stale', () => {
  const view = projectSupplySnapshotCapabilityRegistry(
    buildDefaultSupplyControlSnapshot(),
    { failed: true }
  );
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry view={view} initialSelectedId="generation_copy" />
  );

  assert.match(
    html,
    /data-testid="availability-status-badge"[^>]*data-status="stale"/
  );
  assert.match(html, /supply snapshot refresh failed; showing stale evidence/);
  assert.match(html, /supply_snapshot_refresh_failed_using_stale_data/);
  assert.match(html, />2</);
});

test('live-verified deployments without a published route stay not verified', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const view = projectSupplySnapshotCapabilityRegistry({
    ...snapshot,
    routePolicies: snapshot.routePolicies.filter(
      (policy) => policy.operation !== 'video.generate'
    ),
  });
  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry view={view} initialSelectedId="generation_video" />
  );

  assert.match(
    html,
    /data-testid="availability-status-badge"[^>]*data-status="not_verified"/
  );
});

test('live control consumes the cached Core supply snapshot', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    adminCapabilitySupplySnapshotQueryKey,
    buildDefaultSupplyControlSnapshot()
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminCapabilityRegistry initialSelectedId="generation_image" />
    </QueryClientProvider>
  );

  assert.match(html, /catalog-default-expand/);
  assert.match(html, /live_model_supply_snapshot/);
  assert.match(html, />2</);
  assert.match(html, /50.0%/);
  assert.doesNotMatch(html, /domain_reporter_not_wired/);
});

/**
 * Stable capability fixture for Spec F / #383 consistency proofs.
 * Default fixture lacks a published image.edit route, so generation_image
 * stays not_verified even with a live snapshot — publish edit + clear health.
 */
function buildLiveGenerationImageSupplySnapshot(): SupplyControlSnapshot {
  const base = buildDefaultSupplyControlSnapshot();
  return {
    ...base,
    healthOverlays: base.healthOverlays.filter(
      (overlay) => overlay.targetId !== 'dep-image-openai'
    ),
    routePolicies: [
      ...base.routePolicies,
      {
        id: 'route-image-edit',
        operation: 'image.edit',
        qualityTier: 'quality',
        hardConstraints: ['data_class_allowed', 'health_not_blocking'],
        candidateDeploymentIds: ['dep-image-ark', 'dep-image-tuzi'],
        maxAttempts: 2,
        fallbackAuthorized: true,
        publishedAt: '2026-07-15T00:00:00.000Z',
        revisionId: 'route-image-edit:r1',
      },
    ],
  };
}

function entryAvailability(
  view: ReturnType<typeof projectAdminCapabilityRegistry>,
  capabilityId: string
) {
  return view.entries.find((entry) => entry.id === capabilityId)?.availability;
}

/**
 * Red evidence (historical split): metrics-only home left generation_image as
 * not_verified while the catalog metrics+supply path was live/available.
 * Shared projectAdminCapabilityRegistry must eliminate that contradiction.
 */
test('historical metrics-only home left generation_image not_verified while catalog was live', () => {
  const snapshot = buildLiveGenerationImageSupplySnapshot();
  const homeOnly = projectOperationalMetricsCapabilityRegistry(
    LIVE_OPERATIONAL_METRICS
  );
  const catalog = projectSupplySnapshotCapabilityRegistry(
    snapshot,
    {},
    homeOnly
  );

  assert.equal(
    entryAvailability(homeOnly, 'generation_image'),
    'not_verified',
    'pre-fix home projected metrics only → generation_image stayed not_verified'
  );
  assert.equal(
    entryAvailability(catalog, 'generation_image'),
    'available',
    'pre-fix catalog overlaid supply → generation_image was live/available'
  );
});

test('shared projection unifies generation_image for home and catalog', () => {
  const snapshot = buildLiveGenerationImageSupplySnapshot();
  const shared = projectAdminCapabilityRegistry({
    operationalMetrics: LIVE_OPERATIONAL_METRICS,
    supplySnapshot: snapshot,
  });

  assert.equal(entryAvailability(shared, 'generation_image'), 'available');
  assert.equal(
    shared.entries.find((entry) => entry.id === 'generation_image')
      ?.evidenceFreshness?.source,
    'live_model_supply_snapshot'
  );

  // Both product surfaces consume the same pure composition — identical entry.
  const homeView = projectAdminCapabilityRegistry({
    operationalMetrics: LIVE_OPERATIONAL_METRICS,
    supplySnapshot: snapshot,
  });
  const catalogView = projectAdminCapabilityRegistry({
    operationalMetrics: LIVE_OPERATIONAL_METRICS,
    supplySnapshot: snapshot,
  });
  assert.equal(
    entryAvailability(homeView, 'generation_image'),
    entryAvailability(catalogView, 'generation_image')
  );
  assert.deepEqual(
    homeView.entries.find((entry) => entry.id === 'generation_image'),
    catalogView.entries.find((entry) => entry.id === 'generation_image')
  );
});

test('supply failure marks shared projection stale on both pages (no synthetic zero/green)', () => {
  const snapshot = buildLiveGenerationImageSupplySnapshot();
  const failedNoData = projectAdminCapabilityRegistry({
    operationalMetrics: LIVE_OPERATIONAL_METRICS,
    supplyFailed: true,
  });
  const failedWithStale = projectAdminCapabilityRegistry({
    operationalMetrics: LIVE_OPERATIONAL_METRICS,
    supplySnapshot: snapshot,
    supplyFailed: true,
  });

  assert.equal(entryAvailability(failedNoData, 'generation_image'), 'stale');
  assert.equal(entryAvailability(failedWithStale, 'generation_image'), 'stale');
  assert.match(
    failedWithStale.entries.find((entry) => entry.id === 'generation_image')
      ?.evidenceFreshness?.source ?? '',
    /supply_snapshot_refresh_failed_using_stale_data/
  );

  const html = renderToStaticMarkup(
    <AdminCapabilityRegistry
      view={failedNoData}
      initialSelectedId="generation_image"
    />
  );
  assert.match(
    html,
    /data-testid="availability-status-badge"[^>]*data-status="stale"/
  );
  assert.doesNotMatch(html, /data-metric-status="known"[^>]*>[\s\S]*?>0</);
  assert.doesNotMatch(
    html,
    /data-testid="availability-status-badge"[^>]*data-status="available"/
  );
});

test('shared projection loading keeps generation_image not_verified (never green empty)', () => {
  const loading = projectAdminCapabilityRegistry({});
  assert.equal(entryAvailability(loading, 'generation_image'), 'not_verified');
  assert.equal(
    loading.entries.find((entry) => entry.id === 'generation_image')
      ?.evidenceFreshness?.source,
    'supply_snapshot_loading'
  );

  // Honest unknown on job_queue remains not_verified unless failures force attention/stale.
  assert.equal(entryAvailability(loading, 'job_queue_harness'), 'not_verified');
  assert.notEqual(entryAvailability(loading, 'job_queue_harness'), 'available');
});

test('live catalog and shared query keys consume the same supply + metrics cache', () => {
  const queryClient = new QueryClient();
  const snapshot = buildLiveGenerationImageSupplySnapshot();
  queryClient.setQueryData(
    adminOperationalMetricsQueryKey,
    LIVE_OPERATIONAL_METRICS
  );
  queryClient.setQueryData(adminCapabilitySupplySnapshotQueryKey, snapshot);

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminCapabilityRegistry initialSelectedId="generation_image" />
    </QueryClientProvider>
  );

  assert.match(
    html,
    /data-testid="availability-status-badge"[^>]*data-status="available"/
  );
  assert.match(html, /live_model_supply_snapshot/);
  // Shared key equals the default useAdminSupplyControlSnapshot payload.
  assert.deepEqual(
    adminCapabilitySupplySnapshotQueryKey,
    p1QueryKeys.request('model-supply', 'admin_supply_control', {
      runQuery: DEFAULT_RUN_TABLE_URL_STATE,
    })
  );
});
