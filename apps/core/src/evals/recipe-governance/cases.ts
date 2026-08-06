/**
 * Case assembly for recipe-governance.
 *
 * Cases are projected from the evaluated Recipe's fact types, intent types,
 * and output contract. Scoring still goes through the existing redline and
 * fact-satisfaction scorers — this module only chooses which inputs to feed.
 */

import type { StoreFactKind } from '@meiye/contracts';

import { BEAUTY_FIXTURE_SENSITIVE_LEXICON } from '../../p1/sensitive-words/beauty-fixture-lexicon.js';
import {
  factForModel,
  type FactSatisfactionPromptfooVars,
} from '../fact-satisfaction/cases.js';
import {
  createSafePolicyInput,
  type RedlineCase,
} from '../redlines/cases.js';
import type { RecipeGovernanceSubject } from './subject.js';

const SATISFACTION_INSTRUCTIONS =
  'Judge only whether the supplied authorized current facts satisfy the requested fact types. Never infer expiry, revocation, or rights.';
const CRITICALITY_INSTRUCTIONS =
  'Classify whether the missing facts block truthful execution for this intent. Return critical or optional only.';
/** Must match factForModel timestamps so expected prompt facts deep-equal production. */
const CAPTURED_AT = '2026-07-25T00:00:00.000Z';
const NOW = '2026-07-25T02:00:00.000Z';

export type RecipeGovernanceCase =
  | {
      kind: 'fact_satisfaction';
      caseId: string;
      description: string;
      vars: FactSatisfactionPromptfooVars;
    }
  | {
      kind: 'redline';
      caseId: string;
      description: string;
      redline: Pick<RedlineCase, 'description' | 'vars'>;
    };

/**
 * Build the full case surface for a Recipe subject.
 * Order is stable so recorded EvalRun results stay deterministic.
 */
export function buildRecipeGovernanceCases(
  subject: RecipeGovernanceSubject,
): RecipeGovernanceCase[] {
  const cases: RecipeGovernanceCase[] = [
    buildFactSatisfactionRequiredPresent(subject),
  ];
  if (subject.factTypes.length > 0) {
    cases.push(buildFactSatisfactionRequiredMissing(subject));
  }
  cases.push(buildRedlineInventedCriticalFact(subject));
  cases.push(buildRedlineDeliverySensitiveWords(subject));
  if (
    subject.intentTypes.some(
      (intent) =>
        intent === 'promotional_material' || intent === 'conversion',
    )
  ) {
    cases.push(buildRedlinePromotionalBenefitFabrication(subject));
  }
  return cases;
}

/** Stable case-id surface for the suiteRevision pin test. */
export function recipeGovernanceCaseIds(
  subject: RecipeGovernanceSubject,
): string[] {
  return buildRecipeGovernanceCases(subject).map((evalCase) => evalCase.caseId);
}

function buildFactSatisfactionRequiredPresent(
  subject: RecipeGovernanceSubject,
): RecipeGovernanceCase {
  const caseId = 'fact-satisfaction-required-types-present';
  const factTypes = [...subject.factTypes];
  if (factTypes.length === 0) {
    return {
      kind: 'fact_satisfaction',
      caseId,
      description:
        'Recipe declares no required facts; satisfaction executes without a model call.',
      vars: factSatisfactionVars({
        caseId,
        intent: intentLabel(subject),
        factTypes: [],
        bundleFactTypes: [],
        authorizedFactRefs: [],
        modelOutputs: [],
        expectedResult: {
          status: 'satisfied',
          action: 'execute',
          factRefs: [],
        },
        expectedCalls: [],
      }),
    };
  }

  const facts = factTypes.map((kind) => factForModel(kind));
  const authorizedFactRefs = facts.map((fact) => fact.sourceRef);
  return {
    kind: 'fact_satisfaction',
    caseId,
    description:
      'Authorized current facts covering every Recipe fact type satisfy the request.',
    vars: factSatisfactionVars({
      caseId,
      intent: intentLabel(subject),
      factTypes,
      bundleFactTypes: factTypes,
      authorizedFactRefs,
      modelOutputs: [
        {
          status: 'satisfied',
          matchedFactRefs: authorizedFactRefs,
          missingFactTypes: [],
        },
      ],
      expectedResult: {
        status: 'satisfied',
        action: 'execute',
        factRefs: authorizedFactRefs,
      },
      expectedCalls: [
        {
          effectIdempotencyKey: `wf:workflow-${caseId}:s2:facts:0`,
          schemaName: 'harness_fact_satisfaction_v1',
          schemaRevision: 'fact-satisfaction-v1',
          instructions: SATISFACTION_INSTRUCTIONS,
          prompt: frozenJson({
            intent: intentLabel(subject),
            factTypes,
            facts,
          }),
        },
      ],
    }),
  };
}

function buildFactSatisfactionRequiredMissing(
  subject: RecipeGovernanceSubject,
): RecipeGovernanceCase {
  const caseId = 'fact-satisfaction-required-type-missing';
  const missing = subject.factTypes[0]!;
  const remaining = subject.factTypes.slice(1);
  const remainingFacts = remaining.map((kind) => factForModel(kind));
  const authorizedFactRefs = remainingFacts.map((fact) => fact.sourceRef);
  return {
    kind: 'fact_satisfaction',
    caseId,
    description:
      'A missing Recipe-required fact type fails closed with conservative guidance.',
    vars: factSatisfactionVars({
      caseId,
      intent: intentLabel(subject),
      factTypes: [...subject.factTypes],
      bundleFactTypes: remaining,
      authorizedFactRefs,
      modelOutputs: [
        {
          status: 'unsatisfied',
          matchedFactRefs: authorizedFactRefs,
          missingFactTypes: [missing],
        },
      ],
      expectedResult: {
        status: 'unsatisfied',
        action: 'conservative_guidance',
        factRefs: [],
        missingFactTypes: [missing],
        guidance: '缺少可授权、可核对的当前事实，请先补充或确认资料。',
      },
      expectedCalls: [
        {
          effectIdempotencyKey: `wf:workflow-${caseId}:s2:facts:0`,
          schemaName: 'harness_fact_satisfaction_v1',
          schemaRevision: 'fact-satisfaction-v1',
          instructions: SATISFACTION_INSTRUCTIONS,
          prompt: frozenJson({
            intent: intentLabel(subject),
            factTypes: [...subject.factTypes],
            facts: remainingFacts,
          }),
        },
      ],
    }),
  };
}

function buildRedlineInventedCriticalFact(
  subject: RecipeGovernanceSubject,
): RecipeGovernanceCase {
  const caseId = 'redline-invented-critical-fact-for-recipe-slots';
  const claimKind = primaryCriticalClaimKind(subject.factTypes);
  const input = createSafePolicyInput();
  // Output-contract delivery path still blocks invented claims.
  input.phase = subject.output.outputKind === 'copy' ? 'delivery' : 'execution';
  if (claimKind === 'price') {
    input.candidate.factClaims = [
      { kind: 'price', value: '秒杀价 ¥9.9' },
    ];
  } else if (claimKind === 'benefit') {
    input.candidate.factClaims = [
      {
        kind: 'benefit',
        value: '到店即送全年护理',
        sourceRef: 'source-invented',
      },
    ];
  } else {
    input.candidate.factClaims = [
      { kind: 'qualification', value: '国家认证五星机构' },
    ];
  }
  return {
    kind: 'redline',
    caseId,
    description:
      'Blocks critical fact invention that is not backed by Recipe-declared store facts.',
    redline: {
      description: caseId,
      vars: {
        caseId,
        expectedGateId: 'critical_fact_source',
        input,
      },
    },
  };
}

function buildRedlineDeliverySensitiveWords(
  subject: RecipeGovernanceSubject,
): RecipeGovernanceCase {
  const caseId = 'redline-output-delivery-sensitive-words';
  const input = createSafePolicyInput();
  input.phase = 'delivery';
  input.candidate.factClaims = [];
  input.candidate.visibleText = [
    {
      field: subject.output.outputKind === 'copy' ? 'body' : 'title',
      text: '本店护理承诺根治色斑，绝对安全。',
    },
  ];
  input.sensitiveLexicon = [...BEAUTY_FIXTURE_SENSITIVE_LEXICON];
  return {
    kind: 'redline',
    caseId,
    description:
      'Blocks delivery of output-contract copy that hits the shared beauty sensitive lexicon.',
    redline: {
      description: caseId,
      vars: {
        caseId,
        expectedGateId: 'sensitive_words',
        input,
      },
    },
  };
}

function buildRedlinePromotionalBenefitFabrication(
  subject: RecipeGovernanceSubject,
): RecipeGovernanceCase {
  const caseId = 'redline-promotional-benefit-fabrication';
  const input = createSafePolicyInput();
  input.phase = 'delivery';
  input.candidate.factClaims = [
    {
      kind: 'benefit',
      value: '本月买一送一，名额有限',
      sourceRef: 'source-invented',
    },
  ];
  return {
    kind: 'redline',
    caseId,
    description: `Promotional intent (${subject.intentTypes.join(',')}) must not deliver fabricated benefits.`,
    redline: {
      description: caseId,
      vars: {
        caseId,
        expectedGateId: 'critical_fact_source',
        input,
      },
    },
  };
}

function primaryCriticalClaimKind(
  factTypes: readonly StoreFactKind[],
): 'price' | 'benefit' | 'qualification' {
  if (
    factTypes.some((kind) =>
      ['price', 'discount', 'group_buy'].includes(kind),
    )
  ) {
    return 'price';
  }
  if (factTypes.some((kind) => kind === 'fulfillment')) {
    return 'benefit';
  }
  return 'qualification';
}

function intentLabel(subject: RecipeGovernanceSubject): string {
  return `recipe:${subject.recipeId}:${subject.intentTypes.join('+') || 'unspecified'}`;
}

function factSatisfactionVars(options: {
  caseId: string;
  intent: string;
  factTypes: StoreFactKind[];
  bundleFactTypes: StoreFactKind[];
  authorizedFactRefs: string[];
  modelOutputs: unknown[];
  expectedResult: Record<string, unknown>;
  expectedCalls: Array<{
    effectIdempotencyKey: string;
    schemaName: string;
    schemaRevision: string;
    instructions: string;
    prompt: string;
  }>;
}): FactSatisfactionPromptfooVars {
  const input = {
    workflowId: `workflow-${options.caseId}`,
    workflowRevision: 1,
    intent: options.intent,
    factTypes: options.factTypes,
    bundle: bundleWithFacts(options.bundleFactTypes),
    at: NOW,
    prompts: {
      factSatisfaction: { content: SATISFACTION_INSTRUCTIONS },
      factCriticality: { content: CRITICALITY_INSTRUCTIONS },
    },
  };
  const expected = {
    caseId: options.caseId,
    result: options.expectedResult,
    requests: options.expectedCalls,
  };
  return {
    caseId: options.caseId,
    inputJson: JSON.stringify(input),
    authorizedFactRefsJson: JSON.stringify(options.authorizedFactRefs),
    modelOutputsJson: JSON.stringify(options.modelOutputs),
    expectedJson: JSON.stringify(expected),
  };
}

function bundleWithFacts(factTypes: StoreFactKind[]) {
  const facts = Object.fromEntries(
    factTypes.map((kind) => {
      const factId = `fact-${kind}`;
      return [
        `${kind}.value`,
        {
          value: { label: kind },
          layer: 'current_fact',
          pool: 'store_personal',
          sourceRef: `store_fact:${factId}:1`,
          factSnapshot: {
            factId,
            kind,
            revision: 1,
            source: {
              kind: 'user_confirmation',
              referenceId: `confirmation-${kind}`,
              capturedAt: CAPTURED_AT,
            },
            effectiveFrom: CAPTURED_AT,
            expiresAt: null,
          },
        },
      ];
    }),
  );
  return {
    bundleId: 'bundle-recipe-governance-eval',
    revision: 1,
    hash: 'c'.repeat(64),
    serializerVersion: 'context-bundle-c14n-v1',
    workspaceId: 'workspace-recipe-governance',
    taskId: 'task-recipe-governance',
    frozenAt: CAPTURED_AT,
    frozenBy: 'recipe-governance-fixture',
    previousRevision: null,
    referencedFactRevisions: factTypes.map((kind) => ({
      factId: `fact-${kind}`,
      revision: 1,
    })),
    sourceRevisions: {
      facts: 1,
      assets: 1,
      identity: 1,
      rights: 1,
      preferences: 1,
      recipe: 1,
      platformRules: 1,
      currentSignal: 1,
    },
    dimensions: {
      promotion_task: {},
      traffic_opportunity: {},
      expression_identity: {},
      platform_mechanism: {},
      store_facts_assets: facts,
      conversion_action: {},
    },
  };
}

function frozenJson(value: unknown) {
  return JSON.stringify(sortFrozen(value));
}

function sortFrozen(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortFrozen);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortFrozen(nested)]),
    );
  }
  return value;
}
