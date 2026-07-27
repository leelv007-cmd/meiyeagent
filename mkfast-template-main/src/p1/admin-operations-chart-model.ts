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
