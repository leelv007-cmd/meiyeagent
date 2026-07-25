import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { Acceptance } from '../model-supply/index.js';
import type { StructuredNodeRunner } from '../model-supply/structured-node-runner.js';
import type { ExecutionBrief } from './structured-nodes.js';
import { compileCopyGenerationRequest } from './output-compiler.js';

const generatedCandidateSchema = z
  .object({
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    conversionHook: z.string().trim().min(1),
    factClaims: z.array(
      z
        .object({
          kind: z.enum(['price', 'benefit', 'qualification', 'offer', 'other']),
          value: z.string().trim().min(1),
          sourceRef: z.string().trim().min(1).optional(),
        })
        .strict(),
    ),
    assetRefs: z.array(z.string().trim().min(1)),
    expressionIdentityRef: z.string().trim().min(1).optional(),
  })
  .strict();

const scoreOutputSchema = z
  .object({
    score: z.number().min(0).max(100),
    dimensions: z
      .object({
        grounding: z.number().min(0).max(1),
        usefulness: z.number().min(0).max(1),
        platformFit: z.number().min(0).max(1),
      })
      .strict(),
    reason: z.string().trim().min(1),
  })
  .strict();

export const COPY_SCORING_RUBRIC = {
  version: 'copy-quality-v1',
  dimensions: {
    grounding: 'All critical claims cite supplied current sources.',
    usefulness: 'The copy gives the merchant a complete usable message and CTA.',
    platformFit: 'The structure and expression fit the requested platform.',
  },
} as const;

const COPY_SINGLE_PRIMARY_RUBRIC = {
  version: 'copy-single-primary-v1',
  rule: 'One policy-valid primary result is delivered without comparative scoring.',
} as const;

type GeneratedCandidate = z.infer<typeof generatedCandidateSchema> & {
  candidateId: string;
  workspaceId: string;
  intendedUse: 'internal_draft' | 'public_content' | 'paid_promotion';
};

export interface CandidatePolicyValidator {
  validate(candidate: GeneratedCandidate): {
    passed: boolean;
    failures: Array<{
      gateId: string;
      reason: string;
      alternativePath: string[];
    }>;
  };
}

export interface CandidateScorer {
  score(input: {
    effectIdempotencyKey: string;
    candidate: GeneratedCandidate;
    brief: ExecutionBrief;
    rubric: typeof COPY_SCORING_RUBRIC;
  }): Promise<z.infer<typeof scoreOutputSchema>>;
}

export interface DecisionTraceFragment {
  stage: 'execution_selection';
  winnerCandidateId: string;
  candidateScores: Array<{
    candidateId: string;
    score: number;
    dimensions: z.infer<typeof scoreOutputSchema>['dimensions'];
    reason: string;
  }>;
  blockedCandidates: Array<{
    candidateId: string;
    gateIds: string[];
  }>;
  rubricVersion: string;
  rubricHash: string;
}

export class HarnessSelectionError extends Error {
  readonly code = 'HARNESS_ALL_CANDIDATES_BLOCKED';
  readonly status = 409;

  constructor(readonly gateIds: string[]) {
    super('Every generated candidate was blocked by canonical policy.');
    this.name = 'HarnessSelectionError';
  }
}

export async function executeCopySelection(
  input: {
    workflowId: string;
    unitId: string;
    brief: Extract<ExecutionBrief, { kind: 'copy' }>;
    workspaceId: string;
    intendedUse: GeneratedCandidate['intendedUse'];
    generationContext: Record<string, unknown>;
    onToken?: (token: {
      candidateId: string;
      channel: 'copy.title' | 'copy.body' | 'copy.cta';
      delta: string;
    }) => Promise<void> | void;
  },
  ports: {
    runner: StructuredNodeRunner;
    scorer: CandidateScorer;
    validator: CandidatePolicyValidator;
  },
) {
  const compiled = compileCopyGenerationRequest({
    brief: input.brief,
    context: input.generationContext,
  });
  const emitPartial = copyCandidateTokenEmitter(
    compiled.candidateId,
    input.onToken,
  );
  const generated = await ports.runner.run({
    effectIdempotencyKey:
      `wf:${input.workflowId}:s4:${input.unitId}:${compiled.candidateId}`,
    schemaName: 'harness_copy_candidate_v1',
    schemaRevision: 'copy-candidate-v1',
    instructions: compiled.instructions,
    prompt: compiled.prompt,
    schema: generatedCandidateSchema,
    ...(emitPartial ? { onPartialOutput: emitPartial } : {}),
  });
  const candidate: GeneratedCandidate = {
    ...generated.output,
    candidateId: compiled.candidateId,
    workspaceId: input.workspaceId,
    intendedUse: input.intendedUse,
  };
  const blockedCandidates: Array<{
    candidateId: string;
    gateIds: string[];
    alternativePath: string[];
  }> = [];
  const policy = ports.validator.validate(structuredClone(candidate));
  if (!policy.passed) {
    blockedCandidates.push({
      candidateId: candidate.candidateId,
      gateIds: policy.failures.map(({ gateId }) => gateId),
      alternativePath: unique(
        policy.failures.flatMap(({ alternativePath }) => alternativePath),
      ),
    });
    throw new HarnessSelectionError(
      unique(blockedCandidates.flatMap(({ gateIds }) => gateIds)),
    );
  }
  const scores = [
    {
      candidateId: candidate.candidateId,
      score: 0,
      dimensions: { grounding: 0, usefulness: 0, platformFit: 0 },
      reason: 'Single primary result; comparative scoring was not run.',
    },
  ];
  const rubricHash = sha256(JSON.stringify(COPY_SINGLE_PRIMARY_RUBRIC));
  const trace: DecisionTraceFragment = {
    stage: 'execution_selection',
    winnerCandidateId: candidate.candidateId,
    candidateScores: scores.map(({ candidateId, score, dimensions, reason }) => ({
      candidateId,
      score,
      dimensions,
      reason,
    })),
    blockedCandidates: blockedCandidates.map(({ candidateId, gateIds }) => ({
      candidateId,
      gateIds,
    })),
    rubricVersion: COPY_SINGLE_PRIMARY_RUBRIC.version,
    rubricHash,
  };
  return {
    candidates: [{ ...candidate, score: 0 }],
    winner: candidate,
    scores,
    blockedCandidates,
    trace,
  };
}

function copyCandidateTokenEmitter(
  candidateId: string,
  emit:
    | ((token: {
        candidateId: string;
        channel: 'copy.title' | 'copy.body' | 'copy.cta';
        delta: string;
      }) => Promise<void> | void)
    | undefined,
) {
  if (!emit) return undefined;
  const previous = { body: '', conversionHook: '', title: '' };
  const channels = {
    body: 'copy.body',
    conversionHook: 'copy.cta',
    title: 'copy.title',
  } as const;
  return async (partial: unknown) => {
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
      return;
    }
    const candidate = partial as Record<string, unknown>;
    for (const field of ['title', 'body', 'conversionHook'] as const) {
      const value = candidate[field];
      if (
        typeof value !== 'string' ||
        value.length <= previous[field].length ||
        !value.startsWith(previous[field])
      ) {
        continue;
      }
      const delta = value.slice(previous[field].length);
      previous[field] = value;
      await emit({ candidateId, channel: channels[field], delta });
    }
  };
}

export class StructuredCandidateScorer implements CandidateScorer {
  constructor(private readonly runner: StructuredNodeRunner) {}

  async score(input: Parameters<CandidateScorer['score']>[0]) {
    const result = await this.runner.run({
      effectIdempotencyKey: input.effectIdempotencyKey,
      schemaName: 'harness_copy_score_v1',
      schemaRevision: input.rubric.version,
      instructions:
        'Score the candidate strictly against the supplied rubric. Return one 0-100 total, normalized dimension scores, and a concise evidence-based reason.',
      prompt: JSON.stringify(input),
      schema: scoreOutputSchema,
    });
    return result.output;
  }
}

export function candidateBillingDisposition(input: {
  acceptance: Acceptance;
  cancellation: 'not_requested' | 'unconfirmed' | 'confirmed';
}) {
  if (input.acceptance === 'rejected_before_accept') return 'refund' as const;
  if (
    input.acceptance === 'acceptance_unknown' ||
    input.cancellation === 'unconfirmed'
  ) {
    return 'reconcile' as const;
  }
  return 'settle_terminal' as const;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function unique(values: string[]) {
  return [...new Set(values)];
}
