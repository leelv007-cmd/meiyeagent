import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  sensitiveCheckBarSchema,
  type BoundedExecutionSnapshot,
} from '@meiye/contracts';
import {
  createHarnessCandidateValidator,
  type HarnessGateFailure,
  type HarnessPolicyInput,
  type VisibleClaimExtraction,
} from './policy-gates.js';

import type { Acceptance } from '../model-supply/index.js';
import { ExecutionAttemptBudgetExceeded } from '../model-supply/execution-attempt-budget.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerResult,
} from '../model-supply/structured-node-runner.js';
import type { ExecutionBrief } from './structured-nodes.js';
import { compileCopyGenerationRequest } from './output-compiler.js';
import { materializeSkillInstructions } from '../skills/stage-injection.js';
import type { ResolvedSkillInstruction } from '../skills/types.js';
import { merchantSelectionWhyNow } from './merchant-delivery-language.js';
import type { HarnessFrozenPrompt } from './langfuse-prompts.js';
import {
  advanceBoundedExecution,
  evaluateBoundedExecution,
  type BoundedExecutionSuspension,
} from './bounded-execution-controller.js';
import {
  evaluatePurePredicate,
  type PurePredicate,
} from './pure-predicate.js';
import { containsConcreteOfferText } from './visible-claim-patterns.js';

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

const NON_SELF_CORRECTABLE_GATE_IDS = new Set([
  'subject_asset_rights',
  'external_action_approval',
]);

type GeneratedCandidateOutput = z.infer<typeof generatedCandidateSchema>;

const generatedCandidateCheckpointSchema = generatedCandidateSchema
  .extend({
    candidateId: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
    intendedUse: z.enum([
      'internal_draft',
      'public_content',
      'paid_promotion',
    ]),
  })
  .strict();

type GeneratedCandidate = z.infer<typeof generatedCandidateCheckpointSchema>;

const candidatePolicyFailureSchema = z
  .object({
    gateId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    alternativePath: z.array(z.string().trim().min(1)),
    sensitiveCheckBar: sensitiveCheckBarSchema.optional(),
  })
  .strict();

export const copySelectionCurrentBestSchema = z
  .object({
    candidate: generatedCandidateCheckpointSchema.nullable(),
    policyFailures: z.array(candidatePolicyFailureSchema),
    deliverable: z.literal(false),
  })
  .strict();

export interface CopySelectionInput {
  workflowId: string;
  unitId: string;
  brief: Extract<ExecutionBrief, { kind: 'copy' }>;
  workspaceId: string;
  intendedUse: GeneratedCandidate['intendedUse'];
  generationContext: Record<string, unknown>;
  prompt?: HarnessFrozenPrompt;
  skillInstructions?: readonly ResolvedSkillInstruction[];
  onToken?: (token: {
    candidateId: string;
    channel: 'copy.title' | 'copy.body' | 'copy.cta';
    delta: string;
  }) => Promise<void> | void;
}

interface CopySelectionPorts {
  runner: StructuredNodeRunner;
  validator: CandidatePolicyValidator;
  /** Monotonic active-execution clock; durable suspension time is excluded. */
  nowMs?: () => number;
}

export type CopySelectionCurrentBest = z.infer<
  typeof copySelectionCurrentBestSchema
>;

export function isCopySelectionCurrentBest(
  input: unknown,
): input is CopySelectionCurrentBest {
  return copySelectionCurrentBestSchema.safeParse(input).success;
}

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

export async function executePlatformCopySelection(
  input: CopySelectionInput & {
    policy: Omit<HarnessPolicyInput, 'candidate'>;
    allowConcreteOffer?: boolean;
    boundedExecution?: BoundedExecutionSnapshot;
    resumeFrom?: CopySelectionCurrentBest;
  },
  ports: { runner: StructuredNodeRunner },
) {
  const {
    policy,
    allowConcreteOffer = true,
    ...selection
  } = input;
  const canonicalValidator = createHarnessCandidateValidator(policy);
  const preflight = canonicalValidator.validate({
    assetRefs: [...selection.brief.assetRefs],
    candidateId: `${selection.unitId}:policy-preflight`,
    factClaims: selection.brief.factRefs.map((sourceRef) => ({
      kind: 'other' as const,
      sourceRef,
      value: sourceRef,
    })),
    intendedUse: selection.intendedUse,
    ...(selection.brief.identityRefs[0]
      ? { expressionIdentityRef: selection.brief.identityRefs[0] }
      : {}),
    workspaceId: selection.workspaceId,
  });
  if (!preflight.passed) {
    throw new HarnessSelectionError(
      unique(preflight.failures.map(({ gateId }) => gateId)),
      preflight.failures[0]?.reason,
      [],
      unique(
        preflight.failures.flatMap(({ alternativePath }) => alternativePath),
      ),
    );
  }
  return executeCopySelection(selection, {
    runner: ports.runner,
    validator: {
      validate(candidate) {
        const result = canonicalValidator.validate(candidate);
        if (!allowConcreteOffer && containsConcreteOfferCopy(candidate)) {
          result.failures.push({
            gateId: 'critical_fact_source',
            reason: '没有已核验价格或权益时，候选不得出现具体优惠数字。',
            alternativePath: ['改用无价格介绍', '先补充并确认当期优惠事实'],
          });
          result.passed = false;
        }
        return result;
      },
    },
  });
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
    readonly alternativePaths: string[] = [],
    readonly violations: HarnessGateFailure[] = [],
  ) {
    super('Every generated candidate was blocked by canonical policy.');
    this.name = 'HarnessSelectionError';
  }
}

export function isNonSelfCorrectableSelectionError(
  error: unknown,
): error is HarnessSelectionError {
  return (
    error instanceof HarnessSelectionError &&
    error.gateIds.some((gateId) => NON_SELF_CORRECTABLE_GATE_IDS.has(gateId))
  );
}

export interface ImageExactTextAssessment {
  passed: boolean;
  expected: string[];
  observed: string[];
  reason: string;
}

export interface ImageExactTextObservation {
  expected: string[];
  observed: string[];
  conflictingText: string[];
}

const imageExactTextMatches: PurePredicate<ImageExactTextObservation> = (
  observation,
) =>
  observation.expected.every((expected) =>
    observation.observed.includes(expected),
  ) && observation.conflictingText.length === 0;

export function assessImageExactText(
  observation: ImageExactTextObservation,
): ImageExactTextAssessment {
  const passed = evaluatePurePredicate(observation, imageExactTextMatches);
  return {
    passed,
    expected: [...observation.expected],
    observed: [...observation.observed],
    reason: passed
      ? 'Every exact text value matched.'
      : observation.conflictingText.length > 0
        ? 'The generated image contains conflicting exact text.'
        : 'The generated image did not preserve every exact text value.',
  };
}

export async function executeImageSelection<Result>(input: {
  candidateId(result: Result): string;
  generate(attempt: {
    attempt: 'primary' | 'retry';
    exactTextFailure?: ImageExactTextAssessment;
  }): Promise<Result>;
  observe(result: Result): Promise<ImageExactTextObservation>;
  merchantFailure(assessment: ImageExactTextAssessment): string;
}) {
  const primary = await input.generate({ attempt: 'primary' });
  const primaryAssessment = assessImageExactText(await input.observe(primary));
  if (primaryAssessment.passed) {
    return { result: primary, executions: [primary], blockedCandidates: [] };
  }

  const retry = await input.generate({
    attempt: 'retry',
    exactTextFailure: primaryAssessment,
  });
  const retryAssessment = assessImageExactText(await input.observe(retry));
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

export function executeCopySelection(
  input: CopySelectionInput & {
    boundedExecution: BoundedExecutionSnapshot;
    resumeFrom?: CopySelectionCurrentBest;
  },
  ports: CopySelectionPorts,
): Promise<
  CopySelectionSuccess | BoundedExecutionSuspension<CopySelectionCurrentBest>
>;
export function executeCopySelection(
  input: CopySelectionInput,
  ports: CopySelectionPorts,
): Promise<CopySelectionSuccess>;
export async function executeCopySelection(
  input: CopySelectionInput & {
    boundedExecution?: BoundedExecutionSnapshot;
    resumeFrom?: CopySelectionCurrentBest;
  },
  ports: CopySelectionPorts,
): Promise<
  CopySelectionSuccess | BoundedExecutionSuspension<CopySelectionCurrentBest>
> {
  let candidate: GeneratedCandidate;
  let policy: ReturnType<CandidatePolicyValidator['validate']>;
  let boundedExecution = input.boundedExecution;
  const nowMs = ports.nowMs ?? (() => performance.now());
  const activeStartedAt = boundedExecution ? nowMs() : 0;
  const activeWallClockBase =
    boundedExecution?.consumption.wallClockMs ?? 0;
  // Resolve the pin before any runner try/catch. Budget exhaustion is the only
  // catch branch that rewrites control flow today, but keeping the guard outside
  // prevents a missing pin from ever being mistaken for a model failure.
  const copyCandidatePrompt = requireCopyCandidatePromptContent(input.prompt);
  const observedConsumption = (
    snapshot: BoundedExecutionSnapshot,
    result: Pick<
      StructuredNodeRunnerResult<unknown>,
      'attempts' | 'observedCostCents' | 'replayed'
    >,
  ) => {
    if (
      snapshot.maxCostCents !== 'unset' &&
      result.observedCostCents === undefined
    ) {
      throw new Error(
        'Bounded execution requires observed provider cost in CNY cents.',
      );
    }
    const elapsed = Math.max(0, Math.ceil(nowMs() - activeStartedAt));
    return {
      iterations:
        snapshot.consumption.iterations +
        (result.replayed ? 0 : result.attempts),
      costCents:
        snapshot.consumption.costCents +
        (result.replayed ? 0 : (result.observedCostCents ?? 0)),
      wallClockMs: activeWallClockBase + elapsed,
      delegations: snapshot.consumption.delegations,
    };
  };
  if (input.resumeFrom?.candidate) {
    candidate = structuredClone(input.resumeFrom.candidate);
    policy = {
      passed: false,
      failures: structuredClone(input.resumeFrom.policyFailures),
    };
  } else {
    const primaryRequest = compileCopyGenerationRequest({
      brief: input.brief,
      context: input.generationContext,
    });
    const primaryEmitter = copyCandidateTokenEmitter(
      primaryRequest.candidateId,
      input.onToken,
    );
    let primary: StructuredNodeRunnerResult<GeneratedCandidateOutput>;
    try {
      primary = await ports.runner.run({
        effectIdempotencyKey:
          `wf:${input.workflowId}:s4:${input.unitId}:${primaryRequest.candidateId}`,
        schemaName: 'harness_copy_candidate_v1',
        schemaRevision: 'copy-candidate-v1',
        instructions: materializeSkillInstructions(
          [copyCandidatePrompt, primaryRequest.instructions].join('\n\n'),
          input.skillInstructions,
        ),
        prompt: primaryRequest.prompt,
        schema: generatedCandidateSchema,
        ...(primaryEmitter ? { onPartialOutput: primaryEmitter } : {}),
      });
    } catch (error) {
      if (boundedExecution && error instanceof ExecutionAttemptBudgetExceeded) {
        const elapsed = Math.max(
          0,
          Math.ceil(nowMs() - activeStartedAt),
        );
        const decision = evaluateBoundedExecution(boundedExecution, {
          consumption: {
            iterations: error.consumedAttempts,
            costCents:
              boundedExecution.consumption.costCents +
              providerCostToCnyCents(error.observedProviderCost),
            wallClockMs: activeWallClockBase + elapsed,
            delegations: boundedExecution.consumption.delegations,
          },
          currentBest: {
            candidate: null,
            policyFailures: [],
            deliverable: false as const,
          },
          unmetExplanation: '模型尚未产出可校验草稿；提高迭代上限后可继续。',
        });
        if (decision.state !== 'suspended') {
          throw new Error(
            'An exhausted execution attempt budget must suspend the selection.',
          );
        }
        return decision;
      }
      throw error;
    }
    candidate = {
      ...primary.output,
      candidateId: primaryRequest.candidateId,
      workspaceId: input.workspaceId,
      intendedUse: input.intendedUse,
    };
    policy = ports.validator.validate(structuredClone(candidate));
    if (boundedExecution) {
      boundedExecution = advanceBoundedExecution(
        boundedExecution,
        observedConsumption(boundedExecution, primary),
      );
    }
  }
  const blockedCandidates: Array<{
    candidateId: string;
    gateIds: string[];
    alternativePath: string[];
  }> = [];
  if (!policy.passed) {
    blockedCandidates.push(blockedCandidate(candidate.candidateId, policy.failures));
    const nonSelfCorrectableFailure = policy.failures.find(({ gateId }) =>
      NON_SELF_CORRECTABLE_GATE_IDS.has(gateId),
    );
    if (nonSelfCorrectableFailure) {
      throw new HarnessSelectionError(
        unique(blockedCandidates.flatMap(({ gateIds }) => gateIds)),
        nonSelfCorrectableFailure.reason,
        [],
        unique(policy.failures.flatMap(({ alternativePath }) => alternativePath)),
      );
    }
    if (boundedExecution) {
      const bounded = evaluateBoundedExecution(boundedExecution, {
        consumption: boundedExecution.consumption,
        currentBest: {
          candidate: structuredClone(candidate),
          policyFailures: structuredClone(policy.failures),
          deliverable: false as const,
        },
        unmetExplanation: policy.failures
          .map(({ reason }) => reason)
          .join('；'),
      });
      if (bounded.state === 'suspended') return bounded;
      boundedExecution = bounded.snapshot;
    }
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
    let retry: StructuredNodeRunnerResult<GeneratedCandidateOutput>;
    try {
      retry = await ports.runner.run({
        effectIdempotencyKey:
          `wf:${input.workflowId}:s4:${input.unitId}:${retryRequest.candidateId}`,
        schemaName: 'harness_copy_candidate_v1',
        schemaRevision: 'copy-candidate-v1',
        instructions: materializeSkillInstructions(
          [copyCandidatePrompt, retryRequest.instructions].join('\n\n'),
          input.skillInstructions,
        ),
        prompt: retryRequest.prompt,
        schema: generatedCandidateSchema,
        ...(retryEmitter ? { onPartialOutput: retryEmitter } : {}),
      });
    } catch (error) {
      if (boundedExecution && error instanceof ExecutionAttemptBudgetExceeded) {
        const elapsed = Math.max(
          0,
          Math.ceil(nowMs() - activeStartedAt),
        );
        const decision = evaluateBoundedExecution(boundedExecution, {
          consumption: {
            iterations: error.consumedAttempts,
            costCents:
              boundedExecution.consumption.costCents +
              providerCostToCnyCents(error.observedProviderCost),
            wallClockMs: activeWallClockBase + elapsed,
            delegations: boundedExecution.consumption.delegations,
          },
          currentBest: {
            candidate: structuredClone(candidate),
            policyFailures: structuredClone(policy.failures),
            deliverable: false as const,
          },
          unmetExplanation: policy.failures
            .map(({ reason }) => reason)
            .join('；'),
        });
        if (decision.state !== 'suspended') {
          throw new Error(
            'An exhausted execution attempt budget must suspend the selection.',
          );
        }
        return decision;
      }
      throw error;
    }
    candidate = {
      ...retry.output,
      candidateId: retryRequest.candidateId,
      workspaceId: input.workspaceId,
      intendedUse: input.intendedUse,
    };
    policy = ports.validator.validate(structuredClone(candidate));
    if (boundedExecution) {
      boundedExecution = advanceBoundedExecution(
        boundedExecution,
        observedConsumption(boundedExecution, retry),
      );
    }
  }
  if (!policy.passed) {
    blockedCandidates.push(blockedCandidate(candidate.candidateId, policy.failures));
    if (boundedExecution) {
      const bounded = evaluateBoundedExecution(boundedExecution, {
        consumption: boundedExecution.consumption,
        currentBest: {
          candidate: structuredClone(candidate),
          policyFailures: structuredClone(policy.failures),
          deliverable: false as const,
        },
        unmetExplanation: policy.failures
          .map(({ reason }) => reason)
          .join('；'),
      });
      if (bounded.state === 'suspended') return bounded;
    }
    throw new HarnessSelectionError(
      unique(blockedCandidates.flatMap(({ gateIds }) => gateIds)),
    );
  }
  const scores = [
    {
      candidateId: candidate.candidateId,
      score: 0,
      dimensions: { grounding: 0, usefulness: 0, platformFit: 0 },
      reason: merchantSelectionWhyNow(),
    },
  ];
  const rubricHash = sha256('copy-single-primary-v1');
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
    rubricVersion: 'copy-single-primary-v1',
    rubricHash,
  };
  return {
    candidates: [{ ...candidate, score: 0 }],
    winner: candidate,
    scores,
    blockedCandidates,
    trace,
    ...(boundedExecution ? { boundedExecution } : {}),
  };
}

type CopySelectionSuccess = {
  candidates: Array<GeneratedCandidate & { score: number }>;
  winner: GeneratedCandidate;
  scores: DecisionTraceFragment['candidateScores'];
  blockedCandidates: Array<{
    candidateId: string;
    gateIds: string[];
    alternativePath: string[];
  }>;
  trace: DecisionTraceFragment;
  boundedExecution?: BoundedExecutionSnapshot;
};

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

function providerCostToCnyCents(
  cost:
    | {
        amount: number;
        currency: 'CNY' | 'USD';
      }
    | undefined,
) {
  if (!cost) return 0;
  if (!Number.isFinite(cost.amount) || cost.amount < 0) {
    throw new Error('Observed provider cost must be a non-negative number.');
  }
  if (cost.currency !== 'CNY' && cost.amount !== 0) {
    throw new Error(
      'Bounded execution cost requires provider spend normalized to CNY.',
    );
  }
  const cents = Math.ceil(cost.amount * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new Error('Observed provider cost exceeds the bounded integer range.');
  }
  return cents;
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

function containsConcreteOfferCopy(candidate: GeneratedCandidate) {
  return [candidate.title, candidate.body, candidate.conversionHook].some(
    containsConcreteOfferText,
  );
}

function unique(values: string[]) {
  return [...new Set(values)];
}

/**
 * A missing pin fails closed. Substituting the hardcoded builtin was
 * indistinguishable from a correct pin at runtime, which breaks rollback and
 * eval attribution. copyCandidate lives in the copy prompt pack, so
 * task-admission freezes it for every copy lens / legacy path — an absent pin
 * means the freeze is wrong, not that a default is wanted.
 */
function requireCopyCandidatePromptContent(
  prompt: HarnessFrozenPrompt | undefined,
): string {
  const content = prompt?.content;
  if (!content?.trim()) {
    throw new Error(
      'Copy selection requires the frozen prompt pin copyCandidate; refusing to substitute a builtin prompt.',
    );
  }
  return content;
}
