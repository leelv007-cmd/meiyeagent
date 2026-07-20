/**
 * Conditional Brief trigger projection (A3 / #90, D-094).
 *
 * Seven code-level safety triggers — ops config CANNOT disable any of them.
 * On confirm, bind exact draft/recipe/model/quote/source revisions;
 * any drift re-triggers via confirmation_invalid.
 * Evidence drawer only when system-suggested / source-extracted facts
 * actually participate in the draft.
 */

import type {
  BriefBoundRevisions,
  BriefConfirmation,
  BriefEvidenceEntry,
  BriefHighRiskFactSignal,
  BriefSourceSignal,
  BriefSummaryFields,
  BriefTriggerConditionCode,
  BriefTriggerHit,
  BriefTriggerInput,
  BriefTriggerProjection,
  CreationLensId,
} from '@meiye/contracts';
import {
  BRIEF_IMAGE_COUNT_THRESHOLD,
  briefTriggerConditionCodes,
} from '@meiye/contracts';

/** Restricted source categories that always force Brief (D-094). */
export const RESTRICTED_SOURCE_CATEGORIES = new Set([
  'customer_case',
  'before_after',
  'review',
  'testimonial',
  'customer_review',
  'rating',
]);

const TRIGGER_REASONS: Record<BriefTriggerConditionCode, string> = {
  any_video: '本次包含视频生成，需确认成品、时长与费用',
  multi_deliverable_or_cross_platform: '多交付物或跨平台组合，需确认范围',
  images_over_four: `图片数量超过 ${BRIEF_IMAGE_COUNT_THRESHOLD} 张，需确认套图与费用`,
  restricted_assets: '使用了顾客案例、前后对比或评价等受限素材，需确认权利',
  high_risk_fact_missing_or_conflict: '价格、期限、效果或资质等关键事实缺失或冲突',
  quote_policy_threshold: '预计费用达到额外确认门槛',
  confirmation_invalid: '草稿、模板、模型、报价或来源已变化，需重新确认',
};

function isVideoTask(input: BriefTriggerInput): boolean {
  if (input.lensId === 'video') return true;
  const kind = (input.deliverableKind ?? '').toLowerCase();
  if (!kind) return false;
  return (
    kind === 'video' ||
    kind.startsWith('video_') ||
    kind.includes('video') ||
    kind === 'short_video' ||
    kind === 'ad_video'
  );
}

function isMultiDeliverableOrCrossPlatform(input: BriefTriggerInput): boolean {
  const deliverableCount = input.deliverableCount ?? 0;
  if (deliverableCount > 1) return true;
  const platforms = (input.platforms ?? []).filter(
    (p) => typeof p === 'string' && p.trim().length > 0,
  );
  return platforms.length > 1;
}

function isImagesOverFour(input: BriefTriggerInput): boolean {
  const count = input.imageCount ?? 0;
  return count > BRIEF_IMAGE_COUNT_THRESHOLD;
}

export function isRestrictedSource(source: BriefSourceSignal): boolean {
  if (source.restricted === true) return true;
  if (source.containsPerson === true) return true;
  const category = (source.category ?? '').toLowerCase();
  if (category && RESTRICTED_SOURCE_CATEGORIES.has(category)) return true;
  return false;
}

function hasRestrictedAssets(input: BriefTriggerInput): boolean {
  return (input.sources ?? []).some(isRestrictedSource);
}

function hasHighRiskFactIssue(input: BriefTriggerInput): boolean {
  return (input.highRiskFacts ?? []).some(
    (fact) => fact.status === 'missing' || fact.status === 'conflict',
  );
}

function hitsQuotePolicyThreshold(input: BriefTriggerInput): boolean {
  const quote = input.quote;
  if (!quote) return false;
  return quote.amount >= quote.extraConfirmThreshold;
}

/**
 * Compare bound revision tuples.
 * Nullish pairs match; only defined-side differences count as drift.
 */
export function briefRevisionsMatch(
  a: BriefBoundRevisions | null | undefined,
  b: BriefBoundRevisions | null | undefined,
): boolean {
  if (!a || !b) return false;
  const keys: Array<keyof BriefBoundRevisions> = [
    'draftRevisionId',
    'recipeRevisionId',
    'modelRevisionId',
    'quoteRevisionId',
    'sourceRevisionId',
    'surfaceRevisionId',
    'lensId',
  ];
  for (const key of keys) {
    const left = a[key] ?? null;
    const right = b[key] ?? null;
    if (left !== right) return false;
  }
  return true;
}

function evaluateSafetyTriggers(input: BriefTriggerInput): BriefTriggerHit[] {
  // Ops-disabled list is intentionally ignored — code-level safety policy.
  void input.opsDisabledTriggers;

  const hits: BriefTriggerHit[] = [];
  const maybePush = (code: BriefTriggerConditionCode, fired: boolean) => {
    if (!fired) return;
    hits.push({ code, reason: TRIGGER_REASONS[code] });
  };

  maybePush('any_video', isVideoTask(input));
  maybePush(
    'multi_deliverable_or_cross_platform',
    isMultiDeliverableOrCrossPlatform(input),
  );
  maybePush('images_over_four', isImagesOverFour(input));
  maybePush('restricted_assets', hasRestrictedAssets(input));
  maybePush(
    'high_risk_fact_missing_or_conflict',
    hasHighRiskFactIssue(input),
  );
  maybePush('quote_policy_threshold', hitsQuotePolicyThreshold(input));

  return hits;
}

/**
 * Evidence drawer: ONLY system_suggested or source_extracted facts that
 * actually participate in the draft. Never decorative empty shells.
 */
export function projectEvidenceDrawer(
  facts: BriefHighRiskFactSignal[] | undefined,
): BriefEvidenceEntry[] {
  if (!facts || facts.length === 0) return [];
  const entries: BriefEvidenceEntry[] = [];
  for (const fact of facts) {
    if (fact.participatesInDraft !== true) continue;
    if (
      fact.provenance !== 'system_suggested' &&
      fact.provenance !== 'source_extracted'
    ) {
      continue;
    }
    const entry: BriefEvidenceEntry = {
      sourceName: fact.sourceName ?? '系统建议',
      sourceType: fact.sourceType ?? fact.provenance,
      factKind: fact.kind,
    };
    if (fact.factSummary) entry.factSummary = fact.factSummary;
    if (fact.appliedLocation) entry.appliedLocation = fact.appliedLocation;
    if (fact.updatedAt) entry.updatedAt = fact.updatedAt;
    if (fact.freshness) entry.freshness = fact.freshness;
    if (fact.rightsStatus) entry.rightsStatus = fact.rightsStatus;
    if (fact.status === 'conflict' || fact.status === 'missing') {
      entry.uncertaintyOrConflict =
        fact.status === 'conflict' ? '事实冲突' : '事实缺失';
      entry.pendingConfirmation = true;
    }
    entries.push(entry);
  }
  return entries;
}

function buildSummary(input: BriefTriggerInput): BriefSummaryFields {
  const hints = input.summaryHints ?? {};
  const pending: string[] = [...(hints.pendingItems ?? [])];
  for (const fact of input.highRiskFacts ?? []) {
    if (fact.status === 'missing' || fact.status === 'conflict') {
      const label =
        fact.kind === 'price'
          ? '价格'
          : fact.kind === 'term'
            ? '期限'
            : fact.kind === 'effect'
              ? '效果'
              : '资质';
      const statusLabel = fact.status === 'missing' ? '缺失' : '冲突';
      pending.push(`${label}${statusLabel}`);
    }
  }
  const platforms =
    hints.platforms ??
    (input.platforms && input.platforms.length > 0
      ? [...input.platforms]
      : undefined);

  const summary: BriefSummaryFields = {
    targetDeliverable:
      hints.targetDeliverable ?? input.deliverableKind ?? null,
    sourceRightsSummary: hints.sourceRightsSummary ?? null,
    modelAndSettings: hints.modelAndSettings ?? null,
    impactScope: hints.impactScope ?? null,
    estimatedCost: hints.estimatedCost ?? null,
    estimatedDuration: hints.estimatedDuration ?? null,
  };
  if (platforms) summary.platforms = platforms;
  if (hints.keyFacts) summary.keyFacts = [...hints.keyFacts];
  if (pending.length > 0) summary.pendingItems = pending;
  return summary;
}

/**
 * Project whether the current draft requires a conditional Brief.
 *
 * Safety rules:
 * - Triggers 1–6 evaluate from live signals (ops cannot disable).
 * - If a prior confirmation still matches current revisions → no Brief.
 * - If prior confirmation drifted → confirmation_invalid + re-confirm.
 * - Without prior confirmation → Brief iff any of 1–6 fire.
 */
export function projectBriefTrigger(
  input: BriefTriggerInput,
): BriefTriggerProjection {
  const bindRevisions: BriefBoundRevisions = {
    draftRevisionId: input.currentRevisions.draftRevisionId,
    recipeRevisionId: input.currentRevisions.recipeRevisionId ?? null,
    modelRevisionId: input.currentRevisions.modelRevisionId ?? null,
    quoteRevisionId: input.currentRevisions.quoteRevisionId ?? null,
    sourceRevisionId: input.currentRevisions.sourceRevisionId ?? null,
    surfaceRevisionId: input.currentRevisions.surfaceRevisionId ?? null,
    lensId: (input.currentRevisions.lensId ??
      input.lensId ??
      null) as CreationLensId | null,
  };

  const confirmationValid = briefRevisionsMatch(
    input.confirmedRevisions,
    bindRevisions,
  );
  const hasPriorConfirm = Boolean(input.confirmedRevisions?.draftRevisionId);
  const confirmationInvalid = hasPriorConfirm && !confirmationValid;

  const safetyHits = evaluateSafetyTriggers(input);
  const triggers: BriefTriggerHit[] = [...safetyHits];

  if (confirmationInvalid) {
    // Ensure confirmation_invalid is present exactly once, stable order last
    // among safety hits that already fired, or appended.
    if (!triggers.some((t) => t.code === 'confirmation_invalid')) {
      triggers.push({
        code: 'confirmation_invalid',
        reason: TRIGGER_REASONS.confirmation_invalid,
      });
    }
  }

  // Already confirmed for this exact revision set → direct start path.
  const requiresBrief = confirmationValid
    ? false
    : confirmationInvalid || safetyHits.length > 0;

  return {
    requiresBrief,
    triggers: requiresBrief
      ? triggers
      : confirmationValid
        ? []
        : triggers,
    bindRevisions,
    confirmationInvalid,
    confirmationValid,
    evidenceDrawer: projectEvidenceDrawer(input.highRiskFacts),
    summary: buildSummary(input),
  };
}

/**
 * Confirm a conditional Brief, sealing the exact revision tuple.
 * Caller must re-project after any later revision drift.
 */
export function confirmBrief(input: {
  projection: BriefTriggerProjection;
  confirmedAt?: string;
}): BriefConfirmation {
  const { projection } = input;
  return {
    confirmedAt: input.confirmedAt ?? new Date().toISOString(),
    boundRevisions: { ...projection.bindRevisions },
    triggerCodes: projection.triggers.map((t) => t.code),
  };
}

/**
 * Re-check a sealed confirmation against live revisions.
 * True when any bound field drifted → must re-confirm.
 */
export function isBriefConfirmationInvalid(
  confirmed: BriefBoundRevisions,
  current: BriefBoundRevisions,
): boolean {
  return !briefRevisionsMatch(confirmed, current);
}

/** Exported for tests — full ordered code list. */
export function listBriefTriggerConditionCodes(): readonly BriefTriggerConditionCode[] {
  return briefTriggerConditionCodes;
}
