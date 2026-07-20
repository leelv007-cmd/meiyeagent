import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AdminCloudflareControl,
  projectAdminCloudflareLiveView,
} from '@/p1/admin-cloudflare-control';
import { buildAdminCloudflarePresentation } from '@/p1/admin-cloudflare-presentation';
import { defaultAdminCfProbes } from '@/p1/admin-cloudflare-probe';
import { p1QueryKeys } from '@/p1/query-keys';

test('SSR renders three truth layers, probes, config risks, no queue, no write', () => {
  const html = renderToStaticMarkup(
    <AdminCloudflareControl
      view={buildAdminCloudflarePresentation({
        inventory: null,
        probes: defaultAdminCfProbes(),
      })}
    />
  );

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

test('live control consumes admin-config Cloudflare readonly query', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('admin-config', 'cloudflare_inventory'),
    {
      inventory: {
        mappingRef: 'shell-live',
        capturedAt: '2026-07-20T12:00:00.000Z',
        freshness: 'fresh',
        deployments: {
          status: 'known',
          value: [
            {
              deploymentId: 'dep-live',
              versionId: 'ver-live',
              notDataRollback: true,
            },
          ],
          freshness: 'fresh',
          observedAt: '2026-07-20T12:00:00.000Z',
          source: 'cloudflare_rest',
        },
        versions: {
          status: 'known',
          value: [{ versionId: 'ver-live' }],
          freshness: 'fresh',
          observedAt: '2026-07-20T12:00:00.000Z',
          source: 'cloudflare_rest',
        },
        resources: [
          {
            kind: 'worker_script',
            name: 'mkfast-template',
            readiness: 'verified',
            businessImpact: 'live REST inventory',
          },
        ],
        cloudflareQueuesEnabled: false,
        graphqlAnalyticsDeferred: true,
        cache: { hit: false, ttlMs: 120000, ageMs: 0 },
      },
    }
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminCloudflareControl />
    </QueryClientProvider>
  );

  assert.match(html, /dep-live/);
  assert.match(html, /ver-live/);
  assert.match(html, /live REST inventory/);
  assert.match(html, /self_probe_not_returned/);
  assert.match(html, /data-probe-status="unknown"/);
  assert.doesNotMatch(html, /data-probe-status="ok"/);
});

test('Cloudflare query failure remains unknown and never renders green probes', () => {
  const view = projectAdminCloudflareLiveView(undefined, { failed: true });
  const html = renderToStaticMarkup(<AdminCloudflareControl view={view} />);

  assert.match(html, /data-freshness="unknown"/);
  assert.match(html, /unknown \(read_failed\)/);
  assert.doesNotMatch(html, /data-probe-status="ok"/);
  assert.doesNotMatch(html, /data-field-status="known"/);
});

test('Cloudflare refresh failure marks retained inventory stale', () => {
  const retained = {
    inventory: {
      mappingRef: 'shell-retained',
      capturedAt: '2026-07-20T12:00:00.000Z',
      freshness: 'fresh',
      deployments: { status: 'known', value: [] },
      versions: { status: 'known', value: [] },
      resources: [],
      cloudflareQueuesEnabled: false,
      graphqlAnalyticsDeferred: true,
    },
  };
  const html = renderToStaticMarkup(
    <AdminCloudflareControl
      view={projectAdminCloudflareLiveView(retained, { failed: true })}
    />
  );

  assert.match(html, /data-freshness="stale"/);
  assert.match(html, /data-probe-status="unknown"/);
  assert.match(html, /read_failed/);
});
