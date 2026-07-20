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
import { buildCapabilityRegistry } from '@/p1/admin-capability-registry-model';
import { p1QueryKeys } from '@/p1/query-keys';
import { pendingActionsQueryKey } from '@/product/pending-actions-client';

const NOW = '2026-07-20T12:00:00.000Z';

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
  assert.deepEqual(assertNoAckAssignOwnerUi(html), []);
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

test('live exception home combines pending-actions with Core OperationalMetric', () => {
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
    p1QueryKeys.request('job-runtime', 'observability'),
    {
      capturedAt: NOW,
      queue: {
        queueDepth: { status: 'known', value: 2 },
        averageClaimLatencyMs: { status: 'known', value: 16 },
      },
      runner: {
        windowMinutes: 30,
        outcomeCounts: {
          status: 'known',
          value: {
            completed: 4,
            retry: 0,
            deferred: 0,
            dead_letter: 0,
            threw: 0,
          },
        },
        failuresByKind: { status: 'known', value: {} },
      },
    }
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
