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
  admin_ops_run_status_accepted,
  admin_ops_run_status_acceptance_unknown,
  admin_ops_run_status_draining,
  admin_ops_run_status_failed,
  admin_ops_run_status_queued,
  admin_ops_run_status_rejected_before_accept,
  admin_ops_run_status_running,
  admin_ops_run_status_succeeded,
  admin_ops_runner_outcomes,
  admin_ops_tasks_description,
  admin_ops_tasks_outcome_empty,
  admin_ops_tasks_outcome_share,
  admin_ops_tasks_recent,
  admin_ops_tasks_timeline_empty,
  admin_ops_tasks_timeline_unknown,
  admin_ops_tasks_title,
  admin_ops_tenants_allocations,
  admin_ops_tenants_description,
  admin_ops_tenants_policies,
  admin_ops_tenants_pools,
  admin_ops_tenants_recent,
  admin_ops_tenants_title,
  admin_ops_tenants_trial_census_unwired,
  admin_ops_tenants_trial_label,
  admin_ops_tenants_trial_off,
  admin_ops_tenants_trial_on,
  admin_ops_tenants_trial_unknown,
  admin_ops_unknown,
  admin_ops_usage_allowance_title,
  admin_ops_usage_chart_label,
  admin_ops_usage_consumption_title,
  admin_ops_usage_consumption_unwired,
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
  buildTaskTimeline,
  buildTenantTimeline,
  buildTrialStatus,
  buildUsageBars,
  PLATFORM_USAGE_CONSUMPTION,
  TRIAL_GRANT_CENSUS,
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
      <AdminPanelContent className="space-y-4">
        {/*
          面板叫「三桶用量」，所以先回答用量：平台级消耗没有投影，就直说
          「暂无用量数据」。把下面那张额度图当成用量，才是这一面最容易犯的谎。
          这段不进 PanelBody——套餐目录空不空，都不改变「消耗没接线」这个事实。
        */}
        <div className="space-y-1" data-testid="admin-ops-usage-consumption">
          <p className="font-medium text-sm">
            {admin_ops_usage_consumption_title()}
          </p>
          <p className="text-muted text-sm">
            {PLATFORM_USAGE_CONSUMPTION.status === 'unknown'
              ? admin_ops_usage_consumption_unwired()
              : null}
          </p>
        </div>
        <PanelBody
          isEmpty={plans.length === 0}
          isError={Boolean(catalogQuery.error)}
          isLoading={catalogQuery.isPending}
          testId="admin-ops-usage"
        >
          <p className="mb-2 font-medium text-sm">
            {admin_ops_usage_allowance_title()}
          </p>
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
          {/* 读屏听到的名字要和眼睛看到的小标题一致：这一列是额度，不是用量。 */}
          <ListView aria-label={admin_ops_usage_allowance_title()}>
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

/** 供给运行状态的中文说法；没登记的状态原样显示，不猜。 */
function runStatusLabel(status: string) {
  const labels: Record<string, () => string> = {
    accepted: admin_ops_run_status_accepted,
    acceptance_unknown: admin_ops_run_status_acceptance_unknown,
    draining: admin_ops_run_status_draining,
    failed: admin_ops_run_status_failed,
    queued: admin_ops_run_status_queued,
    rejected_before_accept: admin_ops_run_status_rejected_before_accept,
    running: admin_ops_run_status_running,
    succeeded: admin_ops_run_status_succeeded,
  };
  return labels[status]?.() ?? status;
}

function AdminTasksPanel() {
  const metricsQuery = useQuery({
    queryKey: adminOperationalMetricsQueryKey,
    queryFn: ({ signal }) => readAdminOperationalMetrics(signal),
  });
  // 「任务执行」这一面票面要的是任务本身，观测快照只给得出聚合数字，
  // 逐条执行记录在供给快照里——同一个 query key，与租户面共用一次请求。
  const snapshotQuery = useAdminSupplyControlSnapshot();
  const taskTimeline = buildTaskTimeline(
    snapshotQuery.data?.runPage?.rows ?? snapshotQuery.data?.runs,
    runStatusLabel
  );
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
  // 三块数字始终在位：拿不到就写「未知」。让它整块消失，运营会以为后台没这项。
  const tiles = [
    {
      id: 'queue-depth',
      label: p1_admin_health_queue_depth(),
      value: metrics ? metricNumber(metrics.queue.queueDepth) : null,
    },
    {
      id: 'active-jobs',
      label: p1_admin_health_worker_active_jobs(),
      value: metrics ? metricNumber(metrics.worker.activeJobs) : null,
    },
    {
      id: 'deferred',
      label: p1_admin_health_runner_deferred(),
      value: metrics ? metricNumber(metrics.runner.deferredCount) : null,
    },
  ];
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
        {/*
          两条投影各答一半：观测快照给聚合数字，供给快照给逐条执行。
          任何一条到了就该出内容——两条都在飞才算加载中，两条都倒了才算失败。
        */}
        <PanelBody
          isEmpty={
            tiles.every((tile) => tile.value === null) &&
            slices === null &&
            taskTimeline !== null &&
            taskTimeline.length === 0
          }
          isError={Boolean(metricsQuery.error) && Boolean(snapshotQuery.error)}
          isLoading={metricsQuery.isPending && snapshotQuery.isPending}
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
            {/* 聚合数字回答「现在忙不忙」，逐条记录回答「刚刚跑了什么」。 */}
            <div className="space-y-2" data-testid="admin-ops-tasks-timeline">
              <p className="font-medium text-sm">{admin_ops_tasks_recent()}</p>
              {taskTimeline === null ? (
                <p className="text-muted text-sm">
                  {admin_ops_tasks_timeline_unknown()}
                </p>
              ) : taskTimeline.length === 0 ? (
                <p className="text-muted text-sm">
                  {admin_ops_tasks_timeline_empty()}
                </p>
              ) : (
                <Timeline.Root>
                  {taskTimeline.map((entry) => (
                    <Timeline.Item
                      data-testid="admin-ops-tasks-run"
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
  // 试用开关在套餐目录里——`provisionTrial` 读的也是这一份，所以问的和做的
  // 是同一件事。目录没到就是「未知」，不折算成「已停发」。
  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'catalog'),
    queryFn: ({ signal }) =>
      queryP1<{ plans: PlanCatalogOffer[]; trialEnabled?: boolean }>(
        'entitlements',
        { action: 'catalog', payload: {} },
        signal
      ),
  });
  const trial = buildTrialStatus({
    trialEnabled: catalogQuery.data?.trialEnabled,
  });
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
      <AdminPanelContent className="space-y-4">
        {/*
          「租户与试用」的试用那一半：新店现在到底发不发试用。
          这段不进 PanelBody——供给快照空不空，都不改变「目录里那个开关是开是
          关」这个事实；塞进去就会被通用空态整段吞掉，本该显示的「未知」也没了。
        */}
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="admin-ops-tenants-trial"
        >
          <span className="font-medium text-sm">
            {admin_ops_tenants_trial_label()}
          </span>
          <AdminStatusChip
            variant={trial.enabled === true ? 'default' : 'outline'}
          >
            {trial.enabled === null
              ? admin_ops_tenants_trial_unknown()
              : trial.enabled
                ? admin_ops_tenants_trial_on()
                : admin_ops_tenants_trial_off()}
          </AdminStatusChip>
          <span className="text-muted text-xs">
            {TRIAL_GRANT_CENSUS.status === 'unknown'
              ? admin_ops_tenants_trial_census_unwired()
              : null}
          </span>
        </div>
        {/*
          空态要把这一面真正展示的东西都算上：供应池也在面上，
          漏掉它就会出现「明明列着池子，却说暂无记录」。
        */}
        <PanelBody
          isEmpty={
            policies.length === 0 &&
            allocations.length === 0 &&
            (view?.pools.length ?? 0) === 0
          }
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
