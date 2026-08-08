/**
 * Ambiguity policy (V31-07 / V3.1 §17.3–§17.5).
 *
 * Fuzzy adaptation = impact category × reversibility × authority source → L0–L3.
 * Question budget: Intent/Plan each 1. Known fields are not re-asked.
 * Rights / facts / fees / external actions cannot be LLM-defaulted.
 */

import type { ProactiveMode, AgentTurnPhase } from './turn-contracts.js';

export const IMPACT_CATEGORIES = [
  'cosmetic',
  'strategy',
  'rights',
  'facts',
  'fees',
  'external_action',
] as const;
export type ImpactCategory = (typeof IMPACT_CATEGORIES)[number];

export const REVERSIBILITY = [
  'reversible',
  'hard_to_reverse',
  'irreversible',
] as const;
export type Reversibility = (typeof REVERSIBILITY)[number];

export const AUTHORITY_SOURCES = [
  'system_fact',
  'merchant_confirmed',
  'model_inferred',
  'unknown',
] as const;
export type AuthoritySource = (typeof AUTHORITY_SOURCES)[number];

export const AMBIGUITY_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const;
export type AmbiguityLevel = (typeof AMBIGUITY_LEVELS)[number];

export type AmbiguityResolution =
  | 'safe_default'
  | 'retrieve'
  | 'ask_user'
  | 'block';

export type AmbiguityAxes = {
  impact: ImpactCategory;
  reversibility: Reversibility;
  authority: AuthoritySource;
};

export type VisibleAssumption = {
  key: string;
  statement: string;
  risk: 'low' | 'medium' | 'high';
  userVisible: true;
  /** Low-risk defaults are reversible by merchant. */
  reversible: boolean;
};

export type AmbiguityDecision = {
  level: AmbiguityLevel;
  resolution: AmbiguityResolution;
  assumption?: VisibleAssumption;
  /** When resolution is ask_user. */
  questionField?: string;
  reason: string;
};

/** High-risk categories must not be filled by LLM defaults (exit gate). */
export const HIGH_RISK_IMPACT: ReadonlySet<ImpactCategory> = new Set([
  'rights',
  'facts',
  'fees',
  'external_action',
]);

export function isHighRiskImpact(impact: ImpactCategory): boolean {
  return HIGH_RISK_IMPACT.has(impact);
}

/**
 * Classify L0–L3 from three axes (no single confidence threshold).
 *
 * L0 clear (system/merchant authority + reversible cosmetic/strategy)
 * L1 safe reversible default
 * L2 material outcome impact → ask one high-value question
 * L3 rights/facts/fees/external or irreversible unknown → block / interrupt
 */
export function classifyAmbiguity(axes: AmbiguityAxes): AmbiguityLevel {
  if (isHighRiskImpact(axes.impact)) {
    if (
      axes.authority === 'system_fact' ||
      axes.authority === 'merchant_confirmed'
    ) {
      // Known high-risk from authority: no ambiguity (L0) — do not invent.
      return 'L0';
    }
    return 'L3';
  }

  if (axes.reversibility === 'irreversible' && axes.authority === 'unknown') {
    return 'L3';
  }

  if (
    axes.authority === 'system_fact' ||
    axes.authority === 'merchant_confirmed'
  ) {
    return 'L0';
  }

  if (
    axes.reversibility === 'reversible' &&
    (axes.impact === 'cosmetic' || axes.impact === 'strategy')
  ) {
    return axes.authority === 'model_inferred' ? 'L1' : 'L1';
  }

  if (axes.reversibility === 'hard_to_reverse') {
    return 'L2';
  }

  return 'L2';
}

/**
 * Apply proactive mode intensity on top of base level.
 * cautious: escalate L1→L2 (ask more)
 * balanced: keep
 * proactive: demote L2→L1 when reversible + non-high-risk (assume more)
 */
export function applyProactiveMode(
  level: AmbiguityLevel,
  mode: ProactiveMode,
  axes: AmbiguityAxes,
): AmbiguityLevel {
  if (isHighRiskImpact(axes.impact)) {
    // Proactivity never relaxes rights/facts/fees/external gates.
    return level === 'L0' ? 'L0' : 'L3';
  }
  if (mode === 'cautious') {
    if (level === 'L1') return 'L2';
    return level;
  }
  if (mode === 'proactive') {
    if (
      level === 'L2' &&
      axes.reversibility === 'reversible' &&
      !isHighRiskImpact(axes.impact)
    ) {
      return 'L1';
    }
    return level;
  }
  return level;
}

export function resolveAmbiguity(input: {
  axes: AmbiguityAxes;
  proactiveMode: ProactiveMode;
  field: string;
  safeDefaultStatement?: string;
}): AmbiguityDecision {
  const base = classifyAmbiguity(input.axes);
  const level = applyProactiveMode(base, input.proactiveMode, input.axes);

  if (level === 'L0') {
    return {
      level,
      resolution: 'safe_default',
      reason: 'Authoritative or unambiguous; no ask.',
    };
  }
  if (level === 'L3') {
    return {
      level,
      resolution: 'block',
      questionField: input.field,
      reason:
        'High-risk rights/facts/fees/external ambiguity cannot be LLM-defaulted.',
    };
  }
  if (level === 'L1') {
    const statement =
      input.safeDefaultStatement ??
      `采用可逆默认：${input.field}`;
    return {
      level,
      resolution: 'safe_default',
      assumption: {
        key: input.field,
        statement,
        risk: 'low',
        userVisible: true,
        reversible: true,
      },
      reason: 'Low-risk reversible default with visible assumption.',
    };
  }
  // L2
  return {
    level,
    resolution: 'ask_user',
    questionField: input.field,
    reason: 'Material impact; ask at most one high-value question.',
  };
}

// ─── Question budget ────────────────────────────────────────────────────────

export type QuestionBudgetState = {
  intentAsked: number;
  planAsked: number;
  /** Fields already known or already asked — do not re-ask. */
  knownFields: Set<string>;
  askedFields: Set<string>;
};

export function createQuestionBudgetState(
  knownFields: readonly string[] = [],
): QuestionBudgetState {
  return {
    intentAsked: 0,
    planAsked: 0,
    knownFields: new Set(knownFields),
    askedFields: new Set(),
  };
}

export function isFieldKnown(
  state: QuestionBudgetState,
  field: string,
): boolean {
  return state.knownFields.has(field) || state.askedFields.has(field);
}

export function markKnownFields(
  state: QuestionBudgetState,
  fields: readonly string[],
): void {
  for (const field of fields) state.knownFields.add(field);
}

/** Intent/Plan each allow 1 question; Make/Publish only safety/fees (caller gates). */
export function remainingQuestionBudget(
  phase: AgentTurnPhase | string,
  state: QuestionBudgetState,
  maxPerPhase = 1,
): number {
  if (phase === 'intent') return Math.max(0, maxPerPhase - state.intentAsked);
  if (phase === 'plan') return Math.max(0, maxPerPhase - state.planAsked);
  // Make/publish: budget is external (safety only) — treat as 0 for free-form asks here.
  return 0;
}

export type AskAdmission =
  | { allowed: true }
  | {
      allowed: false;
      gateId: string;
      reason: string;
      /** When budget exhausted, optional low-risk assumption to surface instead. */
      fallbackAssumption?: VisibleAssumption;
    };

/**
 * Admit one merchant question: budget + no re-ask known fields.
 */
export function admitMerchantQuestion(input: {
  phase: AgentTurnPhase | string;
  field: string;
  state: QuestionBudgetState;
  maxPerPhase?: number;
  /** When budget exhausted and field is low-risk, surface this instead of asking. */
  lowRiskFallback?: { statement: string };
}): AskAdmission {
  if (isFieldKnown(input.state, input.field)) {
    return {
      allowed: false,
      gateId: 'question_already_known',
      reason: `Field "${input.field}" is already known or was asked; do not re-ask.`,
    };
  }
  const remaining = remainingQuestionBudget(
    input.phase,
    input.state,
    input.maxPerPhase ?? 1,
  );
  if (remaining <= 0) {
    return {
      allowed: false,
      gateId: 'question_budget_exhausted',
      reason: `Question budget exhausted for phase "${input.phase}" (max ${input.maxPerPhase ?? 1}).`,
      ...(input.lowRiskFallback
        ? {
            fallbackAssumption: {
              key: input.field,
              statement: input.lowRiskFallback.statement,
              risk: 'low' as const,
              userVisible: true as const,
              reversible: true,
            },
          }
        : {}),
    };
  }
  return { allowed: true };
}

export function recordMerchantQuestion(
  state: QuestionBudgetState,
  phase: AgentTurnPhase | string,
  field: string,
): void {
  state.askedFields.add(field);
  if (phase === 'intent') state.intentAsked += 1;
  else if (phase === 'plan') state.planAsked += 1;
}

/**
 * Strip or block high-risk model assumptions that lack authority.
 * Returns cleaned assumptions + blocked keys.
 */
export function filterAssumptionsForAuthority(input: {
  assumptions: readonly {
    key: string;
    statement: string;
    risk: 'low' | 'medium' | 'high';
  }[];
  /** Map assumption key → impact category when known. */
  impactByKey?: ReadonlyMap<string, ImpactCategory>;
  /** Keys that already have system/merchant authority — keep even if high risk. */
  authoritativeKeys?: ReadonlySet<string>;
}): {
  assumptions: Array<{
    key: string;
    statement: string;
    risk: 'low' | 'medium' | 'high';
  }>;
  blocked: Array<{ key: string; reason: string }>;
} {
  const assumptions: Array<{
    key: string;
    statement: string;
    risk: 'low' | 'medium' | 'high';
  }> = [];
  const blocked: Array<{ key: string; reason: string }> = [];
  const authoritative = input.authoritativeKeys ?? new Set<string>();

  for (const item of input.assumptions) {
    const impact = input.impactByKey?.get(item.key);
    if (impact && isHighRiskImpact(impact) && !authoritative.has(item.key)) {
      blocked.push({
        key: item.key,
        reason: `High-risk impact "${impact}" on "${item.key}" cannot be LLM-defaulted.`,
      });
      continue;
    }
    if (item.risk === 'high' && !authoritative.has(item.key)) {
      // Conservative: unlabeled high-risk without authority is blocked.
      blocked.push({
        key: item.key,
        reason: `High-risk assumption "${item.key}" lacks system/merchant authority.`,
      });
      continue;
    }
    assumptions.push(item);
  }
  return { assumptions, blocked };
}
