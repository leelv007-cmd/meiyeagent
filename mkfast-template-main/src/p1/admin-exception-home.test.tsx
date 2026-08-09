import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ActionableInboxItem, PendingAction } from '@meiye/contracts';
import {
  AdminExceptionHome,
  projectLiveExceptionHome,
} from '@/p1/admin-exception-home';
import {
  assertNoAckAssignOwnerUi,
  buildExceptionHomeView,
} from '@/p1/admin-exception-home-model';
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
import type { SupplyControlSnapshot } from '@/p1/admin-supply-types';
import { adminEnabledSensitiveWordsQueryKey } from '@/p1/admin-sensitive-words-gate';
import { SENSITIVE_WORDS_GATE_COPY } from '@/p1/admin-sensitive-words-gate-alert';
import { pendingActionsQueryKey } from '@/product/pending-actions-client';

const NOW = '2026-07-20T12:00:00.000Z';

const LIVE_OPERATIONAL_METRICS = {
  capturedAt: NOW,
  queue: {
    queueDepth: { status: 'known' as const, value: 2 },
    averageClaimLatencyMs: { status: 'known' as const, value: 16 },
  },
  runner: {
    windowMinutes: 30,
    outcomeCounts: {
      status: 'known' as const,
      value: {
        completed: 4,
        retry: 0,
        deferred: 0,
        dead_letter: 0,
        threw: 0,
      },
    },
    failuresByKind: { status: 'known' as const, value: {} },
  },
};

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

test('SSR exception home renders read-only list from default skeleton', () => {
  const html = renderToStaticMarkup(
    <AdminExceptionHome view={buildExceptionHomeView({ now: NOW })} />
  );

  assert.match(html, /data-testid="exception-home-panel"/);
  assert.match(html, /data-read-only="true"/);
  assert.match(html, /data-supports-ack="false"/);
  assert.match(html, /data-supports-assign="false"/);
  assert.match(html, /data-supports-owner-workflow="false"/);
  assert.match(html, /href="\/admin\/supply"/);
  assert.match(html, /异常优先首页（只读）/);
  assert.match(html, /data-testid="exception-list"/);
  assert.match(html, /data-testid="exception-row"/);
  assert.match(html, /data-testid="exception-technical-handoff"/);
  assert.match(html, /data-one-click-repair="false"/);
  assert.match(html, /data-testid="exception-handoff-link"/);
  assert.match(html, /data-testid="exception-catalog-link"/);
  assert.match(html, /href="\/admin\/capabilities"/);
  assert.match(html, /data-severity-filter="all"/);
  assert.deepEqual(assertNoAckAssignOwnerUi(html), []);
});

test('client severity filter hides non-matching rows without changing projection count', () => {
  const view = buildExceptionHomeView({ now: NOW });
  assert.ok(view.exceptions.length > 0);
  const blockedAndAttention = view.exceptions.filter(
    (row) => row.severity === 'blocked' || row.severity === 'attention'
  );
  // Skip if the skeleton has no matching rows for this filter pair.
  if (blockedAndAttention.length === 0) {
    return;
  }

  const html = renderToStaticMarkup(
    <AdminExceptionHome view={view} severityFilter={['blocked', 'attention']} />
  );
  assert.match(html, /data-severity-filter="blocked,attention"/);
  assert.match(
    html,
    new RegExp(`data-exception-count="${view.exceptions.length}"`)
  );
  assert.match(
    html,
    new RegExp(`data-visible-exception-count="${blockedAndAttention.length}"`)
  );
  // Visible rows only carry allowed severities.
  const severityAttrs = [...html.matchAll(/data-severity="([^"]+)"/g)].map(
    (match) => match[1]
  );
  // Row cards + severity badges both emit data-severity; all must be allowed.
  for (const severity of severityAttrs) {
    assert.ok(
      severity === 'blocked' || severity === 'attention',
      `unexpected severity visible under filter: ${severity}`
    );
  }
});

test('SSR empty state shows 当前无待处理异常 + panorama + catalog entry', () => {
  const registry = buildCapabilityRegistry();
  const healthy = {
    ...registry,
    entries: registry.entries.map((entry) => ({
      ...entry,
      availability: 'available' as const,
      evidenceFreshness: {
        capturedAt: NOW,
        staleAfterMs: 60 * 60 * 1000,
        source: 'fresh_test',
      },
    })),
  };
  const view = buildExceptionHomeView({ registry: healthy, now: NOW });
  assert.equal(view.empty, true);

  const html = renderToStaticMarkup(<AdminExceptionHome view={view} />);
  assert.match(html, /data-empty="true"/);
  assert.match(html, /data-testid="exception-empty-state"/);
  assert.match(html, /当前无待处理异常/);
  assert.match(html, /data-testid="exception-panorama-stats"/);
  assert.match(html, /data-testid="exception-stat-card"/);
  assert.match(html, /data-testid="exception-catalog-entry"/);
  assert.match(html, /前往能力目录/);
  assert.doesNotMatch(html, /data-testid="exception-list"/);
  assert.deepEqual(assertNoAckAssignOwnerUi(html), []);
});

test('SSR handoff context is redacted (no secret-like values)', () => {
  const inboxItems: ActionableInboxItem[] = [
    {
      statusKind: 'task_failed',
      createdAt: '2026-07-20T11:00:00.000Z',
      title: '任务最终失败',
      nextActionLabel: '处理当前问题',
      eventSource: {
        kind: 'task_terminal',
        taskId: 'task-x',
        taskStatus: 'failed',
      },
    },
  ];
  const view = buildExceptionHomeView({ inboxItems, now: NOW });
  const html = renderToStaticMarkup(<AdminExceptionHome view={view} />);

  assert.match(html, /data-testid="exception-handoff-redacted-context"/);
  assert.doesNotMatch(html, /sk-live-/);
  assert.doesNotMatch(html, /Bearer\s+eyJ/);
  assert.doesNotMatch(html, /postgres(?:ql)?:\/\//);
  assert.match(html, /not a one-click repair/i);
});

test('SSR negative: no ack / assign / owner workflow UI', () => {
  const html = renderToStaticMarkup(
    <AdminExceptionHome view={buildExceptionHomeView({ now: NOW })} />
  );
  assert.doesNotMatch(html, /data-testid="exception-ack"/);
  assert.doesNotMatch(html, /data-testid="exception-assign"/);
  assert.doesNotMatch(html, /data-testid="exception-owner"/);
  assert.doesNotMatch(html, /data-action="ack"/);
  assert.doesNotMatch(html, /data-action="assign"/);
  assert.doesNotMatch(html, /指派负责人/);
  assert.doesNotMatch(html, /确认异常/);
  assert.doesNotMatch(html, /分配给/);
  assert.deepEqual(assertNoAckAssignOwnerUi(html), []);
});

test('live exception home combines pending-actions with shared capability projection', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(pendingActionsQueryKey, [
    {
      createdAt: '2026-07-20T11:00:00.000Z',
      kind: 'question',
      nodeId: 'question-live',
      questionOrApprovalRef: 'question-live',
      taskId: 'task-live',
      workflowId: 'workflow-live',
      workflowRevision: 3,
    },
  ] satisfies PendingAction[]);
  queryClient.setQueryData(
    adminOperationalMetricsQueryKey,
    LIVE_OPERATIONAL_METRICS
  );
  queryClient.setQueryData(
    adminCapabilitySupplySnapshotQueryKey,
    buildLiveGenerationImageSupplySnapshot()
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminExceptionHome input={{ now: NOW }} />
    </QueryClientProvider>
  );

  assert.match(html, /任务需要补充选择/);
  assert.match(html, /actionable_inbox:pending_action/);
  assert.match(html, /data-read-only="true"/);
  assert.deepEqual(assertNoAckAssignOwnerUi(html), []);
});

test('pending-actions load failure produces an honest stale exception', () => {
  const view = projectLiveExceptionHome({
    metricsFailed: false,
    now: NOW,
    operationalMetrics: {
      capturedAt: NOW,
      queue: { queueDepth: { status: 'known', value: 0 } },
    },
    pendingActionsFailed: true,
  });
  const html = renderToStaticMarkup(<AdminExceptionHome view={view} />);

  assert.match(html, /pending_actions_query_failed/);
  assert.match(html, /data-severity="stale"/);
  assert.doesNotMatch(html, /\u5f53\u524d\u65e0\u5f85\u5904\u7406\u5f02\u5e38/);
});

test('live exception home shows explicit loading until sources settle (F-J-04)', () => {
  // Empty QueryClient: queries start pending — must not render empty "no exceptions".
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminExceptionHome input={{ now: NOW }} />
    </QueryClientProvider>
  );
  assert.match(html, /data-testid="exception-home-loading"/);
  assert.doesNotMatch(html, /data-testid="exception-empty-state"/);
  assert.doesNotMatch(html, /\u5f53\u524d\u65e0\u5f85\u5904\u7406\u5f02\u5e38/);
  assert.doesNotMatch(html, /data-testid="exception-home-panel"/);
});

/**
 * Red evidence preserved as documentation of the pre-#383 contradiction, then
 * the shared-hook green path with identical mock cache for both pages.
 */
test('shared mock cache: home and catalog agree on generation_image (was home not_verified)', () => {
  const snapshot = buildLiveGenerationImageSupplySnapshot();

  // --- red historical split (metrics-only vs metrics+supply) ---
  const homeOnly = projectOperationalMetricsCapabilityRegistry(
    LIVE_OPERATIONAL_METRICS
  );
  const catalogOnly = projectSupplySnapshotCapabilityRegistry(
    snapshot,
    {},
    homeOnly
  );
  assert.equal(
    homeOnly.entries.find((entry) => entry.id === 'generation_image')
      ?.availability,
    'not_verified'
  );
  assert.equal(
    catalogOnly.entries.find((entry) => entry.id === 'generation_image')
      ?.availability,
    'available'
  );

  // --- green: both pages project through the shared composition ---
  const shared = projectAdminCapabilityRegistry({
    operationalMetrics: LIVE_OPERATIONAL_METRICS,
    supplySnapshot: snapshot,
  });
  assert.equal(
    shared.entries.find((entry) => entry.id === 'generation_image')
      ?.availability,
    'available'
  );

  const homeView = projectLiveExceptionHome({
    now: NOW,
    registry: shared,
  });
  const homeHtml = renderToStaticMarkup(<AdminExceptionHome view={homeView} />);
  const catalogHtml = renderToStaticMarkup(
    <AdminCapabilityRegistry
      view={shared}
      initialSelectedId="generation_image"
    />
  );

  assert.match(
    catalogHtml,
    /data-testid="availability-status-badge"[^>]*data-status="available"/
  );
  // Live generation_image is no longer a not_verified exception on the home.
  assert.doesNotMatch(
    homeHtml,
    /data-capability-id="generation_image"[^>]*data-severity="not_verified"/
  );
  assert.ok(
    !homeView.exceptions.some(
      (row) =>
        row.affectedCapabilityIds.includes('generation_image') &&
        row.severity === 'not_verified'
    ),
    'shared available generation_image must not surface as not_verified on home'
  );
});

test('supply failure is stale on exception home (never green empty)', () => {
  const view = projectLiveExceptionHome({
    now: NOW,
    operationalMetrics: LIVE_OPERATIONAL_METRICS,
    supplyFailed: true,
  });
  const html = renderToStaticMarkup(<AdminExceptionHome view={view} />);

  assert.match(html, /data-severity="stale"/);
  assert.match(
    html,
    /supply_snapshot_query_failed|supply_snapshot_refresh_failed/
  );
  assert.doesNotMatch(html, /data-testid="exception-empty-state"/);
  assert.doesNotMatch(html, /\u5f53\u524d\u65e0\u5f85\u5904\u7406\u5f02\u5e38/);
});

test('live shared cache: home and catalog both mark generation_image available', () => {
  const snapshot = buildLiveGenerationImageSupplySnapshot();
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    pendingActionsQueryKey,
    [] satisfies PendingAction[]
  );
  queryClient.setQueryData(
    adminOperationalMetricsQueryKey,
    LIVE_OPERATIONAL_METRICS
  );
  queryClient.setQueryData(adminCapabilitySupplySnapshotQueryKey, snapshot);
  // Active lexicon: gate must not alert on the home.
  queryClient.setQueryData(adminEnabledSensitiveWordsQueryKey, {
    items: [{ id: 'sw-1' }],
    total: 1,
  });

  const homeHtml = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminExceptionHome input={{ now: NOW }} />
    </QueryClientProvider>
  );
  const catalogHtml = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminCapabilityRegistry initialSelectedId="generation_image" />
    </QueryClientProvider>
  );

  assert.match(homeHtml, /data-testid="exception-home-panel"/);
  assert.doesNotMatch(homeHtml, /data-testid="exception-home-loading"/);
  assert.doesNotMatch(homeHtml, /data-testid="sensitive-words-gate-alert"/);
  assert.match(
    catalogHtml,
    /data-testid="availability-status-badge"[^>]*data-status="available"/
  );
  assert.match(catalogHtml, /live_model_supply_snapshot/);
});

test('live exception home: empty enabled lexicon shows inactive gate alert', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    pendingActionsQueryKey,
    [] satisfies PendingAction[]
  );
  queryClient.setQueryData(
    adminOperationalMetricsQueryKey,
    LIVE_OPERATIONAL_METRICS
  );
  queryClient.setQueryData(
    adminCapabilitySupplySnapshotQueryKey,
    buildLiveGenerationImageSupplySnapshot()
  );
  queryClient.setQueryData(adminEnabledSensitiveWordsQueryKey, {
    items: [],
    total: 0,
  });

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminExceptionHome input={{ now: NOW }} />
    </QueryClientProvider>
  );

  assert.match(html, /data-testid="sensitive-words-gate-alert"/);
  assert.match(html, /data-gate-status="inactive"/);
  assert.match(html, new RegExp(SENSITIVE_WORDS_GATE_COPY.inactive));
  assert.doesNotMatch(html, new RegExp(SENSITIVE_WORDS_GATE_COPY.error));
});

test('live exception home: gate loading is not empty inactive', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    pendingActionsQueryKey,
    [] satisfies PendingAction[]
  );
  queryClient.setQueryData(
    adminOperationalMetricsQueryKey,
    LIVE_OPERATIONAL_METRICS
  );
  queryClient.setQueryData(
    adminCapabilitySupplySnapshotQueryKey,
    buildLiveGenerationImageSupplySnapshot()
  );
  // No sensitive-words cache → pending gate query.

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminExceptionHome input={{ now: NOW }} />
    </QueryClientProvider>
  );

  assert.match(html, /data-gate-status="loading"/);
  assert.match(html, new RegExp(SENSITIVE_WORDS_GATE_COPY.loading));
  assert.doesNotMatch(html, /data-gate-status="inactive"/);
  assert.doesNotMatch(html, new RegExp(SENSITIVE_WORDS_GATE_COPY.inactive));
});
