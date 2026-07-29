import {
  askMerchantQuestionRequestSchema,
  askMerchantAnswerSchema,
  harnessInteractionAnswerSchema,
  harnessInteractionRequestSchema,
  type AskMerchantQuestionRequest,
  type HarnessStage,
  type HarnessInteractionAnswer,
  type HarnessInteractionRequest,
  type QuestionCard,
} from '@meiye/contracts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { resolveAskMerchantAnswer } from './ask-merchant-resolution.js';

const interactionRendererCapabilitySchema = z.enum([
  'available',
  'unavailable',
  'unknown',
]);

export const harnessInteractionPendingProjectionSchema = z
  .object({
    kind: z.literal('harness_interaction'),
    version: z.literal(1),
    request: harnessInteractionRequestSchema,
    rendererCapability: interactionRendererCapabilitySchema,
    waitingState: z.enum(['answer', 'merchant_message']),
    timer: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('hold') }).strict(),
      z
        .object({
          kind: z.literal('armed'),
          timeoutSeconds: z.number().int().min(1).max(3_600),
          deadlineAt: z.iso.datetime(),
          editingStartedAt: z.iso.datetime().nullable(),
        })
        .strict(),
    ]),
  })
  .strict();

export type HarnessInteractionPendingProjection = z.infer<
  typeof harnessInteractionPendingProjectionSchema
>;

export function askMerchantInteractionRequestFromQuestion(input: {
  question: QuestionCard;
  stage: HarnessStage;
  timeoutPolicy?: AskMerchantQuestionRequest['timeoutPolicy'];
}) {
  const { question } = input;
  return askMerchantQuestionRequestSchema.parse({
    requestId: question.questionId,
    runId: question.workflowId,
    step: input.stage,
    revision: question.workflowRevision,
    kind: 'ask_merchant',
    questions: [
      {
        itemId: question.response.field,
        question: question.question,
        ...(question.options.length > 0
          ? {
              options: question.options.map(({ description, label }) => ({
                ...(description ? { description } : {}),
                label,
              })),
            }
          : {}),
        fallback: { kind: 'deferred' },
      },
    ],
    groupSkip: true,
    ...(input.timeoutPolicy ? { timeoutPolicy: input.timeoutPolicy } : {}),
    presentation: {
      carriers: ['conversation', 'store_page'],
      blocking: 'none',
      notification: 'none',
      renderer: 'ask_merchant_group',
    },
  });
}

export function createHarnessInteractionPendingProjection(
  request: HarnessInteractionRequest,
  rendererCapability: HarnessInteractionPendingProjection['rendererCapability'],
  registeredAt: Date,
): HarnessInteractionPendingProjection {
  const policy =
    request.kind === 'ask_merchant'
      ? request.timeoutPolicy
      : request.frozen.timeoutPolicy;
  return harnessInteractionPendingProjectionSchema.parse({
    kind: 'harness_interaction',
    version: 1,
    request,
    rendererCapability,
    waitingState: 'answer',
    timer:
      policy?.kind === 'semantic_default'
        ? {
            kind: 'armed',
            timeoutSeconds: policy.timeoutSeconds,
            deadlineAt: new Date(
              registeredAt.getTime() + policy.timeoutSeconds * 1_000,
            ).toISOString(),
            editingStartedAt: null,
          }
        : { kind: 'hold' },
  });
}

export interface HarnessInteractionStore {
  advanceInteraction(
    workspaceId: string,
    request: HarnessInteractionRequest,
  ): Promise<{
    outcome: 'advanced' | 'replayed' | 'conflict';
  }>;
  readPendingInteraction(
    workspaceId: string,
    runId: string,
    options?: { includeResolved?: boolean },
  ): Promise<HarnessInteractionRequest | null>;
  resolveInteraction(input: {
    workspaceId: string;
    answer: HarnessInteractionAnswer;
    payloadFingerprint: string;
    resolutionSource: 'decision' | 'system_default';
    resumeDisposition: 'resume' | 'wait';
    resumeData: HarnessInteractionAnswer['response'];
    resolvedAt: string;
    trigger: 'merchant' | 'system_default';
  }): Promise<{
    outcome:
      | 'created'
      | 'replayed'
      | 'editing'
      | 'stale_request'
      | 'stale_revision'
      | 'idempotency_conflict'
      | 'ineligible'
      | 'not_due'
      | 'renderer_unavailable'
      | 'unknown_state';
    resumeRequired: boolean;
  }>;
  claimInteractionResume(
    workspaceId: string,
    runId: string,
    idempotencyKey: string,
    claimId: string,
  ): Promise<boolean>;
  releaseInteractionResume(
    workspaceId: string,
    runId: string,
    idempotencyKey: string,
    claimId: string,
  ): Promise<void>;
  markInteractionResumed(
    workspaceId: string,
    runId: string,
    idempotencyKey: string,
    claimId: string,
  ): Promise<boolean>;
  transitionInteractionEditing(
    workspaceId: string,
    runId: string,
    editing: boolean,
    at: string,
  ): Promise<'updated' | 'replayed' | 'stale' | 'unknown_state'>;
  setInteractionRendererCapability(
    workspaceId: string,
    runId: string,
    capability: HarnessInteractionPendingProjection['rendererCapability'],
  ): Promise<boolean>;
}

export interface HarnessInteractionResumer {
  resume(input: {
    workspaceId: string;
    runId: string;
    step: string;
    idempotencyKey: string;
    interactionKind: HarnessInteractionRequest['kind'];
    requestId: string;
    revision: number;
    resumeData: HarnessInteractionAnswer['response'];
    resolutionSource: 'decision' | 'system_default';
  }): Promise<void>;
}

export class HarnessInteractionError extends Error {
  readonly status = 409;

  constructor(
    readonly code:
      | 'INTERACTION_IDEMPOTENCY_CONFLICT'
      | 'INTERACTION_KIND_MISMATCH'
      | 'INTERACTION_RESUME_UNAVAILABLE'
      | 'STALE_INTERACTION_REQUEST'
      | 'STALE_INTERACTION_REVISION',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'HarnessInteractionError';
  }
}

export class HarnessInteractionService {
  constructor(
    private readonly store: HarnessInteractionStore,
    private readonly resumer: HarnessInteractionResumer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readForCarrier(
    workspaceId: string,
    runId: string,
    carrier: 'conversation' | 'store_page' | 'task_card',
  ) {
    const request = await this.store.readPendingInteraction(
      workspaceId,
      runId,
    );
    if (
      !request ||
      !(request.presentation.carriers as readonly string[]).includes(carrier)
    ) {
      return null;
    }
    if (
      !(await this.store.setInteractionRendererCapability(
        workspaceId,
        runId,
        'available',
      ))
    ) {
      return null;
    }
    return request;
  }

  async submit(
    workspaceId: string,
    input: unknown,
  ): Promise<
    | { kind: 'reask'; request: HarnessInteractionRequest }
    | { kind: 'resumed'; replayed: boolean }
    | { kind: 'waiting'; replayed: boolean }
    | {
        kind: 'held';
        reason: 'deadline' | 'editing' | 'renderer' | 'policy';
      }
  > {
    const answer = harnessInteractionAnswerSchema.parse(input);
    return this.submitParsed(workspaceId, answer, 'decision');
  }

  async submitSystemDefault(workspaceId: string, runId: string) {
    const request = await this.store.readPendingInteraction(
      workspaceId,
      runId,
    );
    if (!request) {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REQUEST',
        'The interaction request is no longer pending.',
      );
    }
    const policy =
      request.kind === 'ask_merchant'
        ? request.timeoutPolicy
        : request.frozen.timeoutPolicy;
    if (policy?.kind !== 'semantic_default') {
      return { kind: 'held' as const, reason: 'policy' as const };
    }
    if (request.kind === 'execution_confirmation') {
      return { kind: 'held' as const, reason: 'policy' as const };
    }
    return this.submitParsed(
      workspaceId,
      askMerchantAnswerSchema.parse({
        requestId: request.requestId,
        revision: request.revision,
        idempotencyKey: `${request.requestId}:r${request.revision}:system_default`,
        resume: { runId: request.runId, step: request.step },
        response: policy.eligibility.defaultResponse,
      }),
      'system_default',
    );
  }

  async setEditing(workspaceId: string, runId: string, editing: boolean) {
    const outcome = await this.store.transitionInteractionEditing(
      workspaceId,
      runId,
      editing,
      this.now().toISOString(),
    );
    if (outcome === 'unknown_state') {
      throw new HarnessInteractionError(
        'INTERACTION_KIND_MISMATCH',
        'Interaction timing state is unavailable.',
      );
    }
    if (outcome === 'stale') {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REQUEST',
        'The interaction request is no longer pending.',
      );
    }
  }

  async setRendererCapability(
    workspaceId: string,
    runId: string,
    capability: HarnessInteractionPendingProjection['rendererCapability'],
  ) {
    if (
      !(await this.store.setInteractionRendererCapability(
        workspaceId,
        runId,
        interactionRendererCapabilitySchema.parse(capability),
      ))
    ) {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REQUEST',
        'The interaction request is no longer pending.',
      );
    }
  }

  private async submitParsed(
    workspaceId: string,
    answer: HarnessInteractionAnswer,
    resolutionSource: 'decision' | 'system_default',
  ): Promise<
    | { kind: 'reask'; request: HarnessInteractionRequest }
    | { kind: 'resumed'; replayed: boolean }
    | { kind: 'waiting'; replayed: boolean }
    | {
        kind: 'held';
        reason: 'deadline' | 'editing' | 'renderer' | 'policy';
      }
  > {
    const request = await this.store.readPendingInteraction(
      workspaceId,
      answer.resume.runId,
      { includeResolved: true },
    );
    if (!request || request.requestId !== answer.requestId) {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REQUEST',
        'The interaction request is no longer pending.',
      );
    }
    if (request.kind === 'ask_merchant') {
      if (!('items' in answer.response || answer.response.kind === 'skipped')) {
        throw new HarnessInteractionError(
          'INTERACTION_KIND_MISMATCH',
          'The interaction answer does not match the pending request kind.',
        );
      }
      const resolution = resolveAskMerchantAnswer(request, answer);
      if (resolution.kind === 'stale') {
        throw new HarnessInteractionError(
          'STALE_INTERACTION_REVISION',
          'The interaction answer targets a stale request revision.',
        );
      }
      if (resolution.kind === 'reask') {
        const registered = await this.store.advanceInteraction(
          workspaceId,
          resolution.request,
        );
        if (registered.outcome === 'conflict') {
          throw new HarnessInteractionError(
            'STALE_INTERACTION_REVISION',
            'The interaction changed before the follow-up could be registered.',
          );
        }
        return { kind: 'reask', request: resolution.request };
      }
      return this.persistAndResume({
        answer,
        request,
        resolutionSource,
        resumeData: resolution.resumeData,
        workspaceId,
      });
    }
    if (
      answer.resume.step !== 'execution_selection' ||
      (answer.response.kind !== 'approved' &&
        answer.response.kind !== 'rejected')
    ) {
      throw new HarnessInteractionError(
        'INTERACTION_KIND_MISMATCH',
        'The interaction answer does not match the pending request kind.',
      );
    }
    if (
      answer.revision !== request.revision ||
      answer.resume.runId !== request.runId
    ) {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REVISION',
        'The interaction answer targets a stale request revision.',
      );
    }
    if (
      answer.response.kind === 'rejected' &&
      answer.response.feedback === undefined
    ) {
      return this.persistAndResume({
        answer,
        request,
        resolutionSource,
        resumeData: answer.response,
        resumeDisposition: 'wait',
        workspaceId,
      });
    }
    return this.persistAndResume({
      answer,
      request,
      resolutionSource,
      resumeData: answer.response,
      workspaceId,
    });
  }

  private async persistAndResume(input: {
    answer: HarnessInteractionAnswer;
    request: HarnessInteractionRequest;
    resolutionSource: 'decision' | 'system_default';
    resumeDisposition?: 'resume' | 'wait';
    resumeData: HarnessInteractionAnswer['response'];
    workspaceId: string;
  }): Promise<
    | { kind: 'resumed'; replayed: boolean }
    | { kind: 'waiting'; replayed: boolean }
    | {
        kind: 'held';
        reason: 'deadline' | 'editing' | 'renderer' | 'policy';
      }
  > {
    const resumeDisposition = input.resumeDisposition ?? 'resume';
    const persisted = await this.store.resolveInteraction({
      workspaceId: input.workspaceId,
      answer: input.answer,
      payloadFingerprint: fingerprintValue({
        answer: input.answer,
        resolutionSource: input.resolutionSource,
        resumeDisposition,
        resumeData: input.resumeData,
      }),
      resolutionSource: input.resolutionSource,
      resumeDisposition,
      resumeData: input.resumeData,
      resolvedAt: this.now().toISOString(),
      trigger:
        input.resolutionSource === 'system_default'
          ? 'system_default'
          : 'merchant',
    });
    if (
      persisted.outcome === 'editing' ||
      persisted.outcome === 'ineligible' ||
      persisted.outcome === 'not_due' ||
      persisted.outcome === 'renderer_unavailable' ||
      persisted.outcome === 'unknown_state'
    ) {
      return {
        kind: 'held',
        reason:
          persisted.outcome === 'not_due'
            ? 'deadline'
            : persisted.outcome === 'renderer_unavailable'
              ? 'renderer'
              : persisted.outcome === 'editing'
                ? 'editing'
                : 'policy',
      };
    }
    if (persisted.outcome === 'idempotency_conflict') {
      throw new HarnessInteractionError(
        'INTERACTION_IDEMPOTENCY_CONFLICT',
        'The interaction idempotency key belongs to another answer.',
      );
    }
    if (persisted.outcome === 'stale_request') {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REQUEST',
        'The interaction request is no longer pending.',
      );
    }
    if (persisted.outcome === 'stale_revision') {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REVISION',
        'The interaction answer targets a stale request revision.',
      );
    }

    if (resumeDisposition === 'wait') {
      return {
        kind: 'waiting',
        replayed: persisted.outcome === 'replayed',
      };
    }

    const claimId = randomUUID();
    if (
      persisted.resumeRequired &&
      (await this.store.claimInteractionResume(
        input.workspaceId,
        input.request.runId,
        input.answer.idempotencyKey,
        claimId,
      ))
    ) {
      try {
        await this.resumer.resume({
          workspaceId: input.workspaceId,
          runId: input.request.runId,
          step: input.request.step,
          idempotencyKey: input.answer.idempotencyKey,
          interactionKind: input.request.kind,
          requestId: input.request.requestId,
          revision: input.request.revision,
          resumeData: input.resumeData,
          resolutionSource: input.resolutionSource,
        });
        if (
          !(await this.store.markInteractionResumed(
            input.workspaceId,
            input.request.runId,
            input.answer.idempotencyKey,
            claimId,
          ))
        ) {
          throw new Error('The interaction resume lease was lost.');
        }
      } catch (error) {
        await this.store.releaseInteractionResume(
          input.workspaceId,
          input.request.runId,
          input.answer.idempotencyKey,
          claimId,
        );
        throw new HarnessInteractionError(
          'INTERACTION_RESUME_UNAVAILABLE',
          'The persisted interaction could not resume the workflow yet.',
          { cause: error },
        );
      }
    }
    return {
      kind: 'resumed',
      replayed: persisted.outcome === 'replayed',
    };
  }
}
