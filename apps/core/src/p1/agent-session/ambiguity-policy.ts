/**
 * Retained Intent/Plan question budget and high-risk assumption gate.
 * Intent/Plan each allow one merchant question and known fields are not re-asked.
 */

import type { AgentTurnPhase } from './turn-contracts.js';

export type ImpactCategory =
  | 'cosmetic'
  | 'strategy'
  | 'rights'
  | 'facts'
  | 'fees'
  | 'external_action';

export type VisibleAssumption = {
  key: string;
  statement: string;
  risk: 'low' | 'medium' | 'high';
  userVisible: true;
  reversible: boolean;
};

export type QuestionBudgetState = {
  intentAsked: number;
  planAsked: number;
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

export function markKnownFields(
  state: QuestionBudgetState,
  fields: readonly string[],
): void {
  for (const field of fields) state.knownFields.add(field);
}

function remainingQuestionBudget(
  phase: AgentTurnPhase | string,
  state: QuestionBudgetState,
  maxPerPhase: number,
): number {
  if (phase === 'intent') return Math.max(0, maxPerPhase - state.intentAsked);
  if (phase === 'plan') return Math.max(0, maxPerPhase - state.planAsked);
  return 0;
}

export type AskAdmission =
  | { allowed: true }
  | {
      allowed: false;
      gateId: string;
      reason: string;
      fallbackAssumption?: VisibleAssumption;
    };

export function admitMerchantQuestion(input: {
  phase: AgentTurnPhase | string;
  field: string;
  state: QuestionBudgetState;
  maxPerPhase?: number;
  lowRiskFallback?: { statement: string };
}): AskAdmission {
  if (
    input.state.knownFields.has(input.field) ||
    input.state.askedFields.has(input.field)
  ) {
    return {
      allowed: false,
      gateId: 'question_already_known',
      reason: `Field "${input.field}" is already known or was asked; do not re-ask.`,
    };
  }
  const maxPerPhase = input.maxPerPhase ?? 1;
  if (
    remainingQuestionBudget(input.phase, input.state, maxPerPhase) <= 0
  ) {
    return {
      allowed: false,
      gateId: 'question_budget_exhausted',
      reason: `Question budget exhausted for phase "${input.phase}" (max ${maxPerPhase}).`,
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

const HIGH_RISK_IMPACT = new Set<ImpactCategory>([
  'rights',
  'facts',
  'fees',
  'external_action',
]);

export function filterAssumptionsForAuthority(input: {
  assumptions: readonly {
    key: string;
    statement: string;
    risk: 'low' | 'medium' | 'high';
  }[];
  impactByKey?: ReadonlyMap<string, ImpactCategory>;
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
    if (impact && HIGH_RISK_IMPACT.has(impact) && !authoritative.has(item.key)) {
      blocked.push({
        key: item.key,
        reason: `High-risk impact "${impact}" on "${item.key}" cannot be LLM-defaulted.`,
      });
      continue;
    }
    if (item.risk === 'high' && !authoritative.has(item.key)) {
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
