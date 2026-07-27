/**
 * Weekly review + next-round recommendation pure projection (P1-E2 / #159).
 *
 * Read-only over publication records + observations + package revisions.
 * Recommendations never create tasks or charge; user confirm yields a
 * CreationExecutionSnapshot *intent* only.
 */

import type { OutcomeObservationFact } from './outcome-observation-model';
import {
  OUTCOME_OBSERVATION_KIND_LABEL,
  OUTCOME_SOURCE_TIER_LABEL,
} from './outcome-observation-model';
import type { PublicationRecordFact } from './publication-record-model';

export const WEEKLY_NEXT_ACTIONS = [
  'continue_series',
  'change_cta',
  'change_platform',
  'stop_series',
] as const;

export type WeeklyNextAction = (typeof WEEKLY_NEXT_ACTIONS)[number];

export const WEEKLY_NEXT_ACTION_LABEL: Record<WeeklyNextAction, string> = {
  continue_series: '续做同系列',
  change_cta: '换 CTA',
  change_platform: '换平台',
  stop_series: '停止系列',
};

export type WeeklyReviewPackageFact = {
  contentPackageId: string;
  title: string;
  platform?: string;
  ctaLabel?: string;
  revision: number;
};

export type WeeklyReviewFacts = {
  workspaceId: string;
  weekStartedAt: string;
  weekEndedAt: string;
  packages: readonly WeeklyReviewPackageFact[];
  publications: readonly PublicationRecordFact[];
  observations: readonly OutcomeObservationFact[];
  /** Last review decision per package, if any. */
  lastDecisionByPackageId?: Record<string, WeeklyNextAction>;
};

export type WeeklyNextRecommendation = {
  packageId: string;
  packageTitle: string;
  actions: WeeklyNextAction[];
  /** Why this set is suggested — includes uncertainty. */
  rationale: string;
  /** Explicit uncertainty / sample size note. */
  uncertainty: string;
  /** Trace links back to concrete evidence. */
  evidenceRefs: Array<{
    kind: 'publication' | 'observation' | 'unknown';
    id: string;
    label: string;
    sourceTierLabel?: string;
  }>;
  /** exploratory when sample is insufficient — never auto ROI. */
  mode: 'evidence_based' | 'exploratory';
};

/**
 * Confirming a recommendation only produces a snapshot *intent*.
 * The actual CreationExecutionSnapshot is created by the submission spine
 * after the user continues into Composer — never here.
 */
export type WeeklySnapshotIntent = {
  kind: 'creation_execution_snapshot_intent';
  action: Exclude<WeeklyNextAction, 'stop_series'>;
  sourcePackageId: string;
  sourceRevision: number;
  workspaceId: string;
  inherit: {
    structure: true;
    style: true;
    materialRoles: true;
  };
  /** Recompile current facts/rights/identity/platform/quote on submit. */
  recompileOnSubmit: true;
  /** Preference promotion still requires independent confirmation. */
  promotesLongTermPreference: false;
};

export type WeeklyReviewDecisionRecord = {
  packageId: string;
  action: WeeklyNextAction;
  decidedAt: string;
  /** Reject/adjust only records the decision — no preference write. */
  promotesLongTermPreference: false;
};

export type WeeklyReviewPanelView =
  | {
      kind: 'ready';
      heading: string;
      weekLabel: string;
      published: Array<{
        packageId: string;
        packageTitle: string;
        platform: string;
        publishedAtLabel: string;
        sourceTierLabel: string;
        revisionLabel: string;
        ctaLabel: string;
      }>;
      observed: Array<{
        packageId: string;
        packageTitle: string;
        kindLabel: string;
        sourceTierLabel: string;
        occurredAtLabel: string;
      }>;
      unknowns: string[];
      recommendations: WeeklyNextRecommendation[];
      /** Never present — ROI is forbidden without verified economics. */
      hasAutoRoi: false;
      hasCausalLanguage: false;
    }
  | {
      kind: 'fail_closed';
      heading: string;
      reason: 'workspace_mismatch' | 'insufficient_sample' | 'empty_week';
      message: string;
      unknowns: string[];
      recommendations: WeeklyNextRecommendation[];
      hasAutoRoi: false;
      hasCausalLanguage: false;
    };

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '时间未知';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}

function inWeek(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end;
}

function packageTitle(
  packages: readonly WeeklyReviewPackageFact[],
  packageId: string
): string {
  return (
    packages.find((p) => p.contentPackageId === packageId)?.title ?? '成品'
  );
}

function packageMeta(
  packages: readonly WeeklyReviewPackageFact[],
  packageId: string
): WeeklyReviewPackageFact | undefined {
  return packages.find((p) => p.contentPackageId === packageId);
}

/**
 * Build next-round recommendations from the same ledger.
 * Insufficient sample → exploratory mode, no causal ROI language.
 */
export function projectWeeklyRecommendations(
  facts: WeeklyReviewFacts
): WeeklyNextRecommendation[] {
  const weekPubs = facts.publications.filter(
    (p) =>
      p.status === 'published' &&
      inWeek(p.publishedAt, facts.weekStartedAt, facts.weekEndedAt)
  );
  const weekObs = facts.observations.filter((o) =>
    inWeek(o.occurredAt, facts.weekStartedAt, facts.weekEndedAt)
  );

  const packageIds = [
    ...new Set(weekPubs.map((p) => p.contentPackageId)),
  ].filter((id) => facts.lastDecisionByPackageId?.[id] !== 'stop_series');

  return packageIds.slice(-5).map((packageId) => {
    const pubs = weekPubs.filter((p) => p.contentPackageId === packageId);
    const obs = weekObs.filter((o) => o.contentPackageId === packageId);
    const meta = packageMeta(facts.packages, packageId);
    const sampleSize = pubs.length + obs.length;
    const mode: WeeklyNextRecommendation['mode'] =
      sampleSize < 2 ? 'exploratory' : 'evidence_based';

    const evidenceRefs: WeeklyNextRecommendation['evidenceRefs'] = [
      ...pubs.map((p) => ({
        kind: 'publication' as const,
        id: p.id,
        label: `${p.platform} · ${formatDay(p.publishedAt)}`,
        sourceTierLabel:
          p.sourceTier === 'verified_callback' ? '已验证平台回执' : '人工补记',
      })),
      ...obs.map((o) => ({
        kind: 'observation' as const,
        id: o.id,
        label: `${OUTCOME_OBSERVATION_KIND_LABEL[o.kind]} · ${formatDay(o.occurredAt)}`,
        sourceTierLabel: OUTCOME_SOURCE_TIER_LABEL[o.sourceTier],
      })),
    ];

    if (evidenceRefs.length === 0) {
      evidenceRefs.push({
        kind: 'unknown',
        id: `unknown:${packageId}`,
        label: '本周样本不足',
      });
    }

    const hasStrongOutcome = obs.some(
      (o) =>
        o.kind === 'appointment' ||
        o.kind === 'voucher_purchase' ||
        o.kind === 'redemption' ||
        o.kind === 'store_visit'
    );
    const multiPlatform =
      new Set(pubs.map((p) => p.platform)).size > 1 ||
      Boolean(meta?.platform && pubs.some((p) => p.platform !== meta.platform));

    const actions: WeeklyNextAction[] = hasStrongOutcome
      ? ['continue_series', 'change_cta', 'change_platform', 'stop_series']
      : multiPlatform
        ? ['change_platform', 'change_cta', 'continue_series', 'stop_series']
        : ['change_cta', 'change_platform', 'continue_series', 'stop_series'];

    return {
      packageId,
      packageTitle: packageTitle(facts.packages, packageId),
      actions,
      rationale:
        mode === 'exploratory'
          ? '样本较少，建议做小范围探索，不要据此下经营结论。'
          : hasStrongOutcome
            ? '本周观察到预约/买券或到店信号，可优先验证续做或调整 CTA。'
            : '已有发布记录但结果信号偏弱，可换 CTA 或换平台再验证一轮。',
      uncertainty:
        mode === 'exploratory'
          ? `有效样本 ${sampleSize}，置信度低；缺失项保持未知。`
          : `有效样本 ${sampleSize}；推断关联不能当作因果。`,
      evidenceRefs,
      mode,
    };
  });
}

export function projectWeeklyReviewPanel(
  facts: WeeklyReviewFacts & {
    /** Caller workspace — must match facts.workspaceId. */
    viewerWorkspaceId?: string;
  }
): WeeklyReviewPanelView {
  const heading = '周复盘';
  if (
    facts.viewerWorkspaceId &&
    facts.viewerWorkspaceId !== facts.workspaceId
  ) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'workspace_mismatch',
      message: '周复盘只读取同一工作区的发布与结果信号。',
      unknowns: ['工作区不匹配'],
      recommendations: [],
      hasAutoRoi: false,
      hasCausalLanguage: false,
    };
  }

  const weekPubs = facts.publications.filter(
    (p) =>
      p.status === 'published' &&
      inWeek(p.publishedAt, facts.weekStartedAt, facts.weekEndedAt)
  );
  const weekObs = facts.observations.filter((o) =>
    inWeek(o.occurredAt, facts.weekStartedAt, facts.weekEndedAt)
  );
  const recommendations = projectWeeklyRecommendations(facts);

  const unknowns: string[] = [];
  if (weekPubs.length === 0) unknowns.push('本周无已发布记录');
  if (weekObs.length === 0) unknowns.push('本周无结果信号');
  for (const pub of weekPubs) {
    const hasObs = weekObs.some(
      (o) => o.contentPackageId === pub.contentPackageId
    );
    if (!hasObs) {
      unknowns.push(
        `${packageTitle(facts.packages, pub.contentPackageId)} 缺少结果信号`
      );
    }
  }

  if (weekPubs.length === 0 && weekObs.length === 0) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'empty_week',
      message: '本周还没有可复盘的发布或结果信号。',
      unknowns,
      recommendations: [],
      hasAutoRoi: false,
      hasCausalLanguage: false,
    };
  }

  if (
    weekPubs.length + weekObs.length < 2 &&
    recommendations.every((r) => r.mode === 'exploratory')
  ) {
    // Still show exploratory panel rather than hard empty — merchant can act.
  }

  return {
    kind: 'ready',
    heading,
    weekLabel: `${formatDay(facts.weekStartedAt)} – ${formatDay(facts.weekEndedAt)}`,
    published: weekPubs.map((p) => {
      const meta = packageMeta(facts.packages, p.contentPackageId);
      return {
        packageId: p.contentPackageId,
        packageTitle: packageTitle(facts.packages, p.contentPackageId),
        platform: p.platform,
        publishedAtLabel: formatDay(p.publishedAt),
        sourceTierLabel:
          p.sourceTier === 'verified_callback' ? '已验证平台回执' : '人工补记',
        revisionLabel: `r${p.contentPackageRevision}`,
        ctaLabel: meta?.ctaLabel ?? '未知 CTA',
      };
    }),
    observed: weekObs.map((o) => ({
      packageId: o.contentPackageId,
      packageTitle: packageTitle(facts.packages, o.contentPackageId),
      kindLabel: OUTCOME_OBSERVATION_KIND_LABEL[o.kind],
      sourceTierLabel: OUTCOME_SOURCE_TIER_LABEL[o.sourceTier],
      occurredAtLabel: formatDay(o.occurredAt),
    })),
    unknowns,
    recommendations,
    hasAutoRoi: false,
    hasCausalLanguage: false,
  };
}

/**
 * User confirmed a next-round action → snapshot intent only.
 * stop_series records a decision without snapshot intent.
 */
export function confirmWeeklyRecommendation(input: {
  workspaceId: string;
  packageId: string;
  sourceRevision: number;
  action: WeeklyNextAction;
  decidedAt: string;
}):
  | {
      kind: 'snapshot_intent';
      intent: WeeklySnapshotIntent;
      decision: WeeklyReviewDecisionRecord;
    }
  | { kind: 'decision_only'; decision: WeeklyReviewDecisionRecord } {
  const decision: WeeklyReviewDecisionRecord = {
    packageId: input.packageId,
    action: input.action,
    decidedAt: input.decidedAt,
    promotesLongTermPreference: false,
  };

  if (input.action === 'stop_series') {
    return { kind: 'decision_only', decision };
  }

  return {
    kind: 'snapshot_intent',
    intent: {
      kind: 'creation_execution_snapshot_intent',
      action: input.action,
      sourcePackageId: input.packageId,
      sourceRevision: input.sourceRevision,
      workspaceId: input.workspaceId,
      inherit: {
        structure: true,
        style: true,
        materialRoles: true,
      },
      recompileOnSubmit: true,
      promotesLongTermPreference: false,
    },
    decision,
  };
}

/**
 * W08: the three next-round actions must produce three different creations.
 *
 * They compiled to a byte-identical `derive_creative_work` payload — the action
 * was recorded and then dropped on the floor, so 「换 CTA」 and 「续做」 handed the
 * merchant the same draft. What differs is the sentence the next round is
 * prefilled with, and which parts of the source it carries forward.
 *
 * Pure: the page owns the write.
 */
export type WeeklyDeriveInheritanceField =
  | 'content_structure'
  | 'copy_skeleton'
  | 'layout_slots'
  | 'visual_style';

export type WeeklyDerivePayload = {
  autoConfirmBrief: false;
  intent: string;
  sessionId: string;
  sourceReferences: Array<{
    id: string;
    kind: 'work' | 'content';
    inheritanceFields?: WeeklyDeriveInheritanceField[];
  }>;
  sourceWorkId: string;
};

export function weeklyReviewDerivePayload(input: {
  action: Exclude<WeeklyNextAction, 'stop_series'>;
  sourcePackageId: string;
  sourceWorkId: string;
  title?: string;
  ctaLabel?: string;
  platformLabel?: string;
}): WeeklyDerivePayload {
  const title = input.title?.trim() || '上一条内容';
  const shared = {
    autoConfirmBrief: false as const,
    sessionId: `weekly:${input.action}:${input.sourceWorkId}`,
    sourceWorkId: input.sourceWorkId,
  };
  const lineage = { id: input.sourcePackageId, kind: 'content' as const };
  switch (input.action) {
    case 'continue_series':
      return {
        ...shared,
        intent: `接着「${title}」再做一条，说法和结构都照上一条来。`,
        sourceReferences: [
          {
            id: input.sourceWorkId,
            kind: 'work',
            inheritanceFields: ['content_structure', 'copy_skeleton'],
          },
          lineage,
        ],
      };
    case 'change_cta':
      return {
        ...shared,
        intent: input.ctaLabel?.trim()
          ? `还是「${title}」这条，把结尾那句「${input.ctaLabel.trim()}」换个说法请顾客行动。`
          : `还是「${title}」这条，换一句请顾客行动的话。`,
        sourceReferences: [
          {
            id: input.sourceWorkId,
            kind: 'work',
            inheritanceFields: ['content_structure'],
          },
          lineage,
        ],
      };
    case 'change_platform':
      return {
        ...shared,
        intent: input.platformLabel?.trim()
          ? `把「${title}」这条改成不发${input.platformLabel.trim()}、换个平台也读得顺的版本。`
          : `把「${title}」这条改成换个平台也读得顺的版本。`,
        sourceReferences: [
          {
            id: input.sourceWorkId,
            kind: 'work',
            inheritanceFields: ['copy_skeleton'],
          },
          lineage,
        ],
      };
  }
}
