import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultAdminCfProbes } from './admin-cloudflare-probe';
import {
  ADMIN_CF_DENIED_WRITE_ACTIONS,
  DEFAULT_REPO_CONFIG_RISKS,
  buildAdminCloudflarePresentation,
  formatAdminCfField,
  freshnessLabel,
  type AdminCfInventoryInput,
} from './admin-cloudflare-presentation';

const FRESH_INVENTORY: AdminCfInventoryInput = {
  mappingRef: 'shell-prod',
  capturedAt: '2026-07-20T00:00:00Z',
  freshness: 'fresh',
  deployments: {
    status: 'known',
    value: [
      {
        deploymentId: 'dep-1',
        versionId: 'ver-1',
        createdOn: '2026-07-19T00:00:00Z',
        note: '部署版本仅反映 App Shell 发布事实，不是业务数据回滚；不覆盖 Core/Canvas',
      },
    ],
  },
  versions: {
    status: 'known',
    value: [{ versionId: 'ver-1', createdOn: '2026-07-18T00:00:00Z' }],
  },
  resources: [
    {
      kind: 'worker_script',
      name: 'mkfast-template',
      readiness: 'verified',
      businessImpact: 'App Shell Worker 已注册',
    },
    {
      kind: 'hyperdrive',
      name: 'placeholder',
      readiness: 'not_ready',
      businessImpact: 'Hyperdrive 未就绪',
    },
  ],
  cloudflareQueuesEnabled: false,
  graphqlAnalyticsDeferred: true,
  cache: { hit: false, ttlMs: 120_000, ageMs: 0 },
};

test('presentation translates inventory into business impact, not raw metrics', () => {
  const view = buildAdminCloudflarePresentation({
    inventory: FRESH_INVENTORY,
    probes: defaultAdminCfProbes(new Date('2026-07-20T00:00:00Z')),
    now: new Date('2026-07-20T00:00:00Z'),
  });

  assert.equal(view.freshness, 'fresh');
  assert.equal(view.freshnessLabel, '新鲜');
  assert.match(view.coverageNote, /App Shell/);
  assert.match(view.coverageNote, /Core/);
  assert.equal(view.deployments.status, 'known');
  assert.match(view.deployments.businessImpact, /Shell 部署|部署/);
  assert.equal(view.showCloudflareQueueCard, false);
  assert.equal(view.graphqlAnalyticsDeferred, true);
  assert.equal(view.writeActionsAllowed, false);
  assert.ok(view.deniedWriteActions.includes('cloudflare_deploy'));
  // No server-resolved deepLinks → empty (no dead CTAs).
  assert.equal(view.deepLinks.length, 0);
  assert.ok(view.configRisks.some((r) => r.id === 'trace_sampling_100pct'));
  assert.ok(view.configRisks.some((r) => r.id === 'hyperdrive_placeholder'));
  assert.match(view.truthLayers.nativeDiagnostics, /Dashboard/);
});

test('presentation projects only https Dashboard deep-links from Core', () => {
  const view = buildAdminCloudflarePresentation({
    inventory: FRESH_INVENTORY,
    deepLinks: [
      {
        kind: 'worker_deployments',
        dashboardUrl:
          'https://dash.cloudflare.com/acct/workers/services/view/shell/production/deployments',
      },
      {
        kind: 'worker_logs',
        dashboardUrl: 'javascript:alert(1)',
      },
      {
        kind: 'worker_traces',
        dashboardUrl: 'https://dash.cloudflare.com/acct/workers/services/view/shell/production/observability',
      },
    ],
  });
  assert.equal(view.deepLinks.length, 2);
  assert.equal(view.deepLinks[0]?.kind, 'worker_deployments');
  assert.match(view.deepLinks[0]!.dashboardUrl, /^https:\/\//);
  assert.equal(view.deepLinks[1]?.kind, 'worker_traces');
});

test('stale / unknown / rate-limit / mapping present honestly', () => {
  const stale = buildAdminCloudflarePresentation({
    inventory: {
      ...FRESH_INVENTORY,
      freshness: 'stale',
      cache: { hit: true, ttlMs: 120_000, ageMs: 300_000 },
      deployments: {
        status: 'unknown',
        reason: 'rate_limited',
        freshness: 'unavailable',
      },
      versions: {
        status: 'unknown',
        reason: 'read_failed',
        freshness: 'unknown',
      },
    },
  });
  assert.equal(stale.freshness, 'stale');
  assert.equal(freshnessLabel('stale'), '过期（非实时）');
  assert.equal(stale.deployments.status, 'unknown');
  assert.match(stale.deployments.businessImpact, /限流/);
  assert.equal(formatAdminCfField(stale.deployments), 'unknown (rate_limited)');

  const unverified = buildAdminCloudflarePresentation({ inventory: null });
  assert.equal(unverified.freshness, 'not_verified');
  assert.equal(unverified.deployments.status, 'unknown');
  assert.match(unverified.deployments.businessImpact, /未核验|映射/);
});

test('config risks default from repo facts; no queue card; write denials listed', () => {
  assert.ok(DEFAULT_REPO_CONFIG_RISKS.length >= 2);
  assert.ok(ADMIN_CF_DENIED_WRITE_ACTIONS.includes('cloudflare_rollback'));
  assert.ok(ADMIN_CF_DENIED_WRITE_ACTIONS.includes('cloudflare_secret_put'));
  assert.ok(ADMIN_CF_DENIED_WRITE_ACTIONS.includes('cloudflare_dns_write'));
  assert.ok(ADMIN_CF_DENIED_WRITE_ACTIONS.includes('cloudflare_waf_write'));
  assert.ok(ADMIN_CF_DENIED_WRITE_ACTIONS.includes('cloudflare_billing_write'));
});
