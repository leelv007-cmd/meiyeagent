/**
 * 运营三面的图表取数（U06）。
 *
 * 图形只是同一份投影的另一种读法，所以取数单独放在这里、单独被测：
 * 面板里不再有「先算个数再顺手画出来」的地方，画不出来的时候也不会
 * 偷偷退回一个零。拿不到就返回 null，由面板显式说「未知」（ADR-0019 / D-131）。
 */
import type { EntitlementStatusView } from '@/p1/admin-entitlement-status-model';
import type { OperationalMetricView } from '@/p1/admin-operations-health';

export interface PlanAllowanceOffer {
  allowance: { audio: number; copy: number; image: number; video: number };
  id: string;
}

export interface UsageBarDatum {
  [series: string]: number | string;
  copy: number;
  image: number;
  plan: string;
  video: number;
}

/**
 * 平台级三桶**消耗**目前没有投影。
 *
 * `entitlements/balance` 与 `entitlements/projection` 都是 workspace 作用域，
 * 拿管理员自己那间店的消耗充当平台大盘，比不显示更糟。所以这里是一个显式的
 * 「未接线」，面板据此说「暂无用量数据」——而不是把额度上限当成消耗画出来。
 * 投影建好那天，改这一个常量即可（U06 记账项）。
 */
export const PLATFORM_USAGE_CONSUMPTION = {
  reason: 'platform_usage_consumption_projection_not_wired',
  status: 'unknown',
} as const;

/** 三桶＝文案/图/视频（D-123）；音频不在三桶口径内，故不进图。 */
export function buildUsageBars(
  plans: readonly PlanAllowanceOffer[]
): UsageBarDatum[] {
  return plans.map((plan) => ({
    copy: plan.allowance.copy,
    image: plan.allowance.image,
    plan: plan.id,
    video: plan.allowance.video,
  }));
}

export interface OutcomeSlice {
  id: string;
  label: string;
  value: number;
}

type OutcomeCounts = {
  completed: number;
  dead_letter: number;
  deferred: number;
  retry: number;
  threw: number;
};

/**
 * 近窗口的执行结果分布。拿不到就是 null——一个「全零」的饼图会被读成
 * 「近期一件没跑」，那是另一回事。
 */
export function buildOutcomeSlices(
  outcomes: OperationalMetricView<OutcomeCounts> | undefined,
  labels: Record<keyof OutcomeCounts, string>
): null | OutcomeSlice[] {
  if (!outcomes || outcomes.status === 'unknown') return null;
  const slices = (Object.keys(labels) as (keyof OutcomeCounts)[]).map(
    (key) => ({
      id: key,
      label: labels[key],
      value: outcomes.value[key],
    })
  );
  return slices.some((slice) => slice.value > 0) ? slices : [];
}

export interface TaskRunRecord {
  id: string;
  modality: string;
  operation: string;
  startedAt: string;
  status: string;
  taskId: string;
}

export interface TaskTimelineEntry {
  at: string;
  detail: string;
  id: string;
  status: string;
  title: string;
}

/**
 * 最近的任务执行，按开始时间倒序。
 * 快照没到＝ `null`（面板说未知），到了但一条没有＝ `[]`（面板说近期没跑过）。
 */
export function buildTaskTimeline(
  runs: readonly TaskRunRecord[] | undefined,
  statusLabel: (status: string) => string,
  limit = 6
): null | TaskTimelineEntry[] {
  if (!runs) return null;
  return [...runs]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, limit)
    .map((run) => ({
      at: run.startedAt,
      detail: run.taskId,
      id: run.id,
      status: statusLabel(run.status),
      title: `${run.operation} · ${run.modality}`,
    }));
}

export interface TrialStatusView {
  /** 生效中的试用发放笔数；快照没到就是 null。 */
  activeGrants: null | number;
  enabled: boolean | null;
}

/**
 * 新店试用现在是发还是不发，以及有多少笔试用发放还生效。
 * 两个来源各自可能缺席，缺席就是 `null`——不折算成「关闭」或「零」。
 */
export function buildTrialStatus(input: {
  allocations?: readonly { kind: string; status: string }[];
  trialEnabled?: boolean;
}): TrialStatusView {
  return {
    activeGrants: input.allocations
      ? input.allocations.filter(
          (allocation) =>
            allocation.kind === 'grant' && allocation.status === 'active'
        ).length
      : null,
    enabled:
      typeof input.trialEnabled === 'boolean' ? input.trialEnabled : null,
  };
}

export interface TenantTimelineEntry {
  at: null | string;
  detail: string;
  id: string;
  kind: 'allocation' | 'policy';
  status: string;
  title: string;
}

/** 最近的权益变更按时间倒序合并；没有时间戳的排在后面，不假装有。 */
export function buildTenantTimeline(
  view: EntitlementStatusView,
  labels: {
    allocationStatus: (status: string) => string;
    policyStage: (stage: string) => string;
  },
  limit = 6
): TenantTimelineEntry[] {
  const entries: TenantTimelineEntry[] = [
    ...view.policies.map((policy) => ({
      at: policy.publishedAt ?? null,
      detail: policy.allowanceSummary,
      id: `policy-${policy.id}-${policy.revision}`,
      kind: 'policy' as const,
      status: labels.policyStage(policy.stage),
      title: `${policy.tier} · r${policy.revision}`,
    })),
    ...view.allocations.map((allocation) => ({
      at: allocation.startsAt ?? null,
      detail: allocation.workspaceId,
      id: `allocation-${allocation.id}`,
      kind: 'allocation' as const,
      status: labels.allocationStatus(allocation.status),
      title: allocation.targetLabel,
    })),
  ];

  return entries
    .sort((left, right) => {
      if (left.at === right.at) return 0;
      if (!left.at) return 1;
      if (!right.at) return -1;
      return right.at.localeCompare(left.at);
    })
    .slice(0, limit);
}
