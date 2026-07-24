import {
  STORE_FACT_KIND_LABELS,
  STORE_FACT_KINDS,
  questionCardSchema,
  type ContextBundle,
  type StoreFactKind,
} from '@meiye/contracts';
import { z } from 'zod';
import type { StructuredNodeRunner } from '../model-supply/structured-node-runner.js';

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

export const conservativeFactRightsAuthorization: FactRightsAuthorizationPort = {
  async isAuthorized() {
    return false;
  },
};

export async function assessRecipeFactSatisfaction(
  input: {
    workflowId: string;
    workflowRevision: number;
    intent: string;
    factTypes: readonly StoreFactKind[];
    bundle: ContextBundle;
    at: string;
  },
  runner: StructuredNodeRunner,
  rights: FactRightsAuthorizationPort = conservativeFactRightsAuthorization,
) {
  const facts = await eligibleFacts(input.bundle, input.at, rights);
  if (input.factTypes.length === 0) {
    return {
      status: 'satisfied' as const,
      action: 'execute' as const,
      factRefs: [],
    };
  }

  let assessment: z.infer<typeof factSatisfactionOutputSchema>;
  try {
    const result = await runner.run({
      effectIdempotencyKey: `wf:${input.workflowId}:s2:facts:0`,
      schemaName: 'harness_fact_satisfaction_v1',
      schemaRevision: 'fact-satisfaction-v1',
      instructions:
        'Judge only whether the supplied authorized current facts satisfy the requested fact types. Never infer expiry, revocation, or rights.',
      prompt: canonicalJson({
        intent: input.intent,
        factTypes: input.factTypes,
        facts,
      }),
      schema: factSatisfactionOutputSchema,
    });
    assessment = factSatisfactionOutputSchema.parse(result.output);
  } catch {
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
  if (
    assessment.missingFactTypes.some((kind) => !requiredKinds.has(kind)) ||
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

  try {
    const result = await runner.run({
      effectIdempotencyKey: `wf:${input.workflowId}:s2:facts:criticality:0`,
      schemaName: 'harness_fact_criticality_v1',
      schemaRevision: 'fact-criticality-v1',
      instructions:
        'Classify whether the missing facts block truthful execution for this intent. Return critical or optional only.',
      prompt: canonicalJson({
        intent: input.intent,
        missingFactTypes: assessment.missingFactTypes,
      }),
      schema: factCriticalityOutputSchema,
    });
    const criticality = factCriticalityOutputSchema.parse(result.output);
    if (criticality.criticality === 'critical') {
      return {
        status: 'partial' as const,
        action: 'ask_user' as const,
        factRefs: assessment.matchedFactRefs,
        missingFactTypes: assessment.missingFactTypes,
        question: questionCardSchema.parse({
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
          scope: 'current_task',
        }),
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
  } catch {
    return conservativeGuidance(assessment.missingFactTypes);
  }
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
        item.factSnapshot !== undefined,
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
