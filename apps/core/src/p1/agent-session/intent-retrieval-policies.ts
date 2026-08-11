/**
 * Intent/retrieval policy middleware bindings (V31-07).
 *
 * - question_budget: after_model — max 1 ask per Intent/Plan; no re-ask known
 * - high_risk_assumption_gate: after_model — strip rights/facts/fees LLM defaults
 * Tool governance stays pinned in the release manifest, while the production
 * AgentToolRegistry enforces phase/maxCalls directly on tool execution.
 *
 * Bindings order is caller/release-owned; helpers emit live after-model policies.
 */

import type { HarnessMiddlewareBinding } from '@meiye/contracts';

import {
  admitMerchantQuestion,
  createQuestionBudgetState,
  filterAssumptionsForAuthority,
  markKnownFields,
  recordMerchantQuestion,
  type ImpactCategory,
  type QuestionBudgetState,
} from './ambiguity-policy.js';
import type {
  AfterModelPolicy,
  PolicyControlDecision,
} from './policy-middleware.js';
import type { AgentTurnDecision } from './turn-contracts.js';

export const INTENT_RETRIEVAL_POLICY_IDS = {
  questionBudget: 'session.question_budget',
  highRiskAssumption: 'session.high_risk_assumption_gate',
  toolGovernance: 'session.tool_governance',
} as const;

export type IntentRetrievalPolicyOptions = {
  /** Fields already known from projection/retrieval (do not re-ask). */
  knownFields?: readonly string[];
  /** Assumption key → impact for high-risk filter. */
  impactByKey?: ReadonlyMap<string, ImpactCategory>;
  /** Keys with system/merchant authority. */
  authoritativeKeys?: ReadonlySet<string>;
  /** Shared budget state across turns when session reuses runner. */
  budgetState?: QuestionBudgetState;
};

export function createQuestionBudgetBinding(
  order = 10,
): HarnessMiddlewareBinding {
  return {
    policyId: INTENT_RETRIEVAL_POLICY_IDS.questionBudget,
    revision: 'v31-07',
    kind: 'after_model',
    order,
    allowedControlActions: ['continue', 'end_turn', 'ask_merchant'],
  };
}

export function createHighRiskAssumptionBinding(
  order = 20,
): HarnessMiddlewareBinding {
  return {
    policyId: INTENT_RETRIEVAL_POLICY_IDS.highRiskAssumption,
    revision: 'v31-07',
    kind: 'after_model',
    order,
    allowedControlActions: ['continue', 'ask_merchant'],
  };
}

export function createToolGovernanceBinding(
  order = 0,
): HarnessMiddlewareBinding {
  return {
    policyId: INTENT_RETRIEVAL_POLICY_IDS.toolGovernance,
    revision: 'v31-07',
    kind: 'wrap_tool_call',
    order,
    allowedControlActions: ['continue'],
  };
}

export function createDefaultIntentRetrievalBindings(): HarnessMiddlewareBinding[] {
  return [
    createToolGovernanceBinding(0),
    createQuestionBudgetBinding(10),
    createHighRiskAssumptionBinding(20),
  ];
}

/**
 * A release that does not pin these three gates runs Intent turns with no
 * question budget, no high-risk assumption filter and no tool governance. That
 * used to be repaired by merging the defaults in at assembly time, which meant
 * an incomplete manifest could never be observed — so it is now a hard failure
 * on the release that lacks them.
 */
export function assertIntentRetrievalBindingsPinned(input: {
  releaseId: string;
  bindings: readonly HarnessMiddlewareBinding[];
}): void {
  const pinned = new Set(
    input.bindings.map(
      (binding) => `${binding.policyId}@${binding.revision}:${binding.kind}`,
    ),
  );
  const missing = createDefaultIntentRetrievalBindings()
    .map((binding) => `${binding.policyId}@${binding.revision}:${binding.kind}`)
    .filter((key) => !pinned.has(key));
  if (missing.length > 0) {
    throw new Error(
      `HarnessRelease ${input.releaseId} does not pin required Intent/retrieval middleware: ${missing.join(', ')}.`,
    );
  }
}

function asDecision(modelOutput: unknown): AgentTurnDecision | null {
  if (
    modelOutput &&
    typeof modelOutput === 'object' &&
    'action' in modelOutput &&
    'assumptions' in modelOutput
  ) {
    return modelOutput as AgentTurnDecision;
  }
  return null;
}

/**
 * Build the two live after_model policies for intent/retrieval gates.
 * State is closed over so the budget persists across turns.
 */
export function createIntentRetrievalPolicies(
  options: IntentRetrievalPolicyOptions = {},
): AfterModelPolicy[] {
  const budget =
    options.budgetState ??
    createQuestionBudgetState(options.knownFields ?? []);
  if (options.knownFields?.length) {
    markKnownFields(budget, options.knownFields);
  }
  const questionBudgetPolicy: AfterModelPolicy = {
    binding: createQuestionBudgetBinding(),
    afterModel: (ctx): PolicyControlDecision => {
      const decision = asDecision(ctx.modelOutput);
      if (!decision || decision.action.kind !== 'ask_merchant') {
        return { control: 'continue' };
      }
      const field =
        decision.action.question.itemId ||
        decision.action.question.question.slice(0, 80);
      const admission = admitMerchantQuestion({
        phase: ctx.phase,
        field,
        state: budget,
        maxPerPhase: 1,
        lowRiskFallback: {
          statement: `本轮问题预算已用尽，暂以可逆默认继续：${field}`,
        },
      });
      if (!admission.allowed) {
        if (admission.fallbackAssumption) {
          // Convert ask → continue with visible low-risk assumption patch.
          return {
            control: 'continue',
            patch: {
              questionBudgetRefusal: {
                gateId: admission.gateId,
                reason: admission.reason,
              },
              forcedAssumption: admission.fallbackAssumption,
              suppressAsk: true,
            },
          };
        }
        return {
          control: 'continue',
          patch: {
            questionBudgetRefusal: {
              gateId: admission.gateId,
              reason: admission.reason,
            },
            suppressAsk: true,
          },
        };
      }
      recordMerchantQuestion(budget, ctx.phase, field);
      return {
        control: 'ask_merchant',
        question: decision.action.question,
        reason: 'question_budget_admitted',
      };
    },
  };

  const highRiskPolicy: AfterModelPolicy = {
    binding: createHighRiskAssumptionBinding(),
    afterModel: (ctx): PolicyControlDecision => {
      const decision = asDecision(ctx.modelOutput);
      if (!decision) return { control: 'continue' };
      const filtered = filterAssumptionsForAuthority({
        assumptions: decision.assumptions,
        impactByKey: options.impactByKey,
        authoritativeKeys: options.authoritativeKeys,
      });
      if (filtered.blocked.length === 0) {
        return { control: 'continue' };
      }
      return {
        control: 'continue',
        patch: {
          assumptionsFiltered: filtered.assumptions,
          highRiskBlocked: filtered.blocked,
        },
      };
    },
  };

  return [questionBudgetPolicy, highRiskPolicy];
}

/**
 * Apply after_model patches onto a decision (deterministic post-policy).
 * Used by turn-runner so suppressAsk / filtered assumptions take effect.
 */
export function applyIntentRetrievalDecisionPatch(
  decision: AgentTurnDecision,
  state: Record<string, unknown>,
): AgentTurnDecision {
  let next = decision;

  if (state.assumptionsFiltered && Array.isArray(state.assumptionsFiltered)) {
    next = {
      ...next,
      assumptions: state.assumptionsFiltered as AgentTurnDecision['assumptions'],
    };
  }

  if (state.forcedAssumption && typeof state.forcedAssumption === 'object') {
    const forced = state.forcedAssumption as {
      key: string;
      statement: string;
      risk: 'low' | 'medium' | 'high';
    };
    const without = next.assumptions.filter((item) => item.key !== forced.key);
    next = {
      ...next,
      assumptions: [
        ...without,
        {
          key: forced.key,
          statement: forced.statement,
          risk: forced.risk,
        },
      ],
    };
  }

  if (state.suppressAsk === true && next.action.kind === 'ask_merchant') {
    next = {
      ...next,
      action: { kind: 'finish_turn' },
      merchantMessage:
        next.merchantMessage ||
        '已根据已知信息与可逆默认继续，本轮不再追问。',
    };
  }

  return next;
}
