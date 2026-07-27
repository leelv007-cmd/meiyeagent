import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { VisibleClaimExtraction } from './policy-gates.js';

import type { Acceptance } from '../model-supply/index.js';
import type { StructuredNodeRunner } from '../model-supply/structured-node-runner.js';
import type { ExecutionBrief } from './structured-nodes.js';
import { compileCopyGenerationRequest } from './output-compiler.js';
import { materializeSkillInstructions } from '../skills/stage-injection.js';
import type { ResolvedSkillInstruction } from '../skills/types.js';

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

export interface DecisionTraceFragment {
  stage: 'execution_selection';
  winnerCandidateId: string;
  candidateScores: Array<{
    candidateId: string;
    score: number;
    dimensions: {
      grounding: number;
      usefulness: number;
      platformFit: number;
    };
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

  constructor(
    readonly gateIds: string[],
    readonly merchantMessage?: string,
    readonly triggeredClaims: VisibleClaimExtraction['claims'] = [],
  ) {
    super('Every generated candidate was blocked by canonical policy.');
    this.name = 'HarnessSelectionError';
  }
}

export interface ImageExactTextAssessment {
  passed: boolean;
  expected: string[];
  observed: string[];
  reason: string;
}

export async function executeImageSelection<Result>(input: {
  candidateId(result: Result): string;
  generate(attempt: {
    attempt: 'primary' | 'retry';
    exactTextFailure?: ImageExactTextAssessment;
  }): Promise<Result>;
  verify(result: Result): Promise<ImageExactTextAssessment>;
  merchantFailure(assessment: ImageExactTextAssessment): string;
}) {
  const primary = await input.generate({ attempt: 'primary' });
  const primaryAssessment = await input.verify(primary);
  if (primaryAssessment.passed) {
    return { result: primary, executions: [primary], blockedCandidates: [] };
  }

  const retry = await input.generate({
    attempt: 'retry',
    exactTextFailure: primaryAssessment,
  });
  const retryAssessment = await input.verify(retry);
  if (!retryAssessment.passed) {
    throw new HarnessSelectionError(
      ['image_exact_text'],
      input.merchantFailure(retryAssessment),
    );
  }
  return {
    result: retry,
    executions: [primary, retry],
    blockedCandidates: [
      {
        candidateId: input.candidateId(primary),
        gateIds: ['image_exact_text'],
      },
    ],
  };
}

export async function executeCopySelection(
  input: {
    workflowId: string;
    unitId: string;
    brief: Extract<ExecutionBrief, { kind: 'copy' }>;
    workspaceId: string;
    intendedUse: GeneratedCandidate['intendedUse'];
    generationContext: Record<string, unknown>;
    skillInstructions?: readonly ResolvedSkillInstruction[];
    onToken?: (token: {
      candidateId: string;
      channel: 'copy.title' | 'copy.body' | 'copy.cta';
      delta: string;
    }) => Promise<void> | void;
  },
  ports: {
    runner: StructuredNodeRunner;
    validator: CandidatePolicyValidator;
  },
) {
  const primaryRequest = compileCopyGenerationRequest({
    brief: input.brief,
    context: input.generationContext,
  });
  const primaryEmitter = copyCandidateTokenEmitter(
    primaryRequest.candidateId,
    input.onToken,
  );
  const primary = await ports.runner.run({
    effectIdempotencyKey:
      `wf:${input.workflowId}:s4:${input.unitId}:${primaryRequest.candidateId}`,
    schemaName: 'harness_copy_candidate_v1',
    schemaRevision: 'copy-candidate-v1',
    instructions: materializeSkillInstructions(
      primaryRequest.instructions,
      input.skillInstructions,
    ),
    prompt: primaryRequest.prompt,
    schema: generatedCandidateSchema,
    ...(primaryEmitter ? { onPartialOutput: primaryEmitter } : {}),
  });
  let candidate: GeneratedCandidate = {
    ...primary.output,
    candidateId: primaryRequest.candidateId,
    workspaceId: input.workspaceId,
    intendedUse: input.intendedUse,
  };
  const blockedCandidates: Array<{
    candidateId: string;
    gateIds: string[];
    alternativePath: string[];
  }> = [];
  let policy = ports.validator.validate(structuredClone(candidate));
  if (!policy.passed) {
    blockedCandidates.push(blockedCandidate(candidate.candidateId, policy.failures));
    const retryRequest = compileCopyGenerationRequest({
      brief: input.brief,
      context: input.generationContext,
      policyFailures: policy.failures.map(({ gateId, reason }) => ({
        gateId,
        reason,
      })),
    });
    const retryEmitter = copyCandidateTokenEmitter(
      retryRequest.candidateId,
      input.onToken,
    );
    const retry = await ports.runner.run({
      effectIdempotencyKey:
        `wf:${input.workflowId}:s4:${input.unitId}:${retryRequest.candidateId}`,
      schemaName: 'harness_copy_candidate_v1',
      schemaRevision: 'copy-candidate-v1',
      instructions: materializeSkillInstructions(
        retryRequest.instructions,
        input.skillInstructions,
      ),
      prompt: retryRequest.prompt,
      schema: generatedCandidateSchema,
      ...(retryEmitter ? { onPartialOutput: retryEmitter } : {}),
    });
    candidate = {
      ...retry.output,
      candidateId: retryRequest.candidateId,
      workspaceId: input.workspaceId,
      intendedUse: input.intendedUse,
    };
    policy = ports.validator.validate(structuredClone(candidate));
  }
  if (!policy.passed) {
    blockedCandidates.push(blockedCandidate(candidate.candidateId, policy.failures));
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

function blockedCandidate(
  candidateId: string,
  failures: Array<{
    gateId: string;
    reason: string;
    alternativePath: string[];
  }>,
) {
  return {
    candidateId,
    gateIds: failures.map(({ gateId }) => gateId),
    alternativePath: unique(
      failures.flatMap(({ alternativePath }) => alternativePath),
    ),
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
