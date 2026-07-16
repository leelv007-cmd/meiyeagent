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
    correlationId: 'corr-live-video-canary',
    createdAt: '2026-07-15T10:00:00.000Z',
    deploymentId: 'seedance-2-tuzi-relay',
    id: `activation-probe-${'b'.repeat(28)}`,
    latencyMs: 1250,
    operation: 'video.generate',
    outcome: 'passed',
    outputDigest: 'd'.repeat(64),
    providerCost: {
      amount: 0.25,
      currency: 'CNY',
      status: 'observed',
      usage: { mediaUnits: 1 },
    },
  };
  const failedRun = {
    catalogModelId: 'seedance-2',
    configurationRevision: 'a'.repeat(64),
    correlationId: 'corr-failed-video-canary',
    createdAt: '2026-07-15T09:00:00.000Z',
    deploymentId: 'seedance-2-tuzi-relay',
    failureCategory: 'poll:rate_limit',
    id: `activation-probe-${'c'.repeat(28)}`,
    latencyMs: 320,
    operation: 'video.generate',
    outcome: 'failed',
    providerCost: {
      amount: 0.25,
      currency: 'CNY',
      status: 'estimated',
      usage: { mediaUnits: 1 },
    },
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
        operations: ['video.generate'],
        stale: true,
        verifiedOperations: ['video.generate'],
      },
    ]
  );
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'activation_probe_runs'),
    [run, failedRun]
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminActivationProbeControl />
    </QueryClientProvider>
  );

  assert.match(html, /seedance-2-tuzi-relay/);
  assert.match(html, /配置已变更，需重新探针/);
  assert.match(html, /运行真实探针/);
  assert.match(html, /运行真实探针 · video\.generate/u);
  assert.match(html, /0.2 CNY\/second/);
  assert.match(html, /0.25 CNY/);
  assert.match(html, /已观测/);
  assert.match(html, /估算/);
  assert.match(html, /证据详情/);
  assert.match(html, /操作/);
  assert.match(html, /配置/);
  assert.match(html, /关联标识/);
  assert.match(html, /用量/);
  assert.match(html, /失败分类/);
  assert.match(html, /产物摘要/);
  assert.match(html, /证据引用/);
  assert.match(html, /corr-live-video-canary/);
  assert.match(html, /mediaUnits=1/);
  assert.match(html, /d{64}/);
  assert.match(html, new RegExp(run.id));
  assert.match(html, /corr-failed-video-canary/);
  assert.match(html, /poll:rate_limit/);
  assert.match(html, /探针历史/);
  assert.match(html, /配置 → 脱敏沙箱 → 非计费金丝雀 → 证据/u);
  assert.match(html, /已通过/);
  assert.doesNotMatch(html, /Activation probes|Run real probe|stale|passed/);
});

test('fail-closed: missing configuration disables probe actions and failed history never claims evidence', () => {
  const queryClient = new QueryClient();
  const failedRun = {
    catalogModelId: 'seedance-2',
    configurationRevision: 'a'.repeat(64),
    correlationId: 'corr-failed-without-evidence',
    createdAt: '2026-07-15T09:00:00.000Z',
    deploymentId: 'seedance-2-tuzi-relay',
    failureCategory: 'cancel:cancel_pending',
    id: `activation-probe-${'e'.repeat(28)}`,
    latencyMs: 180,
    operation: 'video.generate',
    outcome: 'failed',
    providerCost: {
      amount: 0.25,
      currency: 'CNY',
      status: 'estimated',
      usage: { mediaUnits: 1 },
    },
  };
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'activation_status'),
    [
      {
        catalogModelId: 'seedance-2',
        configurationRevision: null,
        deploymentId: 'seedance-2-tuzi-relay',
        estimatedUnitPrice: null,
        evidence: null,
        latestProbe: failedRun,
        operations: ['video.generate', 'image.generate'],
        stale: false,
        verifiedOperations: [],
      },
    ]
  );
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'activation_probe_runs'),
    [failedRun]
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminActivationProbeControl />
    </QueryClientProvider>
  );

  assert.match(html, /尚未配置/);
  assert.match(html, /尚未验证/);
  assert.match(html, /运行真实探针 · video\.generate/u);
  assert.match(html, /运行真实探针 · image\.generate/u);
  assert.match(html, /disabled=""/);
  assert.match(html, /cancel:cancel_pending/);
  assert.match(html, /video\.generate/);
  assert.match(html, new RegExp('a'.repeat(64)));
  assert.match(html, /失败分类/);
  assert.match(html, /证据引用[\s\S]*无/u);
  assert.doesNotMatch(html, new RegExp(`证据引用[\\s\\S]*${failedRun.id}`, 'u'));
  assert.doesNotMatch(html, /已真实验证|配置已变更，需重新探针/);
});

test('fail-closed: empty deployments and empty history stay non-actionable', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'activation_status'),
    []
  );
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'activation_probe_runs'),
    []
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminActivationProbeControl />
    </QueryClientProvider>
  );

  assert.match(html, /暂无可用部署/);
  assert.match(html, /尚无探针记录/);
  assert.doesNotMatch(html, /运行真实探针 ·/);
  assert.doesNotMatch(html, /已真实验证/);
});
