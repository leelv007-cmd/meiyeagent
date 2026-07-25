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
 */
import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
  AdminStatusChip,
} from '@/components/admin/shell/admin-panel';
import { ListView } from '@/components/heroui-pro';
import {
  admin_ops_empty,
  admin_ops_error,
  admin_ops_loading,
  admin_ops_runner_outcomes,
  admin_ops_tasks_description,
  admin_ops_tasks_title,
  admin_ops_tenants_description,
  admin_ops_tenants_title,
  admin_ops_unknown,
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
  allocationStatusLabel,
  buildEntitlementStatusView,
  entitlementPolicyStageLabel,
} from '@/p1/admin-entitlement-status-model';
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

function metricText(metric: OperationalMetricView<number | null>): string {
  if (metric.status === 'unknown') return admin_ops_unknown();
  return metric.value === null ? admin_ops_unknown() : String(metric.value);
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
        className="text-danger text-sm"
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
  const rows = metrics
    ? [
        {
          id: 'queue-depth',
          label: p1_admin_health_queue_depth(),
          value: metricText(metrics.queue.queueDepth),
        },
        {
          id: 'active-jobs',
          label: p1_admin_health_worker_active_jobs(),
          value: metricText(metrics.worker.activeJobs),
        },
        {
          id: 'deferred',
          label: p1_admin_health_runner_deferred(),
          value: metricText(metrics.runner.deferredCount),
        },
        {
          id: 'outcomes',
          label: admin_ops_runner_outcomes(),
          value:
            outcomes && outcomes.status === 'known'
              ? p1_admin_health_outcomes({
                  completed: outcomes.value.completed,
                  deadLetter: outcomes.value.dead_letter,
                  deferred: outcomes.value.deferred,
                  retry: outcomes.value.retry,
                  threw: outcomes.value.threw,
                })
              : admin_ops_unknown(),
        },
      ]
    : [];

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
          isEmpty={rows.length === 0}
          isError={Boolean(metricsQuery.error)}
          isLoading={metricsQuery.isPending}
          testId="admin-ops-tasks"
        >
          <ListView aria-label={admin_ops_tasks_title()}>
            {rows.map((row) => (
              <ListView.Item
                data-testid="admin-ops-tasks-row"
                id={row.id}
                key={row.id}
              >
                <ListView.ItemContent>
                  <ListView.Title>{row.label}</ListView.Title>
                  <ListView.Description>{row.value}</ListView.Description>
                </ListView.ItemContent>
              </ListView.Item>
            ))}
          </ListView>
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
          <ListView aria-label={admin_ops_tenants_title()}>
            {policies.map((policy) => (
              <ListView.Item
                data-testid="admin-ops-tenants-policy"
                id={`policy-${policy.id}-${policy.revision}`}
                key={`policy-${policy.id}-${policy.revision}`}
              >
                <ListView.ItemContent>
                  <ListView.Title>
                    {policy.tier} · r{policy.revision}
                  </ListView.Title>
                  <ListView.Description>
                    {policy.allowanceSummary}
                  </ListView.Description>
                </ListView.ItemContent>
                <ListView.ItemAction>
                  <AdminStatusChip variant="outline">
                    {entitlementPolicyStageLabel(policy.stage)}
                  </AdminStatusChip>
                </ListView.ItemAction>
              </ListView.Item>
            ))}
            {allocations.map((allocation) => (
              <ListView.Item
                data-testid="admin-ops-tenants-allocation"
                id={`allocation-${allocation.id}`}
                key={`allocation-${allocation.id}`}
              >
                <ListView.ItemContent>
                  <ListView.Title>{allocation.targetLabel}</ListView.Title>
                  <ListView.Description>
                    {allocation.workspaceId}
                  </ListView.Description>
                </ListView.ItemContent>
                <ListView.ItemAction>
                  <AdminStatusChip
                    variant={
                      allocation.status === 'active' ? 'default' : 'outline'
                    }
                  >
                    {allocationStatusLabel(allocation.status)}
                  </AdminStatusChip>
                </ListView.ItemAction>
              </ListView.Item>
            ))}
          </ListView>
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
