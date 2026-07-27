import { strict as assert } from 'node:assert';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';

import { AdminOperationsPanels } from '@/components/admin/ops/admin-operations-panels';
import { adminOperationalMetricsQueryKey } from '@/p1/admin-capability-registry';
import { p1QueryKeys } from '@/p1/query-keys';
import { DEFAULT_RUN_TABLE_URL_STATE } from '@/p1/admin-supply-run-table-model';

const SUPPLY_KEY = p1QueryKeys.request('model-supply', 'admin_supply_control', {
  runQuery: DEFAULT_RUN_TABLE_URL_STATE,
});

function renderPanels(overrides: {
  catalog?: unknown;
  metrics?: unknown;
  plans?: unknown;
  snapshot?: unknown;
}) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('entitlements', 'catalog'),
    overrides.catalog ?? { plans: overrides.plans ?? [] }
  );
  queryClient.setQueryData(adminOperationalMetricsQueryKey, overrides.metrics);
  queryClient.setQueryData(SUPPLY_KEY, overrides.snapshot);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminOperationsPanels />
    </QueryClientProvider>
  );
}

/**
 * 三面共用一份 HTML，所以「页面上不该出现未知」这类断言必须先切到那一面——
 * 否则隔壁面板的一句「未知」就能把它判红或判绿，两种都不是在测这一面。
 */
function panelOf(html: string, testId: string) {
  const start = html.indexOf(`data-testid="${testId}"`);
  assert.notEqual(start, -1, `${testId} did not render`);
  const end = html.indexOf('data-slot="widget"', start + 1);
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

const known = (value: unknown) => ({ status: 'known', value });

const METRICS_WITH_OUTCOMES = {
  capturedAt: '2026-07-27T02:00:00.000Z',
  queue: { queueDepth: known(4) },
  runner: {
    deferredCount: known(1),
    outcomeCounts: known({
      completed: 9,
      dead_letter: 0,
      deferred: 1,
      retry: 2,
      threw: 0,
    }),
  },
  worker: { activeJobs: known(2) },
};

test('the usage panel draws the three buckets per plan and keeps the exact rows', () => {
  const html = renderPanels({
    plans: [
      { allowance: { audio: 0, copy: 20, image: 10, video: 5 }, id: 'trial' },
      {
        allowance: { audio: 0, copy: 200, image: 80, video: 40 },
        id: 'growth',
      },
    ],
  });
  assert.match(html, /data-testid="admin-ops-usage-chart"/);
  assert.match(html, /data-slot="bar-chart"/);
  // 图是同一份投影的另一种读法，精确数字仍然留在行里。
  assert.match(html, /admin-ops-usage-row/);
  assert.match(html, /文案 20/);
});

test('the tasks panel lifts queue numbers into KPI tiles and draws the outcome share', () => {
  const html = renderPanels({
    metrics: METRICS_WITH_OUTCOMES,
    snapshot: { runPage: { rows: [] } },
  });
  assert.match(html, /data-slot="kpi"/);
  assert.match(html, /data-testid="admin-ops-tasks-row"/);
  assert.match(html, /data-slot="pie-chart"/);
  // 每一条都拿到了数据，这一面上就不该出现「未知」。
  assert.doesNotMatch(panelOf(html, 'admin-ops-tasks'), /未知/);
});

/** 未知不是零：拿不到执行结果时不画饼，也不在数字块里写 0。 */
test('an unwired runner window says unknown instead of drawing a zeroed chart', () => {
  const html = renderPanels({
    metrics: {
      capturedAt: '2026-07-27T02:00:00.000Z',
      queue: {},
      runner: {},
      worker: {},
    },
  });
  assert.match(html, /data-testid="admin-ops-tasks-outcomes"/);
  assert.doesNotMatch(html, /data-slot="pie-chart"/);
  assert.match(panelOf(html, 'admin-ops-tasks'), /未知/);
});

/** 面板叫「三桶用量」，就得先回答用量；额度不是用量。 */
test('the usage panel says it has no consumption data instead of passing allowances off as usage', () => {
  const html = renderPanels({
    plans: [
      { allowance: { audio: 0, copy: 20, image: 10, video: 5 }, id: 'trial' },
    ],
  });
  assert.match(html, /data-testid="admin-ops-usage-consumption"/);
  assert.match(html, /暂无用量数据/);
  assert.match(html, /受控配置/);
});

test('the tasks panel lists recent runs, and says unknown when the snapshot never arrives', () => {
  const withRuns = renderPanels({
    metrics: METRICS_WITH_OUTCOMES,
    snapshot: {
      runPage: {
        rows: [
          {
            id: 'run-1',
            modality: 'llm',
            operation: 'llm.copy',
            startedAt: '2026-07-27T01:00:00.000Z',
            status: 'succeeded',
            taskId: 'task-1',
          },
        ],
      },
    },
  });
  assert.match(withRuns, /data-testid="admin-ops-tasks-run"/);
  assert.match(withRuns, /task-1/);
  assert.match(withRuns, /已完成/);

  const withoutSnapshot = renderPanels({ metrics: METRICS_WITH_OUTCOMES });
  assert.match(withoutSnapshot, /data-testid="admin-ops-tasks-timeline"/);
  assert.doesNotMatch(withoutSnapshot, /data-testid="admin-ops-tasks-run"/);
});

/** 「租户与试用」的试用那一半以前根本没有。 */
test('the tenant panel states whether new stores still get a trial', () => {
  const granting = renderPanels({
    catalog: { plans: [], trialEnabled: true },
    snapshot: { accountAllocations: [], entitlementPolicies: [] },
  });
  assert.match(granting, /data-testid="admin-ops-tenants-trial"/);
  assert.match(granting, /发放中/);

  const stopped = renderPanels({
    catalog: { plans: [], trialEnabled: false },
    snapshot: { accountAllocations: [], entitlementPolicies: [] },
  });
  assert.match(stopped, /已停发/);
});

/**
 * 管理员开的例外单不是试用。真试用走 `provisionTrial → activatePlan`，落在门店
 * 自己的权益投影上；快照里这张单子是企业合同给的额外供应池权限，把它数成
 * 「试用发放 1 笔」，看板上就会凭空多出一家根本没在试用的店。
 */
test('an enterprise contract grant is not counted as a trial', () => {
  const html = renderPanels({
    catalog: { plans: [], trialEnabled: true },
    snapshot: {
      accountAllocations: [
        {
          accountId: 'acct-1',
          endsAt: null,
          id: 'alloc-1',
          kind: 'grant',
          reason: '企业合同约定的专属池权限',
          source: 'enterprise_contract',
          startsAt: '2026-07-20T00:00:00.000Z',
          status: 'active',
          targetLabel: '供应池 · 专属池',
          workspaceId: 'ws-1',
        },
      ],
      entitlementPolicies: [],
    },
  });
  assert.match(html, /发放中/);
  assert.doesNotMatch(html, /试用发放/);
  assert.match(html, /还在试用期的门店有多少家/);
});

/**
 * 什么都还没到的时候，「新店试用」这一行也得在——它以前被通用空态整段吞掉，
 * 于是本该显示的「未知」连位置都没有。
 */
test('the trial line still shows up when the panel is otherwise empty', () => {
  const html = renderPanels({
    snapshot: {
      accountAllocations: [],
      entitlementPolicies: [],
      pools: [],
    },
  });
  assert.match(html, /data-testid="admin-ops-tenants-empty"/);
  assert.match(html, /data-testid="admin-ops-tenants-trial"/);
  assert.match(html, /新店试用/);
});

/** 池子列在面上却报「暂无记录」，是空态判定漏算了它。 */
test('a snapshot carrying only supply pools is not reported as empty', () => {
  const html = renderPanels({
    snapshot: {
      accountAllocations: [],
      entitlementPolicies: [],
      pools: [
        {
          capacity: { supplyAccount: { concurrency: 2 } },
          credentialAccountIds: [],
          deploymentIds: [],
          displayName: '主池',
          id: 'pool-1',
          kind: 'shared',
          revisionId: 'rev-1',
        },
      ],
    },
  });
  assert.doesNotMatch(html, /data-testid="admin-ops-tenants-empty"/);
});

test('the tenant panel counts what it knows and lays the rest on a timeline', () => {
  const html = renderPanels({
    snapshot: {
      accountAllocations: [
        {
          accountId: 'acct-1',
          endsAt: null,
          id: 'alloc-1',
          kind: 'grant',
          reason: '春季活动加赠额度',
          source: 'campaign',
          startsAt: '2026-07-20T00:00:00.000Z',
          status: 'active',
          targetLabel: '额度 · 文案',
          workspaceId: 'ws-1',
        },
      ],
      entitlementPolicies: [
        {
          allowanceSummary: '文案 20 · 图片 10 · 视频 5',
          concurrencyLimit: 1,
          id: 'policy-1',
          publishedAt: '2026-07-25T00:00:00.000Z',
          queuePriority: 3,
          revision: 4,
          revisionId: 'rev-4',
          stage: 'published',
          supportLabel: 'standard',
          tier: 'trial',
        },
      ],
    },
  });
  assert.match(html, /data-testid="admin-ops-tenants-count"/);
  assert.match(html, /data-slot="timeline"/);
  assert.match(html, /data-testid="admin-ops-tenants-policy"/);
  assert.match(html, /data-testid="admin-ops-tenants-allocation"/);
  assert.match(html, /额度 · 文案/);
});
