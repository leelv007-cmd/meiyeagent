/**
 * Marketing plan readiness projection (V3.1 §13 / §16 / V31-09).
 *
 * Readiness is never stored on MarketingPlanRevision (no lifecycle status column).
 * PlanCompiler is the sole writer of revisions; readiness has no second writer —
 * callers always recompute via this pure projection.
 */

import type {
  MarketingPlanReadiness,
  MarketingPlanRevision,
} from '@meiye/contracts';

export type PlanReadinessFacts = {
  /** Current context bundle revision for the bound bundle id. */
  contextRevision?: string;
  recipeRevisionIds?: readonly string[];
  catalogRevisionId?: string;
  modelRevisionIds?: readonly string[];
  sourceRevisionIds?: readonly string[];
  rightsRevisionIds?: readonly string[];
  /** True when the bound quote is past its validity window. */
  quoteExpired?: boolean;
  /** True when billing domain re-quoted and revision no longer matches. */
  quoteRevisionChanged?: boolean;
  /** Hard block: rights withdrawn / compliance fail / capability missing. */
  blocked?: boolean;
  modelUnavailable?: boolean;
  complianceBlocked?: boolean;
};

function sameIdSet(
  bound: readonly string[],
  current: readonly string[] | undefined,
): boolean {
  if (current === undefined) return true;
  if (bound.length !== current.length) return false;
  const left = [...bound].sort();
  const right = [...current].sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * Project readiness from an immutable revision + live external facts.
 * Pure function — never mutates the revision.
 */
export function projectMarketingPlanReadiness(input: {
  revision: MarketingPlanRevision;
  facts: PlanReadinessFacts;
  now: string;
}): MarketingPlanReadiness {
  const { revision, facts, now } = input;

  if (
    facts.blocked === true ||
    facts.modelUnavailable === true ||
    facts.complianceBlocked === true
  ) {
    return 'blocked';
  }

  if (facts.quoteExpired === true || facts.quoteRevisionChanged === true) {
    return 'reprice_required';
  }

  if (Date.parse(revision.expiresAt) <= Date.parse(now)) {
    return 'reprice_required';
  }

  const bound = revision.boundRevisions;
  const stale =
    (facts.contextRevision !== undefined &&
      facts.contextRevision !== bound.contextRevision) ||
    (facts.catalogRevisionId !== undefined &&
      facts.catalogRevisionId !== bound.catalogRevisionId) ||
    !sameIdSet(bound.recipeRevisionIds, facts.recipeRevisionIds) ||
    !sameIdSet(bound.modelRevisionIds, facts.modelRevisionIds) ||
    !sameIdSet(bound.sourceRevisionIds, facts.sourceRevisionIds) ||
    !sameIdSet(bound.rightsRevisionIds, facts.rightsRevisionIds);

  if (stale) return 'stale';
  return 'ready';
}

/**
 * Ownership guard: readiness must never be written onto a plan revision payload.
 * Constructive check used by compiler + store tests.
 */
export function assertNoReadinessWriterOnRevision(
  payload: Record<string, unknown>,
): void {
  if (
    'status' in payload ||
    'readiness' in payload ||
    'lifecycleStatus' in payload
  ) {
    throw new Error(
      'MarketingPlanRevision must not carry status/readiness columns (projection only).',
    );
  }
}
