import {
  STORE_FACT_KIND_LABELS,
  STORE_FACT_KINDS,
  questionCardSchema,
  type ContextBundle,
  type StoreFactKind,
} from '@meiye/contracts';
import { z } from 'zod';
import { P1DomainError } from '../foundation/domain.js';
import {
  StructuredNodeRunError,
  type StructuredNodeRunner,
} from '../model-supply/structured-node-runner.js';
import { isReferenceEligibleFactSnapshot } from './structured-nodes.js';
import {
  type HarnessFrozenPrompt,
} from './langfuse-prompts.js';

export const factSatisfactionOutputSchema = z
  .object({
    status: z.enum(['satisfied', 'partial', 'unsatisfied']),
    matchedFactRefs: z.array(z.string().trim().min(1)),
    missingFactTypes: z.array(z.enum(STORE_FACT_KINDS)),
  })
  .strict()
  .superRefine((assessment, context) => {
    if (
      (assessment.status === 'satisfied' &&
        assessment.missingFactTypes.length !== 0) ||
      (assessment.status !== 'satisfied' &&
        assessment.missingFactTypes.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'status and missingFactTypes must agree.',
        path: ['missingFactTypes'],
      });
    }
  });

export const factCriticalityOutputSchema = z
  .object({
    criticality: z.enum(['critical', 'optional']),
  })
  .strict();

type FrozenFact = NonNullable<
  ContextBundle['dimensions']['store_facts_assets'][string]
>['factSnapshot'];

export interface FactRightsAuthorizationPort {
  isAuthorized(input: {
    workspaceId: string;
    rightsRevision: ContextBundle['sourceRevisions']['rights'];
    fact: NonNullable<FrozenFact>;
  }): Promise<boolean>;
}

export interface FactSatisfactionDiagnosticEvent {
  event: 'harness_fact_node_failure';
  stage: 'runner' | 'schema_parse';
  workflowId: string;
  workspaceId: string;
  effectIdempotencyKey: string;
  schemaName: string;
  error: {
    name: string;
    code?: string;
    message: string;
    stack?: string;
  };
}

export type FactSatisfactionDiagnosticLogger = (
  event: FactSatisfactionDiagnosticEvent,
) => void;

export const conservativeFactRightsAuthorization: FactRightsAuthorizationPort = {
  async isAuthorized() {
    return false;
  },
};

const defaultFactSatisfactionDiagnosticLogger: FactSatisfactionDiagnosticLogger =
  (event) => {
    console.warn('Harness fact node failed.', event);
  };

export async function assessRecipeFactSatisfaction(
  input: {
    workflowId: string;
    workflowRevision: number;
    intent: string;
    factTypes: readonly StoreFactKind[];
    bundle: ContextBundle;
    at: string;
    prompts?: {
      factSatisfaction?: Pick<HarnessFrozenPrompt, 'content'>;
      factCriticality?: Pick<HarnessFrozenPrompt, 'content'>;
    };
  },
  runner: StructuredNodeRunner,
  rights: FactRightsAuthorizationPort = conservativeFactRightsAuthorization,
  diagnostics: FactSatisfactionDiagnosticLogger = defaultFactSatisfactionDiagnosticLogger,
) {
  const facts = await eligibleFacts(input.bundle, input.at, rights);
  if (input.factTypes.length === 0) {
    return {
      status: 'satisfied' as const,
      action: 'execute' as const,
      factRefs: [],
    };
  }

  // Resolve the pin before the runner try/catch. Inside it, a throw would be
  // caught as a model failure and degrade into conservativeGuidance — which is
  // fail *open*: the run would continue on no pin at all.
  const satisfactionInstructions = requireFactPromptContent(
    'factSatisfaction',
    input.prompts?.factSatisfaction,
  );
  let assessmentResult;
  try {
    assessmentResult = await runner.run({
      effectIdempotencyKey: `wf:${input.workflowId}:s2:facts:0`,
      schemaName: 'harness_fact_satisfaction_v1',
      schemaRevision: 'fact-satisfaction-v1',
      instructions: satisfactionInstructions,
      prompt: canonicalJson({
        intent: input.intent,
        factTypes: input.factTypes,
        facts,
      }),
      schema: factSatisfactionOutputSchema,
    });
  } catch (error) {
    emitFactDiagnostic(
      diagnostics,
      factDiagnosticEvent(
        input,
        error instanceof z.ZodError ? 'schema_parse' : 'runner',
        error,
        'harness_fact_satisfaction_v1',
        `wf:${input.workflowId}:s2:facts:0`,
      ),
    );
    return conservativeGuidance(input.factTypes);
  }
  let assessment: z.infer<typeof factSatisfactionOutputSchema>;
  try {
    assessment = factSatisfactionOutputSchema.parse(assessmentResult.output);
  } catch (error) {
    emitFactDiagnostic(
      diagnostics,
      factDiagnosticEvent(
        input,
        'schema_parse',
        error,
        'harness_fact_satisfaction_v1',
        `wf:${input.workflowId}:s2:facts:0`,
      ),
    );
    return conservativeGuidance(input.factTypes);
  }

  const factRefs = new Set(facts.map((fact) => fact.sourceRef));
  if (assessment.matchedFactRefs.some((reference) => !factRefs.has(reference))) {
    return conservativeGuidance(input.factTypes);
  }
  const matchedKinds = new Set(
    facts
      .filter((fact) => assessment.matchedFactRefs.includes(fact.sourceRef))
      .map((fact) => fact.kind),
  );
  const requiredKinds = new Set(input.factTypes);
  const missingKinds = new Set(assessment.missingFactTypes);
  if (
    // factTypes is the recipe's requirement floor, not an authorization
    // ceiling: the store ledger legitimately holds more kinds than one
    // recipe declares, so matched kinds outside factTypes stay authorized.
    [...matchedKinds].some((kind) => missingKinds.has(kind)) ||
    assessment.missingFactTypes.some((kind) => !requiredKinds.has(kind)) ||
    input.factTypes.some(
      (kind) => !matchedKinds.has(kind) && !missingKinds.has(kind),
    ) ||
    (assessment.status === 'satisfied' &&
      input.factTypes.some((kind) => !matchedKinds.has(kind)))
  ) {
    return conservativeGuidance(input.factTypes);
  }
  if (assessment.status === 'satisfied') {
    return {
      status: 'satisfied' as const,
      action: 'execute' as const,
      factRefs: assessment.matchedFactRefs,
    };
  }
  if (assessment.status === 'unsatisfied') {
    return conservativeGuidance(assessment.missingFactTypes);
  }

  const missingFactLabels = assessment.missingFactTypes
    .map((kind) => STORE_FACT_KIND_LABELS[kind])
    .join('、');

  const criticalityEffectIdempotencyKey = `wf:${input.workflowId}:s2:facts:criticality:0`;
  const criticalitySchemaName = 'harness_fact_criticality_v1';
  // Same reason as above: resolve the pin outside the try so a missing pin
  // cannot be mistaken for a model failure and degraded into guidance.
  const criticalityInstructions = requireFactPromptContent(
    'factCriticality',
    input.prompts?.factCriticality,
  );
  let result;
  try {
    result = await runner.run({
      effectIdempotencyKey: criticalityEffectIdempotencyKey,
      schemaName: criticalitySchemaName,
      schemaRevision: 'fact-criticality-v1',
      instructions: criticalityInstructions,
      prompt: canonicalJson({
        intent: input.intent,
        missingFactTypes: assessment.missingFactTypes,
      }),
      schema: factCriticalityOutputSchema,
    });
  } catch (error) {
    emitFactDiagnostic(
      diagnostics,
      factDiagnosticEvent(
        input,
        error instanceof z.ZodError ? 'schema_parse' : 'runner',
        error,
        criticalitySchemaName,
        criticalityEffectIdempotencyKey,
      ),
    );
    return conservativeGuidance(assessment.missingFactTypes);
  }
  let criticality: z.infer<typeof factCriticalityOutputSchema>;
  try {
    criticality = factCriticalityOutputSchema.parse(result.output);
  } catch (error) {
    emitFactDiagnostic(
      diagnostics,
      factDiagnosticEvent(
        input,
        'schema_parse',
        error,
        criticalitySchemaName,
        criticalityEffectIdempotencyKey,
      ),
    );
    return conservativeGuidance(assessment.missingFactTypes);
  }
  if (criticality.criticality === 'critical') {
    let question: z.infer<typeof questionCardSchema>;
    try {
      question = questionCardSchema.parse({
          questionId: `${input.workflowId}:s2:missing-facts`,
          workflowId: input.workflowId,
          workflowRevision: input.workflowRevision,
          question: `请确认本次创作要用的${missingFactLabels}。`,
          options: [],
          freeText: { enabled: true },
          response: {
            field: 'store_facts',
            reason: '补充当前任务所需的权威事实',
          },
          unattended: 'hold',
          scope: 'current_task',
        });
    } catch (error) {
      emitFactDiagnostic(
        diagnostics,
        factDiagnosticEvent(
          input,
          'runner',
          error,
          criticalitySchemaName,
          criticalityEffectIdempotencyKey,
        ),
      );
      return conservativeGuidance(assessment.missingFactTypes);
    }
    return {
      status: 'partial' as const,
      action: 'ask_user' as const,
      factRefs: assessment.matchedFactRefs,
      missingFactTypes: assessment.missingFactTypes,
      question,
      ledgerIntake: {
        factTypes: assessment.missingFactTypes,
        writePath: 'asset_intake.confirm_fact' as const,
      },
    };
  }
  return {
    status: 'partial' as const,
    action: 'execute_with_notice' as const,
    factRefs: assessment.matchedFactRefs,
    missingFactTypes: assessment.missingFactTypes,
    resultNotice: `本次结果没有使用尚未确认的${missingFactLabels}。`,
  };
}

export type RecipeFactSatisfaction = Awaited<
  ReturnType<typeof assessRecipeFactSatisfaction>
>;

function emitFactDiagnostic(
  diagnostics: FactSatisfactionDiagnosticLogger,
  event: FactSatisfactionDiagnosticEvent,
) {
  try {
    diagnostics(event);
  } catch {
    // Diagnostics must never replace the conservative failure result.
  }
}

function factDiagnosticEvent(
  input: {
    workflowId: string;
    bundle: Pick<ContextBundle, 'workspaceId'>;
  },
  stage: FactSatisfactionDiagnosticEvent['stage'],
  error: unknown,
  schemaName: string,
  effectIdempotencyKey: string,
): FactSatisfactionDiagnosticEvent {
  const safeError = safeDiagnosticError(error, stage, schemaName);
  return {
    event: 'harness_fact_node_failure',
    stage,
    workflowId: input.workflowId,
    workspaceId: input.bundle.workspaceId,
    effectIdempotencyKey,
    schemaName,
    error: {
      ...safeError,
      stack: safeDiagnosticStack(safeError.name, safeError.message),
    },
  };
}

function safeDiagnosticError(
  error: unknown,
  stage: FactSatisfactionDiagnosticEvent['stage'],
  schemaName: string,
): FactSatisfactionDiagnosticEvent['error'] {
  if (stage === 'schema_parse') {
    return {
      name: 'ZodError',
      code: 'SCHEMA_PARSE_FAILED',
      message: `${schemaName} output failed schema validation.`,
    };
  }
  if (error instanceof P1DomainError) {
    return {
      name: 'P1DomainError',
      code: error.code,
      message:
        error.code === 'NOT_FOUND'
          ? 'Workspace resource was not found.'
          : 'Structured fact runner failed.',
    };
  }
  if (error instanceof StructuredNodeRunError) {
    return {
      name: 'StructuredNodeRunError',
      code:
        error.status === 'unknown'
          ? 'STRUCTURED_NODE_OUTCOME_UNKNOWN'
          : 'STRUCTURED_NODE_EXECUTION_FAILED',
      message:
        error.status === 'unknown'
          ? 'Structured node outcome is unknown.'
          : 'Structured node execution failed.',
    };
  }
  return {
    name: 'Error',
    code: 'STRUCTURED_NODE_RUNNER_FAILED',
    message: 'Structured fact runner failed.',
  };
}

function safeDiagnosticStack(name: string, message: string) {
  const frames = (new Error().stack ?? '')
    .split('\n')
    .flatMap((line) => {
      const match = line.match(
        /(apps\/core\/src\/[A-Za-z0-9_./-]+\.(?:c|m)?(?:j|t)sx?:\d+:\d+)/u,
      );
      return match?.[1] ? [`    at ${match[1]}`] : [];
    })
    .slice(0, 12);
  return [`${name}: ${message}`, ...frames].join('\n');
}

async function eligibleFacts(
  bundle: ContextBundle,
  at: string,
  rights: FactRightsAuthorizationPort,
) {
  const candidates = Object.values(bundle.dimensions.store_facts_assets)
    .filter(
      (
        item,
      ): item is typeof item & { factSnapshot: NonNullable<FrozenFact> } =>
        isReferenceEligibleFactSnapshot(item),
    )
    .filter(
      ({ factSnapshot }) =>
        factSnapshot.revisionKind !== 'revocation' &&
        Date.parse(factSnapshot.effectiveFrom) <= Date.parse(at) &&
        (factSnapshot.expiresAt === null ||
          Date.parse(factSnapshot.expiresAt) > Date.parse(at)),
    );
  const authorized = await Promise.all(
    candidates.map(async (item) => ({
      item,
      authorized: await rights.isAuthorized({
        workspaceId: bundle.workspaceId,
        rightsRevision: bundle.sourceRevisions.rights,
        fact: item.factSnapshot,
      }),
    })),
  );
  return authorized
    .filter((candidate) => candidate.authorized)
    .map(({ item }) => ({
      sourceRef: item.sourceRef,
      kind: item.factSnapshot.kind,
      value: item.value,
      source: item.factSnapshot.source,
      effectiveFrom: item.factSnapshot.effectiveFrom,
      expiresAt: item.factSnapshot.expiresAt,
    }));
}

function conservativeGuidance(missingFactTypes: readonly StoreFactKind[]) {
  return {
    status: 'unsatisfied' as const,
    action: 'conservative_guidance' as const,
    factRefs: [],
    missingFactTypes: [...missingFactTypes],
    guidance: '缺少可授权、可核对的当前事实，请先补充或确认资料。',
  };
}

function canonicalJson(value: unknown) {
  return JSON.stringify(sortCanonical(value));
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortCanonical(nested)]),
    );
  }
  return value;
}

/**
 * A missing pin fails closed. Substituting the hardcoded builtin was
 * indistinguishable from a correct pin at runtime, which breaks rollback (the
 * release names one version while the run used another) and eval attribution.
 * Both keys live in the agentControl prompt pack, so task-admission freezes them
 * for every lens and for the legacy full set — an absent pin here means the
 * freeze is wrong, not that a default is wanted.
 */
function requireFactPromptContent(
  promptKey: 'factSatisfaction' | 'factCriticality',
  prompt: Pick<HarnessFrozenPrompt, 'content'> | undefined,
): string {
  const content = prompt?.content;
  if (!content?.trim()) {
    throw new Error(
      `Fact satisfaction requires the frozen prompt pin ${promptKey}; refusing to substitute a builtin prompt.`,
    );
  }
  return content;
}
