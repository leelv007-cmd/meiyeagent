/**
 * 运营可视化三面：用量 / 任务 / 租户（票面 T35 · dev spec §56）。
 *
 * 三面各自接一条既有的真投影 API，不接 mock、不做本地兜底数字（ADR-0019 / D-131：
 * 「投影已建无消费面」记为未完成，而以演示数据判绿等于假绿）：
 *
 *   用量 → `entitlements/catalog`：三桶额度是运营手填的受控配置，本面只读呈现，
 *          任何价格/额度数字都来自它，壳里不硬编码（D-123）。
 *   任务 → `job-runtime/observability`：队列深度、在跑任务与近窗口执行结果。
 *   租户 → `model-supply` 快照的权益策略与账户分配，含试用/生效/回滚状态。
 *
 * 拿不到数据时显式说「未知」并说明未回退演示数据，不画一个好看的零。
 *
 * U06 把三面从「四行字」换成看一眼就有判断的图：三桶额度按档并排成柱，
 * 近窗口执行结果成饼，权益变更成时间线，关键数字上抬成 KPI 块。
 * 图只是同一份投影的另一种读法——取数在 `admin-operations-chart-model.ts`
 * 单独被测，拿不到就返回 null，这里照旧说「未知」，不画零。
 */
import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
  AdminStatusChip,
} from '@/components/admin/shell/admin-panel';
import {
  BarChart,
  ChartTooltip,
  KPI,
  KPIGroup,
  ListView,
  PieChart,
  Timeline,
} from '@/components/heroui-pro';
import {
  admin_ops_empty,
  admin_ops_error,
  admin_ops_loading,
  admin_ops_outcome_completed,
  admin_ops_outcome_dead_letter,
  admin_ops_outcome_deferred,
  admin_ops_outcome_retry,
  admin_ops_outcome_threw,
  admin_ops_runner_outcomes,
  admin_ops_tasks_description,
  admin_ops_tasks_outcome_empty,
  admin_ops_tasks_outcome_share,
  admin_ops_tasks_title,
  admin_ops_tenants_allocations,
  admin_ops_tenants_description,
  admin_ops_tenants_policies,
  admin_ops_tenants_pools,
  admin_ops_tenants_recent,
  admin_ops_tenants_title,
  admin_ops_unknown,
  admin_ops_usage_chart_label,
  admin_ops_usage_description,
  admin_ops_usage_title,
  admin_plan_copy,
  admin_plan_image,
  admin_plan_video,
  p1_admin_health_outcomes,
  p1_admin_health_queue_depth,
  p1_admin_health_runner_deferred,
  p1_admin_health_worker_active_jobs,
} from '@/locale/paraglide/messages';
import {
  adminOperationalMetricsQueryKey,
  readAdminOperationalMetrics,
} from '@/p1/admin-capability-registry';
import {
  type AccountAllocationStatus,
  allocationStatusLabel,
  buildEntitlementStatusView,
  type EntitlementCountEnvelope,
  entitlementPolicyStageLabel,
  type EntitlementPolicyStage,
} from '@/p1/admin-entitlement-status-model';
import {
  buildOutcomeSlices,
  buildTenantTimeline,
  buildUsageBars,
} from '@/p1/admin-operations-chart-model';
import {
  normalizeOperationalMetrics,
  type OperationalMetricView,
} from '@/p1/admin-operations-health';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { useAdminSupplyControlSnapshot } from '@/p1/use-admin-supply-control';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** 三桶＝文案/图/视频（D-123）。音频档不在三桶口径内，故不在本面呈现。 */
const BUCKETS = [
  {
    id: 'copy',
    get label() {
      return admin_plan_copy();
    },
  },
  {
    id: 'image',
    get label() {
      return admin_plan_image();
    },
  },
  {
    id: 'video',
    get label() {
      return admin_plan_video();
    },
  },
] as const;

interface PlanCatalogOffer {
  allowance: { audio: number; copy: number; image: number; video: number };
  id: string;
}

/** 数字块只吃真数字；拿不到就是 null，由 `MetricTile` 显式写「未知」。 */
function metricNumber(
  metric: OperationalMetricView<number | null>
): null | number {
  return metric.status === 'known' ? metric.value : null;
}

function countNumber(count: EntitlementCountEnvelope): null | number {
  return count.status === 'known' ? count.value : null;
}

function MetricTile({
  label,
  testId,
  value,
}: {
  label: string;
  testId: string;
  value: null | number;
}) {
  return (
    <KPI.Root data-testid={testId}>
      <KPI.Header>
        <KPI.Title>{label}</KPI.Title>
      </KPI.Header>
      <KPI.Content>
        {value === null ? (
          // 未知和零是两件事，所以未知不进数字块，另写一行。
          <p className="text-muted text-sm">{admin_ops_unknown()}</p>
        ) : (
          <KPI.Value value={value} />
        )}
      </KPI.Content>
    </KPI.Root>
  );
}

/** 载入/失败/空三态统一在这里收口，三面各自不再重写一遍。 */
function PanelBody({
  children,
  isEmpty,
  isError,
  isLoading,
  testId,
}: {
  children: ReactNode;
  isEmpty: boolean;
  isError: boolean;
  isLoading: boolean;
  testId: string;
}) {
  if (isLoading) {
    return (
      <output className="text-muted text-sm" data-testid={`${testId}-loading`}>
        {admin_ops_loading()}
      </output>
    );
  }
  if (isError) {
    return (
      <p
        className="text-destructive text-sm"
        data-testid={`${testId}-error`}
        role="alert"
      >
        {admin_ops_error()}
      </p>
    );
  }
  if (isEmpty) {
    return (
      <p className="text-muted text-sm" data-testid={`${testId}-empty`}>
        {admin_ops_empty()}
      </p>
    );
  }
  return <>{children}</>;
}

function AdminUsagePanel() {
  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'catalog'),
    queryFn: ({ signal }) =>
      queryP1<{ plans: PlanCatalogOffer[] }>(
        'entitlements',
        { action: 'catalog', payload: {} },
        signal
      ),
  });
  const plans = catalogQuery.data?.plans ?? [];

  return (
    <AdminPanel data-testid="admin-ops-usage">
      <AdminPanelHeader>
        <AdminPanelTitle>{admin_ops_usage_title()}</AdminPanelTitle>
        <AdminPanelDescription>
          {admin_ops_usage_description()}
        </AdminPanelDescription>
      </AdminPanelHeader>
      <AdminPanelContent>
        <PanelBody
          isEmpty={plans.length === 0}
          isError={Boolean(catalogQuery.error)}
          isLoading={catalogQuery.isPending}
          testId="admin-ops-usage"
        >
          {/* 三档四档并排看一眼就知道哪一档给得多，具体数字仍在下面的行里。 */}
          <BarChart.Root
            aria-label={admin_ops_usage_chart_label()}
            data={buildUsageBars(plans)}
            data-testid="admin-ops-usage-chart"
            height={168}
          >
            <BarChart.Grid vertical={false} />
            <BarChart.XAxis dataKey="plan" />
            <BarChart.YAxis width={36} />
            <BarChart.Tooltip content={<BarChart.TooltipContent />} />
            <BarChart.Bar
              dataKey="copy"
              fill="var(--chart-2)"
              name={admin_plan_copy()}
            />
            <BarChart.Bar
              dataKey="image"
              fill="var(--chart-3)"
              name={admin_plan_image()}
            />
            <BarChart.Bar
              dataKey="video"
              fill="var(--chart-4)"
              name={admin_plan_video()}
            />
          </BarChart.Root>
          <ListView aria-label={admin_ops_usage_title()}>
            {plans.map((plan) => (
              <ListView.Item
                data-testid="admin-ops-usage-row"
                id={plan.id}
                key={plan.id}
              >
                <ListView.ItemContent>
                  <ListView.Title>{plan.id}</ListView.Title>
                  <ListView.Description>
                    {BUCKETS.map(
                      (bucket) => `${bucket.label} ${plan.allowance[bucket.id]}`
                    ).join(' · ')}
                  </ListView.Description>
                </ListView.ItemContent>
              </ListView.Item>
            ))}
          </ListView>
        </PanelBody>
      </AdminPanelContent>
    </AdminPanel>
  );
}

function AdminTasksPanel() {
  const metricsQuery = useQuery({
    queryKey: adminOperationalMetricsQueryKey,
    queryFn: ({ signal }) => readAdminOperationalMetrics(signal),
  });
  const metrics = metricsQuery.data
    ? normalizeOperationalMetrics(metricsQuery.data)
    : null;
  const outcomes = metrics?.runner.outcomeCounts;
  const slices = buildOutcomeSlices(outcomes, {
    completed: admin_ops_outcome_completed(),
    dead_letter: admin_ops_outcome_dead_letter(),
    deferred: admin_ops_outcome_deferred(),
    retry: admin_ops_outcome_retry(),
    threw: admin_ops_outcome_threw(),
  });
  const tiles = metrics
    ? [
        {
          id: 'queue-depth',
          label: p1_admin_health_queue_depth(),
          value: metricNumber(metrics.queue.queueDepth),
        },
        {
          id: 'active-jobs',
          label: p1_admin_health_worker_active_jobs(),
          value: metricNumber(metrics.worker.activeJobs),
        },
        {
          id: 'deferred',
          label: p1_admin_health_runner_deferred(),
          value: metricNumber(metrics.runner.deferredCount),
        },
      ]
    : [];
  const outcomeSummary =
    outcomes && outcomes.status === 'known'
      ? p1_admin_health_outcomes({
          completed: outcomes.value.completed,
          deadLetter: outcomes.value.dead_letter,
          deferred: outcomes.value.deferred,
          retry: outcomes.value.retry,
          threw: outcomes.value.threw,
        })
      : admin_ops_unknown();

  return (
    <AdminPanel data-testid="admin-ops-tasks">
      <AdminPanelHeader>
        <AdminPanelTitle>{admin_ops_tasks_title()}</AdminPanelTitle>
        <AdminPanelDescription>
          {admin_ops_tasks_description()}
        </AdminPanelDescription>
      </AdminPanelHeader>
      <AdminPanelContent>
        <PanelBody
          isEmpty={tiles.length === 0}
          isError={Boolean(metricsQuery.error)}
          isLoading={metricsQuery.isPending}
          testId="admin-ops-tasks"
        >
          <div className="space-y-4">
            <KPIGroup.Root>
              {tiles.map((tile) => (
                <MetricTile
                  key={tile.id}
                  label={tile.label}
                  testId="admin-ops-tasks-row"
                  value={tile.value}
                />
              ))}
            </KPIGroup.Root>
            <div className="space-y-2" data-testid="admin-ops-tasks-outcomes">
              <p className="font-medium text-sm">
                {admin_ops_tasks_outcome_share()}
              </p>
              {slices === null ? (
                // 拿不到就说未知。一个全零的饼会被读成「近期一件没跑」，那是另一回事。
                <p className="text-muted text-sm">{admin_ops_unknown()}</p>
              ) : slices.length === 0 ? (
                <p className="text-muted text-sm">
                  {admin_ops_tasks_outcome_empty()}
                </p>
              ) : (
                <>
                  <PieChart.Root
                    aria-label={admin_ops_runner_outcomes()}
                    height={168}
                  >
                    <PieChart.Pie
                      data={slices}
                      dataKey="value"
                      innerRadius={38}
                      nameKey="label"
                      outerRadius={64}
                    >
                      {slices.map((slice, index) => (
                        <PieChart.Cell
                          fill={`var(--chart-${(index % 5) + 1})`}
                          key={slice.id}
                        />
                      ))}
                    </PieChart.Pie>
                    <PieChart.Tooltip
                      content={({ payload }) => (
                        <ChartTooltip.Root>
                          {(payload ?? []).map((entry) => (
                            <ChartTooltip.Item key={String(entry.name)}>
                              <ChartTooltip.Indicator
                                color={entry.payload?.fill}
                              />
                              <ChartTooltip.Label>
                                {String(entry.name)}
                              </ChartTooltip.Label>
                              <ChartTooltip.Value>
                                {String(entry.value)}
                              </ChartTooltip.Value>
                            </ChartTooltip.Item>
                          ))}
                        </ChartTooltip.Root>
                      )}
                    />
                  </PieChart.Root>
                  <p className="text-muted text-xs">{outcomeSummary}</p>
                </>
              )}
            </div>
          </div>
        </PanelBody>
      </AdminPanelContent>
    </AdminPanel>
  );
}

function AdminTenantsPanel() {
  const snapshotQuery = useAdminSupplyControlSnapshot();
  const view = snapshotQuery.data
    ? buildEntitlementStatusView({ snapshot: snapshotQuery.data })
    : null;
  const policies = view?.policies ?? [];
  const allocations = view?.allocations ?? [];
  const timeline = view
    ? buildTenantTimeline(view, {
        allocationStatus: (status) =>
          allocationStatusLabel(status as AccountAllocationStatus),
        policyStage: (stage) =>
          entitlementPolicyStageLabel(stage as EntitlementPolicyStage),
      })
    : [];
  const counts = view
    ? [
        {
          id: 'published-policies',
          label: admin_ops_tenants_policies(),
          value: countNumber(view.publishedPolicyCount),
        },
        {
          id: 'active-allocations',
          label: admin_ops_tenants_allocations(),
          value: countNumber(view.activeAllocationCount),
        },
        {
          id: 'supply-pools',
          label: admin_ops_tenants_pools(),
          value: countNumber(view.supplyPoolCount),
        },
      ]
    : [];

  return (
    <AdminPanel data-testid="admin-ops-tenants">
      <AdminPanelHeader>
        <AdminPanelTitle>{admin_ops_tenants_title()}</AdminPanelTitle>
        <AdminPanelDescription>
          {admin_ops_tenants_description()}
        </AdminPanelDescription>
      </AdminPanelHeader>
      <AdminPanelContent>
        <PanelBody
          isEmpty={policies.length === 0 && allocations.length === 0}
          isError={Boolean(snapshotQuery.error)}
          isLoading={snapshotQuery.isPending}
          testId="admin-ops-tenants"
        >
          <div className="space-y-4">
            <KPIGroup.Root>
              {counts.map((count) => (
                <MetricTile
                  key={count.id}
                  label={count.label}
                  testId="admin-ops-tenants-count"
                  value={count.value}
                />
              ))}
            </KPIGroup.Root>
            <div className="space-y-2">
              <p className="font-medium text-sm">
                {admin_ops_tenants_recent()}
              </p>
              <Timeline.Root>
                {timeline.map((entry) => (
                  <Timeline.Item
                    data-testid={
                      entry.kind === 'policy'
                        ? 'admin-ops-tenants-policy'
                        : 'admin-ops-tenants-allocation'
                    }
                    key={entry.id}
                  >
                    <Timeline.Rail>
                      <Timeline.Marker />
                      <Timeline.Connector />
                    </Timeline.Rail>
                    <Timeline.Content>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">
                          {entry.title}
                        </span>
                        <AdminStatusChip variant="outline">
                          {entry.status}
                        </AdminStatusChip>
                      </div>
                      <p className="text-muted text-xs">{entry.detail}</p>
                    </Timeline.Content>
                  </Timeline.Item>
                ))}
              </Timeline.Root>
            </div>
          </div>
        </PanelBody>
      </AdminPanelContent>
    </AdminPanel>
  );
}

/** 三面并排＝后台首页的运营可视化区。 */
export function AdminOperationsPanels() {
  return (
    <div className="grid gap-4 xl:grid-cols-3" data-testid="admin-ops-panels">
      <AdminUsagePanel />
      <AdminTasksPanel />
      <AdminTenantsPanel />
    </div>
  );
}
