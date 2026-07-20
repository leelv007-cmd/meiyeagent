import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AdminCloudflareControl } from './admin-cloudflare-control';
import { buildAdminCloudflarePresentation } from './admin-cloudflare-presentation';
import { defaultAdminCfProbes } from './admin-cloudflare-probe';

test('SSR renders three truth layers, probes, config risks, no queue, no write', () => {
  const html = renderToStaticMarkup(<AdminCloudflareControl />);

  assert.match(html, /data-testid="cloudflare-readonly-panel"/);
  assert.match(html, /data-write-actions-allowed="false"/);
  assert.match(html, /data-show-queue-card="false"/);
  assert.match(html, /data-graphql-deferred="true"/);
  assert.match(html, /data-testid="cf-truth-layers"/);
  assert.match(html, /Dashboard/);
  assert.match(html, /data-testid="cf-config-risk"/);
  assert.match(html, /data-risk-id="trace_sampling_100pct"/);
  assert.match(html, /data-risk-id="hyperdrive_placeholder"/);
  assert.match(html, /data-severity="config_risk"/);
  assert.match(html, /data-severity="not_ready"/);
  assert.match(html, /data-testid="cf-self-probes"/);
  assert.match(html, /data-mutates-cloudflare="false"/);
  assert.match(html, /data-testid="cf-deep-link"/);
  assert.match(html, /data-testid="cf-write-denials"/);
  assert.match(html, /cloudflare_deploy/);
  assert.doesNotMatch(html, /data-testid="cf-queue-card"/);
  assert.doesNotMatch(html, /data-action="cloudflare_publish"/);
});

test('SSR presents unknown inventory honestly when mapping unverified', () => {
  const view = buildAdminCloudflarePresentation({
    inventory: null,
    probes: defaultAdminCfProbes(new Date('2026-07-20T00:00:00Z')),
    now: new Date('2026-07-20T00:00:00Z'),
  });
  const html = renderToStaticMarkup(<AdminCloudflareControl view={view} />);

  assert.match(html, /data-freshness="not_verified"/);
  assert.match(html, /data-field-status="unknown"/);
  assert.match(html, /unknown \(mapping_not_verified\)/);
  assert.match(html, /未核验|映射/);
});

test('SSR known inventory shows deployment business impact without raw metric jargon', () => {
  const view = buildAdminCloudflarePresentation({
    inventory: {
      mappingRef: 'shell-prod',
      capturedAt: '2026-07-20T00:00:00Z',
      freshness: 'fresh',
      deployments: {
        status: 'known',
        value: [
          {
            deploymentId: 'dep-1',
            versionId: 'ver-1',
            note: '部署版本仅反映 App Shell 发布事实，不是业务数据回滚；不覆盖 Core/Canvas',
          },
        ],
      },
      versions: {
        status: 'known',
        value: [{ versionId: 'ver-1' }],
      },
      resources: [
        {
          kind: 'worker_script',
          name: 'mkfast-template',
          readiness: 'verified',
          businessImpact: 'App Shell Worker 已注册',
        },
      ],
      cloudflareQueuesEnabled: false,
      graphqlAnalyticsDeferred: true,
    },
    probes: defaultAdminCfProbes(new Date('2026-07-20T00:00:00Z')),
    now: new Date('2026-07-20T00:00:00Z'),
  });
  const html = renderToStaticMarkup(<AdminCloudflareControl view={view} />);

  assert.match(html, /data-freshness="fresh"/);
  assert.match(html, /data-field-status="known"/);
  assert.match(html, /dep-1/);
  assert.match(html, /App Shell/);
  assert.match(html, /data-resource-kind="worker_script"/);
});
