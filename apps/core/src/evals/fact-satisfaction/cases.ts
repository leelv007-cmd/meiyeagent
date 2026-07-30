import {
  contextBundleSchema,
  type ContextBundle,
  type StoreFactKind,
} from '@meiye/contracts';

const NOW = '2026-07-25T02:00:00.000Z';
const CAPTURED_AT = '2026-07-25T00:00:00.000Z';
const SATISFACTION_INSTRUCTIONS =
  'Judge only whether the supplied authorized current facts satisfy the requested fact types. Never infer expiry, revocation, or rights.';
const CRITICALITY_INSTRUCTIONS =
  'Classify whether the missing facts block truthful execution for this intent. Return critical or optional only.';
const EXACT_SCORER =
  'file://apps/core/src/evals/fact-satisfaction/promptfoo-scorer.ts';

export interface FrozenStructuredRequest {
  effectIdempotencyKey: string;
  schemaName: string;
  schemaRevision: string;
  instructions: string;
  prompt: string;
}

export interface FactSatisfactionPromptfooVars {
  caseId: string;
  inputJson: string;
  authorizedFactRefsJson: string;
  modelOutputsJson: string;
  expectedJson: string;
}

export interface FactSatisfactionEvalInput {
  workflowId: string;
  workflowRevision: number;
  intent: string;
  factTypes: StoreFactKind[];
  bundle: ContextBundle;
  at: string;
  prompts: {
    factSatisfaction: { content: string };
    factCriticality: { content: string };
  };
}

export interface FactSatisfactionEvalObservation {
  caseId: string;
  result: Record<string, unknown>;
  requests: FrozenStructuredRequest[];
}

export interface FactSatisfactionPromptfooCase {
  description: string;
  assert: Array<{ type: 'javascript'; value: string }>;
  vars: FactSatisfactionPromptfooVars;
}

function evaluationCase(
  caseId: string,
  description: string,
  options: {
    factTypes: StoreFactKind[];
    bundleFactTypes: StoreFactKind[];
    authorizedFactRefs?: string[];
    modelOutputs: unknown[];
    expectedResult: Record<string, unknown>;
    expectedCalls: FrozenStructuredRequest[];
    bundleOptions?: {
      expiresAt?: string | null;
      revisionKind?: 'revocation';
    };
  },
): FactSatisfactionPromptfooCase {
  const input = {
    workflowId: `workflow-${caseId}`,
    workflowRevision: 3,
    intent: '介绍服务和价格',
    factTypes: options.factTypes,
    bundle: bundleWithFacts(options.bundleFactTypes, options.bundleOptions),
    at: NOW,
    prompts: {
      factSatisfaction: { content: SATISFACTION_INSTRUCTIONS },
      factCriticality: { content: CRITICALITY_INSTRUCTIONS },
    },
  };
  const expected: FactSatisfactionEvalObservation = {
    caseId,
    result: options.expectedResult,
    requests: options.expectedCalls,
  };
  return {
    description,
    assert: [{ type: 'javascript', value: EXACT_SCORER }],
    vars: {
      caseId,
      inputJson: JSON.stringify(input),
      authorizedFactRefsJson: JSON.stringify(
        options.authorizedFactRefs ?? [],
      ),
      modelOutputsJson: JSON.stringify(options.modelOutputs),
      expectedJson: JSON.stringify(expected),
    },
  };
}

const serviceFact = factForModel('service');
const priceFact = factForModel('price');

export const FACT_SATISFACTION_CASES: FactSatisfactionPromptfooCase[] = [
  evaluationCase('no-required-facts', 'No required facts execute without a model call', {
    factTypes: [],
    bundleFactTypes: [],
    modelOutputs: [],
    expectedResult: {
      status: 'satisfied',
      action: 'execute',
      factRefs: [],
    },
    expectedCalls: [],
  }),
  evaluationCase(
    'service-and-price-satisfied',
    'Authorized current service and price facts satisfy the request',
    {
      factTypes: ['service', 'price'],
      bundleFactTypes: ['service', 'price'],
      authorizedFactRefs: [serviceFact.sourceRef, priceFact.sourceRef],
      modelOutputs: [
        {
          status: 'satisfied',
          matchedFactRefs: [serviceFact.sourceRef, priceFact.sourceRef],
          missingFactTypes: [],
        },
      ],
      expectedResult: {
        status: 'satisfied',
        action: 'execute',
        factRefs: [serviceFact.sourceRef, priceFact.sourceRef],
      },
      expectedCalls: [
        satisfactionRequest('service-and-price-satisfied', ['service', 'price'], [
          serviceFact,
          priceFact,
        ]),
      ],
    },
  ),
  evaluationCase(
    'price-unsatisfied',
    'A missing price fact returns conservative guidance',
    {
      factTypes: ['price'],
      bundleFactTypes: [],
      modelOutputs: [
        {
          status: 'unsatisfied',
          matchedFactRefs: [],
          missingFactTypes: ['price'],
        },
      ],
      expectedResult: conservativeResult(['price']),
      expectedCalls: [
        satisfactionRequest('price-unsatisfied', ['price'], []),
      ],
    },
  ),
  evaluationCase(
    'critical-price-partial',
    'A critical missing price asks for confirmation',
    {
      factTypes: ['service', 'price'],
      bundleFactTypes: ['service'],
      authorizedFactRefs: [serviceFact.sourceRef],
      modelOutputs: [
        {
          status: 'partial',
          matchedFactRefs: [serviceFact.sourceRef],
          missingFactTypes: ['price'],
        },
        { criticality: 'critical' },
      ],
      expectedResult: {
        status: 'partial',
        action: 'ask_user',
        factRefs: [serviceFact.sourceRef],
        missingFactTypes: ['price'],
        question: {
          questionId: 'workflow-critical-price-partial:s2:missing-facts',
          workflowId: 'workflow-critical-price-partial',
          workflowRevision: 3,
          question: '请确认本次创作要用的价格。',
          options: [],
          freeText: { enabled: true },
          response: {
            field: 'store_facts',
            reason: '补充当前任务所需的权威事实',
          },
          unattended: 'hold',
          scope: 'current_task',
        },
        ledgerIntake: {
          factTypes: ['price'],
          writePath: 'asset_intake.confirm_fact',
        },
      },
      expectedCalls: [
        satisfactionRequest(
          'critical-price-partial',
          ['service', 'price'],
          [serviceFact],
        ),
        criticalityRequest('critical-price-partial', ['price']),
      ],
    },
  ),
  evaluationCase(
    'optional-staff-experience-partial',
    'An optional missing staff fact executes with a visible notice',
    {
      factTypes: ['service', 'staff_experience'],
      bundleFactTypes: ['service'],
      authorizedFactRefs: [serviceFact.sourceRef],
      modelOutputs: [
        {
          status: 'partial',
          matchedFactRefs: [serviceFact.sourceRef],
          missingFactTypes: ['staff_experience'],
        },
        { criticality: 'optional' },
      ],
      expectedResult: {
        status: 'partial',
        action: 'execute_with_notice',
        factRefs: [serviceFact.sourceRef],
        missingFactTypes: ['staff_experience'],
        resultNotice: '本次结果没有使用尚未确认的员工经验。',
      },
      expectedCalls: [
        satisfactionRequest(
          'optional-staff-experience-partial',
          ['service', 'staff_experience'],
          [serviceFact],
        ),
        criticalityRequest(
          'optional-staff-experience-partial',
          ['staff_experience'],
        ),
      ],
    },
  ),
  evaluationCase(
    'expired-price-excluded',
    'Expired facts are absent from the frozen model prompt',
    {
      factTypes: ['price'],
      bundleFactTypes: ['price'],
      authorizedFactRefs: [priceFact.sourceRef],
      bundleOptions: { expiresAt: '2026-07-25T01:00:00.000Z' },
      modelOutputs: [
        {
          status: 'unsatisfied',
          matchedFactRefs: [],
          missingFactTypes: ['price'],
        },
      ],
      expectedResult: conservativeResult(['price']),
      expectedCalls: [
        satisfactionRequest('expired-price-excluded', ['price'], []),
      ],
    },
  ),
  evaluationCase(
    'revoked-price-excluded',
    'Revoked facts are absent from the frozen model prompt',
    {
      factTypes: ['price'],
      bundleFactTypes: ['price'],
      authorizedFactRefs: [priceFact.sourceRef],
      bundleOptions: { revisionKind: 'revocation' },
      modelOutputs: [
        {
          status: 'unsatisfied',
          matchedFactRefs: [],
          missingFactTypes: ['price'],
        },
      ],
      expectedResult: conservativeResult(['price']),
      expectedCalls: [
        satisfactionRequest('revoked-price-excluded', ['price'], []),
      ],
    },
  ),
  evaluationCase(
    'unauthorized-price-excluded',
    'Unauthorized facts are absent from the frozen model prompt',
    {
      factTypes: ['price'],
      bundleFactTypes: ['price'],
      modelOutputs: [
        {
          status: 'unsatisfied',
          matchedFactRefs: [],
          missingFactTypes: ['price'],
        },
      ],
      expectedResult: conservativeResult(['price']),
      expectedCalls: [
        satisfactionRequest('unauthorized-price-excluded', ['price'], []),
      ],
    },
  ),
  evaluationCase(
    'forged-reference-rejected',
    'A model-supplied reference outside the prompt fails closed',
    {
      factTypes: ['service'],
      bundleFactTypes: ['service'],
      authorizedFactRefs: [serviceFact.sourceRef],
      modelOutputs: [
        {
          status: 'satisfied',
          matchedFactRefs: ['store_fact:forged:99'],
          missingFactTypes: [],
        },
      ],
      expectedResult: conservativeResult(['service']),
      expectedCalls: [
        satisfactionRequest(
          'forged-reference-rejected',
          ['service'],
          [serviceFact],
        ),
      ],
    },
  ),
  evaluationCase(
    'incomplete-satisfied-rejected',
    'A satisfied claim without every requested kind fails closed',
    {
      factTypes: ['service', 'price'],
      bundleFactTypes: ['service'],
      authorizedFactRefs: [serviceFact.sourceRef],
      modelOutputs: [
        {
          status: 'satisfied',
          matchedFactRefs: [serviceFact.sourceRef],
          missingFactTypes: [],
        },
      ],
      expectedResult: conservativeResult(['service', 'price']),
      expectedCalls: [
        satisfactionRequest(
          'incomplete-satisfied-rejected',
          ['service', 'price'],
          [serviceFact],
        ),
      ],
    },
  ),
  evaluationCase(
    'incomplete-partial-rejected',
    'A partial claim that omits a requested kind fails closed',
    {
      factTypes: ['service', 'price', 'staff_experience'],
      bundleFactTypes: ['service'],
      authorizedFactRefs: [serviceFact.sourceRef],
      modelOutputs: [
        {
          status: 'partial',
          matchedFactRefs: [serviceFact.sourceRef],
          missingFactTypes: ['staff_experience'],
        },
      ],
      expectedResult: conservativeResult([
        'service',
        'price',
        'staff_experience',
      ]),
      expectedCalls: [
        satisfactionRequest(
          'incomplete-partial-rejected',
          ['service', 'price', 'staff_experience'],
          [serviceFact],
        ),
      ],
    },
  ),
];

export default FACT_SATISFACTION_CASES;

export function factForModel(kind: StoreFactKind) {
  return {
    sourceRef: `store_fact:fact-${kind}:1`,
    kind,
    value: { label: kind },
    source: {
      kind: 'user_confirmation' as const,
      referenceId: `confirmation-${kind}`,
      capturedAt: CAPTURED_AT,
    },
    effectiveFrom: CAPTURED_AT,
    expiresAt: null,
  };
}

function satisfactionRequest(
  caseId: string,
  factTypes: StoreFactKind[],
  facts: ReturnType<typeof factForModel>[],
): FrozenStructuredRequest {
  return {
    effectIdempotencyKey: `wf:workflow-${caseId}:s2:facts:0`,
    schemaName: 'harness_fact_satisfaction_v1',
    schemaRevision: 'fact-satisfaction-v1',
    instructions: SATISFACTION_INSTRUCTIONS,
    prompt: frozenJson({
      intent: '介绍服务和价格',
      factTypes,
      facts,
    }),
  };
}

function criticalityRequest(
  caseId: string,
  missingFactTypes: StoreFactKind[],
): FrozenStructuredRequest {
  return {
    effectIdempotencyKey: `wf:workflow-${caseId}:s2:facts:criticality:0`,
    schemaName: 'harness_fact_criticality_v1',
    schemaRevision: 'fact-criticality-v1',
    instructions: CRITICALITY_INSTRUCTIONS,
    prompt: frozenJson({
      intent: '介绍服务和价格',
      missingFactTypes,
    }),
  };
}

function conservativeResult(missingFactTypes: StoreFactKind[]) {
  return {
    status: 'unsatisfied',
    action: 'conservative_guidance',
    factRefs: [],
    missingFactTypes,
    guidance: '缺少可授权、可核对的当前事实，请先补充或确认资料。',
  };
}

function bundleWithFacts(
  factTypes: StoreFactKind[],
  options: {
    expiresAt?: string | null;
    revisionKind?: 'revocation';
  } = {},
): ContextBundle {
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
            expiresAt: options.expiresAt ?? null,
            ...(options.revisionKind
              ? { revisionKind: options.revisionKind }
              : {}),
          },
        },
      ];
    }),
  );
  return contextBundleSchema.parse({
    bundleId: 'bundle-fact-satisfaction-eval',
    revision: 1,
    hash: 'b'.repeat(64),
    serializerVersion: 'context-bundle-c14n-v1',
    workspaceId: 'workspace-eval',
    taskId: 'task-eval',
    frozenAt: CAPTURED_AT,
    frozenBy: 'eval-fixture',
    previousRevision: null,
    referencedFactRevisions: factTypes.map((kind) => ({
      factId: `fact-${kind}`,
      revision: 1,
    })),
    sourceRevisions: {
      facts: 3,
      assets: 4,
      identity: 2,
      rights: 8,
      preferences: 1,
      recipe: 2,
      platformRules: 7,
      currentSignal: 9,
    },
    dimensions: {
      promotion_task: {},
      traffic_opportunity: {},
      expression_identity: {},
      platform_mechanism: {},
      store_facts_assets: facts,
      conversion_action: {},
    },
  });
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
