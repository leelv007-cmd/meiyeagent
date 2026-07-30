import {
  askMerchantQuestionRequestSchema,
  askMerchantAnswerSchema,
  executionConfirmationRequestSchema,
  executionConfirmationAnswerSchema,
  harnessInteractionEditingSchema,
  harnessInteractionMerchantMessageSchema,
  harnessInteractionRendererAckSchema,
  harnessInteractionRequestSchema,
  type AskMerchantQuestionRequest,
  type HarnessStage,
  type HarnessInteractionAnswer,
  type HarnessInteractionEditing,
  type HarnessInteractionRendererAck,
  type HarnessInteractionRequest,
  type QuestionCard,
} from '@meiye/contracts';
import { z } from 'zod';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { resolveAskMerchantAnswer } from './ask-merchant-resolution.js';
export {
  buildAskMerchantSemanticDefaultTimeoutPolicy,
  isCurrentAskMerchantSemanticDefault,
} from './ask-merchant-timeout-authority.js';

const interactionRendererCapabilitySchema = z.enum([
  'available',
  'unavailable',
  'unknown',
]);

const interactionAnswerIdentitySchema = z
  .object({
    requestId: z.string().trim().min(1),
    revision: z.number().int().nonnegative(),
    idempotencyKey: z.string().trim().min(1),
    resume: z
      .object({
        runId: z.string().trim().min(1),
        step: z.string().trim().min(1),
      })
      .passthrough(),
  })
  .passthrough();

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
          editingLeaseExpiresAt: z.iso.datetime().nullable().optional(),
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
            editingLeaseExpiresAt: null,
          }
        : { kind: 'hold' },
  });
}

export function executionConfirmationInteractionRequestFromQuestion(input: {
  question: QuestionCard;
  request: {
    executionSnapshot?: {
      id: string;
      revision: number;
      quote: { revision: string };
      operation: string;
      catalogModel: { id: string; revision: string };
      deliverable: { kind: string };
      distributionTarget: string;
    };
  };
}) {
  const { question, request } = input;
  const snapshot = request.executionSnapshot;
  if (
    question.executionConfirmationAuthority?.kind !== 'external_action' ||
    !snapshot
  ) {
    return null;
  }
  return executionConfirmationRequestSchema.parse({
    requestId: question.questionId,
    runId: question.workflowId,
    step: 'execution_selection',
    revision: question.workflowRevision,
    kind: 'execution_confirmation',
    frozen: {
      executionSnapshotRef: {
        id: snapshot.id,
        revision: snapshot.revision,
      },
      quoteRevision: snapshot.quote.revision,
      params: [
        {
          key: 'model',
          label: '模型',
          value: `${snapshot.catalogModel.id}@${snapshot.catalogModel.revision}`,
          hint: null,
        },
        {
          key: 'deliverable',
          label: '交付内容',
          value: snapshot.deliverable.kind,
          hint: null,
        },
        {
          key: 'destination',
          label: '发布去向',
          value: snapshot.distributionTarget,
          hint: null,
        },
      ],
      debitPreview: [],
      condition: {
        kind: 'external_action',
        required: true,
        serverEvaluated: true,
      },
      timeoutPolicy: {
        kind: 'hold',
        reason: 'external_action',
        serverEvaluated: true,
      },
    },
    presentation: {
      carriers: ['conversation', 'task_card'],
      notification: 'none',
      renderer: 'execution_confirmation',
    },
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
  readWaitingInteraction(
    workspaceId: string,
    runId: string,
  ): Promise<HarnessInteractionRequest | null>;
  resolveInteraction(input: {
    workspaceId: string;
    answer: HarnessInteractionAnswer;
    payloadFingerprint: string;
    resolutionSource: 'decision' | 'system_default';
    resumeDisposition: 'resume' | 'wait';
    resumeData: HarnessInteractionAnswer['response'];
    resolvedAt: string;
    trigger: 'merchant' | 'merchant_message' | 'system_default';
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
    eventId?: string;
  }>;
  transitionInteractionEditing(
    workspaceId: string,
    runId: string,
    input: HarnessInteractionEditing,
  ): Promise<'updated' | 'replayed' | 'stale' | 'unknown_state'>;
  setInteractionRendererCapability(
    workspaceId: string,
    runId: string,
    capability: HarnessInteractionPendingProjection['rendererCapability'],
  ): Promise<boolean>;
  ackInteractionRenderer(
    workspaceId: string,
    runId: string,
    acknowledgement: HarnessInteractionRendererAck,
  ): Promise<'acked' | 'replayed' | 'stale' | 'unknown_state'>;
}

export interface HarnessInteractionResumer {
  resume(input: {
    eventId: string;
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

export interface HarnessSystemDefaultCandidateStore {
  listSystemDefaultCandidates(
    limit: number,
  ): Promise<Array<{ workspaceId: string; runId: string }>>;
}

export class HarnessSystemDefaultProducer {
  constructor(
    private readonly store: HarnessSystemDefaultCandidateStore,
    private readonly interactions: Pick<
      HarnessInteractionService,
      'submitSystemDefault'
    >,
    private readonly batchSize = 20,
  ) {}

  async runOnce() {
    let failed = 0;
    let held = 0;
    let resumed = 0;
    const candidates = await this.store.listSystemDefaultCandidates(
      this.batchSize,
    );
    for (const candidate of candidates) {
      try {
        const result = await this.interactions.submitSystemDefault(
          candidate.workspaceId,
          candidate.runId,
        );
        if (result.kind === 'resumed') {
          resumed += 1;
        } else {
          held += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { failed, held, resumed };
  }
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
    return request;
  }

  async ackRenderer(workspaceId: string, runId: string, input: unknown) {
    const outcome = await this.store.ackInteractionRenderer(
      workspaceId,
      runId,
      harnessInteractionRendererAckSchema.parse(input),
    );
    if (outcome === 'stale') {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REQUEST',
        'The interaction request is no longer pending.',
      );
    }
    if (outcome === 'unknown_state') {
      throw new HarnessInteractionError(
        'INTERACTION_KIND_MISMATCH',
        'The interaction renderer cannot acknowledge this pending state.',
      );
    }
  }

  async submit(
    workspaceId: string,
    input: unknown,
    expectedRunId?: string,
  ): Promise<
    | { kind: 'reask'; request: HarnessInteractionRequest }
    | { kind: 'resumed'; replayed: boolean }
    | { kind: 'waiting'; replayed: boolean }
    | {
        kind: 'held';
        reason: 'deadline' | 'editing' | 'renderer' | 'policy';
      }
  > {
    const identity = interactionAnswerIdentitySchema.parse(input);
    if (expectedRunId && identity.resume.runId !== expectedRunId) {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REQUEST',
        'The interaction request does not belong to the requested task.',
      );
    }
    const request = await this.store.readPendingInteraction(
      workspaceId,
      identity.resume.runId,
      { includeResolved: true },
    );
    if (
      !request ||
      request.requestId !== identity.requestId ||
      request.revision !== identity.revision ||
      request.runId !== identity.resume.runId ||
      request.step !== identity.resume.step
    ) {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REQUEST',
        'The interaction request is no longer pending.',
      );
    }
    if (request.kind === 'execution_confirmation') {
      return this.submitParsed(
        workspaceId,
        executionConfirmationAnswerSchema.parse(input),
        'decision',
      );
    }
    const parsed = askMerchantAnswerSchema.safeParse(input);
    if (parsed.success) {
      return this.submitParsed(workspaceId, parsed.data, 'decision');
    }
    const resolution = resolveAskMerchantAnswer(request, input);
    if (resolution.kind !== 'reask') {
      throw new HarnessInteractionError(
        'INTERACTION_KIND_MISMATCH',
        'The malformed interaction answer cannot be resumed.',
      );
    }
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

  async submitSystemDefault(workspaceId: string, runId: string) {
    const request = await this.store.readPendingInteraction(
      workspaceId,
      runId,
      { includeResolved: true },
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

  async submitMerchantMessage(
    workspaceId: string,
    runId: string,
    input: unknown,
  ) {
    const message = harnessInteractionMerchantMessageSchema.parse(input);
    const request = await this.store.readPendingInteraction(
      workspaceId,
      runId,
      { includeResolved: true },
    );
    if (!request) {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REQUEST',
        'The interaction request is no longer pending.',
      );
    }
    if (request.kind !== 'execution_confirmation') {
      throw new HarnessInteractionError(
        'INTERACTION_KIND_MISMATCH',
        'The pending interaction is not waiting for an execution message.',
      );
    }
    return this.persistAndResume({
      answer: {
        requestId: request.requestId,
        revision: request.revision,
        idempotencyKey: message.idempotencyKey,
        resume: { runId: request.runId, step: request.step },
        response: { kind: 'rejected', feedback: message.message },
      },
      request,
      resolutionSource: 'decision',
      resumeData: { kind: 'rejected', feedback: message.message },
      trigger: 'merchant_message',
      workspaceId,
    });
  }

  async readWaitingMessageForCarrier(
    workspaceId: string,
    runId: string,
    carrier: 'conversation' | 'store_page' | 'task_card',
  ) {
    const request = await this.store.readWaitingInteraction(
      workspaceId,
      runId,
    );
    return request &&
      request.kind === 'execution_confirmation' &&
      (request.presentation.carriers as readonly string[]).includes(carrier)
      ? request
      : null;
  }

  async setEditing(workspaceId: string, runId: string, input: unknown) {
    const outcome = await this.store.transitionInteractionEditing(
      workspaceId,
      runId,
      harnessInteractionEditingSchema.parse(input),
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
    trigger?: 'merchant_message';
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
        input.trigger ??
        (input.resolutionSource === 'system_default'
          ? 'system_default'
          : 'merchant'),
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

    if (persisted.resumeRequired) {
      if (!persisted.eventId) {
        throw new HarnessInteractionError(
          'INTERACTION_RESUME_UNAVAILABLE',
          'The persisted interaction has no durable resume event.',
        );
      }
      try {
        await this.resumer.resume({
          eventId: persisted.eventId,
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
      } catch (error) {
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
