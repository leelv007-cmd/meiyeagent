/**
 * Readable Living Plan revision diff (V31-10 / V3.1 §5.3).
 *
 * Adjustments produce a new revision; UI shows what changed between two
 * merchant-facing projections. Pure — no store writes.
 */

import {
  LIVING_PLAN_SECTION_KEYS,
  LIVING_PLAN_SECTION_TITLES,
  projectLivingPlanView,
  type LivingPlanRevisionFacts,
  type LivingPlanSectionKey,
  type LivingPlanView,
} from './living-plan-model';

export type PlanDiffChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';

export type PlanDiffEntry = {
  sectionKey: LivingPlanSectionKey;
  sectionTitle: string;
  kind: PlanDiffChangeKind;
  before: string;
  after: string;
  /** Merchant-readable one-line change. */
  summary: string;
};

export type PlanDiffView = {
  planId: string;
  fromRevision: number;
  toRevision: number;
  entries: readonly PlanDiffEntry[];
  /** Only non-unchanged entries (what the merchant should read). */
  changedEntries: readonly PlanDiffEntry[];
  hasChanges: boolean;
  adjustmentSummary?: string;
};

/**
 * Diff two Living Plan views section-by-section (body text comparison).
 */
export function diffLivingPlanViews(
  before: LivingPlanView,
  after: LivingPlanView
): PlanDiffView {
  const beforeByKey = new Map(
    before.sections.map((section) => [section.key, section])
  );
  const afterByKey = new Map(
    after.sections.map((section) => [section.key, section])
  );

  const entries: PlanDiffEntry[] = LIVING_PLAN_SECTION_KEYS.map((key) => {
    const left = beforeByKey.get(key);
    const right = afterByKey.get(key);
    const beforeBody = left?.body?.trim() ?? '';
    const afterBody = right?.body?.trim() ?? '';
    const title = LIVING_PLAN_SECTION_TITLES[key];

    let kind: PlanDiffChangeKind = 'unchanged';
    if (!beforeBody && afterBody) kind = 'added';
    else if (beforeBody && !afterBody) kind = 'removed';
    else if (beforeBody !== afterBody) kind = 'changed';

    return {
      sectionKey: key,
      sectionTitle: title,
      kind,
      before: beforeBody,
      after: afterBody,
      summary: formatDiffSummary(title, kind, beforeBody, afterBody),
    };
  });

  const changedEntries = entries.filter((entry) => entry.kind !== 'unchanged');

  return {
    planId: after.planId || before.planId,
    fromRevision: before.revision,
    toRevision: after.revision,
    entries,
    changedEntries,
    hasChanges: changedEntries.length > 0,
    adjustmentSummary: after.adjustmentSummary,
  };
}

/**
 * Diff two revision facts (projects then compares).
 */
export function diffLivingPlanFacts(
  before: LivingPlanRevisionFacts,
  after: LivingPlanRevisionFacts
): PlanDiffView {
  return diffLivingPlanViews(
    projectLivingPlanView(before),
    projectLivingPlanView(after)
  );
}

function formatDiffSummary(
  title: string,
  kind: PlanDiffChangeKind,
  before: string,
  after: string
): string {
  switch (kind) {
    case 'added':
      return `${title}：新增「${truncate(after)}」`;
    case 'removed':
      return `${title}：移除「${truncate(before)}」`;
    case 'changed':
      return `${title}：「${truncate(before)}」→「${truncate(after)}」`;
    case 'unchanged':
      return `${title}：无变化`;
  }
}

function truncate(value: string, max = 48): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}
