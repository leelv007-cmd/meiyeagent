/**
 * 运营可视化三面：积分 / 任务 / 租户（票面 T35 · dev spec §56）。
 *
 * 三面各自接一条既有的真投影 API，不接 mock、不做本地兜底数字（ADR-0019 / D-131：
 * 「投影已建无消费面」记为未完成，而以演示数据判绿等于假绿）：
 *
 *   积分 → 平台级积分运营聚合尚未接线，诚实显示未知，不以套餐或单店额度冒充。
 *   任务 → `job-runtime/observability`：队列深度、在跑任务与近窗口执行结果。
 *   租户 → `model-supply` 快照的权益策略与账户分配，含试用/生效/回滚状态。
 *
 * 拿不到数据时显式说「未知」并说明未回退演示数据，不画一个好看的零。
 *
 * U06 把已接线的任务结果做成饼、权益变更做成时间线，关键数字上抬成指标卡。
 * 图只是同一份投影的另一种读法——取数在 `admin-operations-chart-model.ts`
 * 单独被测，拿不到就返回 null，这里照旧说「未知」，不画零。
 */
import { Badge, type BadgeProps } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '@/components/reui/timeline';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Separator } from '@/components/ui/separator';
import { Cell, Pie, PieChart } from 'recharts';
import {
  admin_ops_credits_description,
  admin_ops_credits_title,
  admin_ops_credits_unwired,
  admin_ops_empty,
  admin_ops_error,
  admin_ops_loading,
  admin_ops_not_wired,
  admin_ops_outcome_completed,
  admin_ops_outcome_dead_letter,
  admin_ops_outcome_deferred,
  admin_ops_outcome_retry,
  admin_ops_outcome_threw,
  admin_ops_run_status_acceptance_unknown,
  admin_ops_run_status_accepted,
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
  admin_ops_tasks_source_hint,
  admin_ops_tasks_timeline_empty,
  admin_ops_tasks_timeline_unknown,
  admin_ops_tasks_title,
  admin_ops_tenants_allocations,
  admin_ops_tenants_description,
  admin_ops_tenants_policies,
  admin_ops_tenants_pools,
  admin_ops_tenants_recent,
  admin_ops_tenants_source_hint,
  admin_ops_tenants_title,
  admin_ops_tenants_trial_census_unwired,
  admin_ops_tenants_trial_label,
  admin_ops_tenants_trial_off,
  admin_ops_tenants_trial_on,
  admin_ops_tenants_trial_unknown,
  admin_ops_unknown,
  admin_ops_value_absent_hint,
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
  TRIAL_GRANT_CENSUS,
} from '@/p1/admin-operations-chart-model';
import {
  normalizeOperationalMetrics,
  type OperationalMetricView,
} from '@/p1/admin-operations-health';
import { queryP1, retryP1QueryUnlessRejected } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { useAdminSupplyControlSnapshot } from '@/p1/use-admin-supply-control';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** 数字块只吃真数字；拿不到就是 null，由 `MetricTile` 显式写「未知」。 */
function metricNumber(
  metric: OperationalMetricView<number | null>
): null | number {
  return metric.status === 'known' ? metric.value : null;
}

function countNumber(count: EntitlementCountEnvelope): null | number {
  return count.status === 'known' ? count.value : null;
}

/**
 * 指标卡：指标名在头，数字在体，来源一行押在分隔线下。
 *
 * 根节点挂 `data-slot="metric-card"`（盖掉 Frame 自带的 `frame`）——它是测试里
 * 「数字确实被抬成了卡」的锚点，也是同文件测试切面板用的分界；仓内没有任何
 * 样式选中 `[data-slot=frame]`，所以只是换了个名字，不改观感。
 */
function MetricTile({
  hint,
  label,
  testId,
  value,
}: {
  hint: string;
  label: string;
  testId: string;
  value: null | number;
}) {
  return (
    <Frame
      className="h-full min-w-0"
      data-slot="metric-card"
      data-testid={testId}
      dense
    >
      <FrameHeader>
        <FrameTitle className="font-medium text-muted-foreground text-sm">
          {label}
        </FrameTitle>
      </FrameHeader>
      <FramePanel className="flex flex-1 flex-col gap-2.5">
        {value === null ? (
          // 未知和零是两件事：数字位上写「未知」，再挂一枚牌说明它没接线。
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-2xl text-muted-foreground tracking-tight tabular-nums">
              {admin_ops_unknown()}
            </span>
            <Badge size="sm" variant="outline">
              {admin_ops_not_wired()}
            </Badge>
          </div>
        ) : (
          <span className="font-medium text-2xl tracking-tight tabular-nums">
            {value}
          </span>
        )}
        <Separator />
        <p className="text-muted-foreground text-xs">
          {value === null ? admin_ops_value_absent_hint() : hint}
        </p>
      </FramePanel>
    </Frame>
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
      <output
        className="text-muted-foreground text-sm"
        data-testid={`${testId}-loading`}
      >
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
      <p
        className="text-muted-foreground text-sm"
        data-testid={`${testId}-empty`}
      >
        {admin_ops_empty()}
      </p>
    );
  }
  return <>{children}</>;
}

function AdminCreditsPanel() {
  return (
    <Frame className="min-w-0" data-testid="admin-ops-credits" dense>
      <FrameHeader>
        <FrameTitle>{admin_ops_credits_title()}</FrameTitle>
        <FrameDescription>{admin_ops_credits_description()}</FrameDescription>
      </FrameHeader>
      <FramePanel>
        <p className="text-muted-foreground text-sm">
          {admin_ops_credits_unwired()}
        </p>
      </FramePanel>
    </Frame>
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

/**
 * 运行状态的语义色。时间线到手时状态已经是中文说法了（`buildTaskTimeline` 只
 * 收一个 label 函数），所以这里按同一张表把说法回查成色，查不到的照旧中性。
 */
const RUN_STATUS_VARIANTS: ReadonlyArray<[string, BadgeProps['variant']]> = [
  ['succeeded', 'success-light'],
  ['failed', 'destructive-light'],
  ['running', 'info-light'],
  ['queued', 'info-light'],
];

function runStatusVariant(label: string): BadgeProps['variant'] {
  return (
    RUN_STATUS_VARIANTS.find(
      ([status]) => runStatusLabel(status) === label
    )?.[1] ?? 'outline'
  );
}

function AdminTasksPanel() {
  const metricsQuery = useQuery({
    queryKey: adminOperationalMetricsQueryKey,
    queryFn: ({ signal }) => readAdminOperationalMetrics(signal),
    retry: retryP1QueryUnlessRejected,
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
  const metricsHint = admin_ops_tasks_source_hint();
  // 三块数字始终在位：拿不到就写「未知」。让它整块消失，运营会以为后台没这项。
  const tiles = [
    {
      hint: metricsHint,
      id: 'queue-depth',
      label: p1_admin_health_queue_depth(),
      value: metrics ? metricNumber(metrics.queue.queueDepth) : null,
    },
    {
      hint: metricsHint,
      id: 'active-jobs',
      label: p1_admin_health_worker_active_jobs(),
      value: metrics ? metricNumber(metrics.worker.activeJobs) : null,
    },
    {
      hint: metricsHint,
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
    <Frame className="min-w-0" data-testid="admin-ops-tasks" dense>
      <FrameHeader>
        <FrameTitle>{admin_ops_tasks_title()}</FrameTitle>
        <FrameDescription>{admin_ops_tasks_description()}</FrameDescription>
      </FrameHeader>
      <FramePanel>
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
            <div className="grid gap-3 sm:grid-cols-3">
              {tiles.map((tile) => (
                <MetricTile
                  hint={tile.hint}
                  key={tile.id}
                  label={tile.label}
                  testId="admin-ops-tasks-row"
                  value={tile.value}
                />
              ))}
            </div>
            <div className="space-y-2" data-testid="admin-ops-tasks-outcomes">
              <p className="font-medium text-sm">
                {admin_ops_tasks_outcome_share()}
              </p>
              {slices === null ? (
                // 拿不到就说未知。一个全零的饼会被读成「近期一件没跑」，那是另一回事。
                <p className="text-muted-foreground text-sm">
                  {admin_ops_unknown()}
                </p>
              ) : slices.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {admin_ops_tasks_outcome_empty()}
                </p>
              ) : (
                <>
                  <ChartContainer
                    aria-label={admin_ops_runner_outcomes()}
                    className="mx-auto h-[168px] w-full max-w-[240px]"
                    config={Object.fromEntries(
                      slices.map((slice, index) => [
                        slice.id,
                        {
                          label: slice.label,
                          color: `var(--chart-${(index % 5) + 1})`,
                        },
                      ])
                    )}
                    data-testid="admin-ops-tasks-outcome-chart"
                  >
                    <PieChart>
                      <ChartTooltip
                        content={<ChartTooltipContent nameKey="label" />}
                      />
                      <Pie
                        data={slices}
                        dataKey="value"
                        nameKey="label"
                        innerRadius={38}
                        outerRadius={64}
                      >
                        {slices.map((slice, index) => (
                          <Cell
                            fill={`var(--chart-${(index % 5) + 1})`}
                            key={slice.id}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <p className="text-muted-foreground text-xs">
                    {outcomeSummary}
                  </p>
                </>
              )}
            </div>
            {/* 聚合数字回答「现在忙不忙」，逐条记录回答「刚刚跑了什么」。 */}
            <div className="space-y-2" data-testid="admin-ops-tasks-timeline">
              <p className="font-medium text-sm">{admin_ops_tasks_recent()}</p>
              {taskTimeline === null ? (
                <p className="text-muted-foreground text-sm">
                  {admin_ops_tasks_timeline_unknown()}
                </p>
              ) : taskTimeline.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {admin_ops_tasks_timeline_empty()}
                </p>
              ) : (
                <Timeline defaultValue={taskTimeline.length}>
                  {taskTimeline.map((entry, index) => (
                    <TimelineItem
                      data-testid="admin-ops-tasks-run"
                      key={entry.id}
                      step={index + 1}
                    >
                      <TimelineHeader className="items-center">
                        <TimelineSeparator />
                        <div className="flex flex-wrap items-center gap-2">
                          <TimelineTitle>{entry.title}</TimelineTitle>
                          <Badge variant={runStatusVariant(entry.status)}>
                            {entry.status}
                          </Badge>
                        </div>
                        <TimelineIndicator />
                      </TimelineHeader>
                      <TimelineContent>{entry.detail}</TimelineContent>
                    </TimelineItem>
                  ))}
                </Timeline>
              )}
            </div>
          </div>
        </PanelBody>
      </FramePanel>
    </Frame>
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
      queryP1('entitlements', { action: 'catalog', payload: {} }, signal),
  });
  const trial = buildTrialStatus({
    trialEnabled: catalogQuery.data?.trialEnabled,
  });
  const snapshotHint = admin_ops_tenants_source_hint();
  const counts = view
    ? [
        {
          hint: snapshotHint,
          id: 'published-policies',
          label: admin_ops_tenants_policies(),
          value: countNumber(view.publishedPolicyCount),
        },
        {
          hint: snapshotHint,
          id: 'active-allocations',
          label: admin_ops_tenants_allocations(),
          value: countNumber(view.activeAllocationCount),
        },
        {
          hint: snapshotHint,
          id: 'supply-pools',
          label: admin_ops_tenants_pools(),
          value: countNumber(view.supplyPoolCount),
        },
      ]
    : [];

  return (
    <Frame className="min-w-0" data-testid="admin-ops-tenants" dense>
      <FrameHeader>
        <FrameTitle>{admin_ops_tenants_title()}</FrameTitle>
        <FrameDescription>{admin_ops_tenants_description()}</FrameDescription>
      </FrameHeader>
      <FramePanel className="space-y-4">
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
          <Badge
            variant={
              trial.enabled === null
                ? 'outline'
                : trial.enabled
                  ? 'success-light'
                  : 'secondary'
            }
          >
            {trial.enabled === null
              ? admin_ops_tenants_trial_unknown()
              : trial.enabled
                ? admin_ops_tenants_trial_on()
                : admin_ops_tenants_trial_off()}
          </Badge>
          <span className="text-muted-foreground text-xs">
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
            <div className="grid gap-3 sm:grid-cols-3">
              {counts.map((count) => (
                <MetricTile
                  hint={count.hint}
                  key={count.id}
                  label={count.label}
                  testId="admin-ops-tenants-count"
                  value={count.value}
                />
              ))}
            </div>
            <div className="space-y-2">
              <p className="font-medium text-sm">
                {admin_ops_tenants_recent()}
              </p>
              <Timeline defaultValue={timeline.length}>
                {timeline.map((entry, index) => (
                  <TimelineItem
                    data-testid={
                      entry.kind === 'policy'
                        ? 'admin-ops-tenants-policy'
                        : 'admin-ops-tenants-allocation'
                    }
                    key={entry.id}
                    step={index + 1}
                  >
                    <TimelineHeader className="items-center">
                      <TimelineSeparator />
                      <div className="flex flex-wrap items-center gap-2">
                        <TimelineTitle>{entry.title}</TimelineTitle>
                        <Badge variant="outline">{entry.status}</Badge>
                      </div>
                      <TimelineIndicator />
                    </TimelineHeader>
                    <TimelineContent>{entry.detail}</TimelineContent>
                  </TimelineItem>
                ))}
              </Timeline>
            </div>
          </div>
        </PanelBody>
      </FramePanel>
    </Frame>
  );
}

/** 三面并排＝后台首页的运营可视化区。 */
export function AdminOperationsPanels() {
  return (
    <div className="grid gap-4 xl:grid-cols-3" data-testid="admin-ops-panels">
      <AdminCreditsPanel />
      <AdminTasksPanel />
      <AdminTenantsPanel />
    </div>
  );
}
