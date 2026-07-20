import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AdminSupplyAssociationView,
  AdminSupplyControl,
  AdminSupplyTaskDrilldown,
} from './admin-supply-control';
import { ASSOCIATION_VIEW_IDS } from './admin-supply-association-views-model';

test('SSR supply control center renders overview, run table, associations, entitlements', () => {
  const html = renderToStaticMarkup(<AdminSupplyControl />);

  assert.match(html, /data-testid="supply-control-center-panel"/);
  assert.match(html, /data-testid="supply-overview-panel"/);
  assert.match(html, /data-testid="supply-operation-readiness"/);
  assert.match(html, /data-testid="supply-dual-channel-coverage"/);
  assert.match(html, /data-testid="supply-six-entity"/);
  assert.match(html, /data-testid="supply-effective-revisions"/);
  assert.match(html, /data-testid="supply-run-table"/);
  assert.match(html, /data-testid="supply-association-index"/);
  assert.match(html, /data-testid="entitlement-status-panel"/);
  assert.match(html, /data-external-gateway-deeplink-only="true"/);
  assert.match(html, /data-evidence-only="true"/);
  assert.match(html, /双渠道就绪|multi_channel_ready|单渠道/);
});

test('SSR J5 credential UI + route simulator + governed actions', () => {
  const html = renderToStaticMarkup(<AdminSupplyControl />);

  assert.match(html, /data-testid="supply-credential-panel"/);
  assert.match(html, /data-secret-never-echoed="true"/);
  assert.match(html, /data-env-fallback-risk-always-visible="true"/);
  assert.match(html, /data-testid="supply-credential-env-fallback-banner"/);
  assert.match(html, /环境变量回退/);
  assert.match(html, /data-testid="supply-credential-activation-gate"/);
  assert.match(html, /排空中|未排空/);
  assert.doesNotMatch(html, /sk-[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(html, /Bearer\s+[A-Za-z0-9]/);

  assert.match(html, /data-testid="supply-route-simulator-panel"/);
  assert.match(html, /data-testid="supply-route-hard-filter"/);
  assert.match(html, /data-testid="supply-route-max-cost"/);
  assert.match(html, /data-testid="supply-route-acceptance"/);
  assert.match(html, /data-testid="supply-route-live-exclusions"/);
  assert.match(html, /data-testid="supply-route-not-selected"/);
  assert.match(html, /data-testid="supply-route-evidence-freshness"/);
  assert.match(html, /data-testid="supply-route-cost-evidence"/);
  assert.match(html, /invoice/);

  assert.match(html, /data-testid="supply-governed-actions-panel"/);
  assert.match(html, /data-action-count="13"/);
  assert.match(html, /data-forbid-secret-echo="true"/);
  assert.match(html, /data-forbid-direct-db="true"/);
  assert.match(html, /data-forbid-bypass-publish="true"/);
  assert.match(html, /data-forbid-blind-retry="true"/);
  assert.match(html, /data-action-id="connectivity_probe"/);
  assert.match(html, /data-action-id="route_simulate"/);
  assert.match(html, /data-action-id="credential_rotate"/);
  assert.match(html, /data-action-id="pre_revoke_impact_check"/);
  assert.match(html, /data-action-id="health_balance_refresh"/);
});

test('SSR run table share link reflects URL state', () => {
  const html = renderToStaticMarkup(
    <AdminSupplyControl runTableSearch="page=2&status=failed&sort=latencyMs&dir=asc" />,
  );
  assert.match(html, /data-testid="supply-run-table-share-link"/);
  assert.match(html, /status=failed/);
  assert.match(html, /sort=latencyMs/);
  assert.match(html, /data-page="1"|data-page="2"/);
});

test('SSR task drilldown embeds summary latency timeline error artifact', () => {
  const html = renderToStaticMarkup(
    <AdminSupplyControl taskId="task-image-002" />,
  );
  assert.match(html, /data-testid="supply-task-drilldown"/);
  assert.match(html, /data-testid="supply-task-summary-cards"/);
  assert.match(html, /data-testid="supply-task-latency"/);
  assert.match(html, /data-testid="supply-task-timeline"/);
  assert.match(html, /data-testid="supply-task-error"/);
  assert.match(html, /UPSTREAM_5XX/);
});

test('SSR association views render forward+reverse for all five ids', () => {
  for (const viewId of ASSOCIATION_VIEW_IDS) {
    const html = renderToStaticMarkup(
      <AdminSupplyAssociationView viewId={viewId} />,
    );
    assert.match(html, /data-testid="supply-association-views-panel"/);
    assert.match(html, new RegExp(`data-view-id="${viewId}"`));
    assert.match(html, /data-direction="forward"/);
    assert.match(html, /data-direction="reverse"/);
  }
});

test('SSR standalone task drilldown for known and unknown task', () => {
  const ok = renderToStaticMarkup(
    <AdminSupplyTaskDrilldown taskId="task-video-003" />,
  );
  assert.match(ok, /data-testid="supply-task-drilldown"/);
  assert.match(ok, /acceptance_unknown/);

  const missing = renderToStaticMarkup(
    <AdminSupplyTaskDrilldown taskId="task-missing" />,
  );
  assert.match(missing, /data-testid="supply-task-not-found"/);
});
