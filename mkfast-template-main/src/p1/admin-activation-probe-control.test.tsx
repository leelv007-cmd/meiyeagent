import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminActivationProbeControl } from './admin-activation-probe-control';
import { p1QueryKeys } from './query-keys';

test('shows per-deployment staleness, latest probe, cost, and history', () => {
  const queryClient = new QueryClient();
  const run = {
    catalogModelId: 'seedance-2',
    configurationRevision: 'a'.repeat(64),
    createdAt: '2026-07-15T10:00:00.000Z',
    deploymentId: 'seedance-2-tuzi-relay',
    id: `activation-probe-${'b'.repeat(28)}`,
    latencyMs: 1250,
    operation: 'video.generate',
    outcome: 'passed',
    providerCost: { amount: 0.25, currency: 'CNY', status: 'observed' },
  };
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'activation_status'),
    [
      {
        catalogModelId: 'seedance-2',
        configurationRevision: 'a'.repeat(64),
        deploymentId: 'seedance-2-tuzi-relay',
        estimatedUnitPrice: {
          amount: 0.2,
          currency: 'CNY',
          revision: 'tuzi-v1',
          unit: 'second',
        },
        evidence: {
          configurationRevision: 'c'.repeat(64),
          evidenceRef: run.id,
          status: 'live_verified',
          verifiedAt: run.createdAt,
        },
        latestProbe: run,
        stale: true,
      },
    ]
  );
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'activation_probe_runs'),
    [run]
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminActivationProbeControl />
    </QueryClientProvider>
  );

  assert.match(html, /seedance-2-tuzi-relay/);
  assert.match(html, /配置已变更，需重新探针/);
  assert.match(html, /运行真实探针/);
  assert.match(html, /0.2 CNY\/second/);
  assert.match(html, /0.25 CNY/);
  assert.match(html, /探针历史/);
  assert.match(html, /配置 → 脱敏沙箱 → 非计费金丝雀 → 证据/u);
  assert.match(html, /已通过/);
  assert.doesNotMatch(html, /Activation probes|Run real probe|stale|passed/);
});
