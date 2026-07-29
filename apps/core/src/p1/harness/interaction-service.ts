import {
  askMerchantAnswerSchema,
  executionConfirmationAnswerSchema,
  harnessInteractionAnswerSchema,
  harnessInteractionRequestSchema,
  type HarnessDecisionResolutionSource,
  type HarnessInteractionAnswer,
  type HarnessInteractionRequest,
} from '@meiye/contracts';
import { randomUUID } from 'node:crypto';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { resolveAskMerchantAnswer } from './ask-merchant-resolution.js';

export interface HarnessInteractionStore {
  registerInteraction(
    workspaceId: string,
    request: HarnessInteractionRequest,
  ): Promise<{
    outcome: 'created' | 'replayed' | 'conflict';
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
    resolutionSource: HarnessDecisionResolutionSource;
    resumeData: HarnessInteractionAnswer['response'];
  }): Promise<{
    outcome:
      | 'created'
      | 'replayed'
      | 'stale_request'
      | 'stale_revision'
      | 'idempotency_conflict';
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
  isInteractionEditing?(
    workspaceId: string,
    runId: string,
  ): Promise<boolean>;
  setInteractionEditing?(
    workspaceId: string,
    runId: string,
    editing: boolean,
  ): Promise<boolean>;
}

export interface HarnessInteractionResumer {
  resume(input: {
    workspaceId: string;
    runId: string;
    step: string;
    resumeData: HarnessInteractionAnswer['response'];
    resolutionSource: HarnessDecisionResolutionSource;
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
  ) {}

  async request(workspaceId: string, input: unknown) {
    const request = harnessInteractionRequestSchema.parse(input);
    if (
      request.kind === 'execution_confirmation' &&
      !request.frozen.condition.required
    ) {
      return { kind: 'continued' as const };
    }
    const registered = await this.store.registerInteraction(
      workspaceId,
      request,
    );
    if (registered.outcome === 'conflict') {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REVISION',
        'Another interaction is already pending for this run.',
      );
    }
    return {
      kind: 'pending' as const,
      replayed: registered.outcome === 'replayed',
    };
  }

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

  async submit(
    workspaceId: string,
    input: unknown,
  ): Promise<
    | { kind: 'reask'; request: HarnessInteractionRequest }
    | { kind: 'resumed'; replayed: boolean }
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
    if (await this.store.isInteractionEditing?.(workspaceId, runId)) {
      return { kind: 'held' as const, reason: 'editing' as const };
    }
    if (request.kind === 'execution_confirmation') {
      if (
        request.frozen.timeoutPolicy.kind === 'hold' ||
        request.frozen.condition.kind === 'external_action'
      ) {
        return { kind: 'held' as const, reason: 'policy' as const };
      }
      return this.submitParsed(
        workspaceId,
        executionConfirmationAnswerSchema.parse({
          requestId: request.requestId,
          revision: request.revision,
          idempotencyKey: `${request.requestId}:r${request.revision}:system_default`,
          resume: { runId: request.runId, step: request.step },
          response: { kind: 'approved' },
        }),
        'system_default',
      );
    }
    return this.submitParsed(
      workspaceId,
      askMerchantAnswerSchema.parse({
        requestId: request.requestId,
        revision: request.revision,
        idempotencyKey: `${request.requestId}:r${request.revision}:system_default`,
        resume: { runId: request.runId, step: request.step },
        response: {
          kind: 'answer',
          items: request.questions.map((question) => ({
            itemId: question.itemId,
            result: { kind: 'deferred' },
          })),
        },
      }),
      'system_default',
    );
  }

  async setEditing(workspaceId: string, runId: string, editing: boolean) {
    if (!this.store.setInteractionEditing) {
      throw new HarnessInteractionError(
        'INTERACTION_KIND_MISMATCH',
        'Interaction editing persistence is unavailable.',
      );
    }
    if (
      !(await this.store.setInteractionEditing(workspaceId, runId, editing))
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
        const registered = await this.store.registerInteraction(
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
    resolutionSource: HarnessDecisionResolutionSource;
    resumeData: HarnessInteractionAnswer['response'];
    workspaceId: string;
  }): Promise<{ kind: 'resumed'; replayed: boolean }> {
    const persisted = await this.store.resolveInteraction({
      workspaceId: input.workspaceId,
      answer: input.answer,
      payloadFingerprint: fingerprintValue({
        answer: input.answer,
        resolutionSource: input.resolutionSource,
        resumeData: input.resumeData,
      }),
      resolutionSource: input.resolutionSource,
      resumeData: input.resumeData,
    });
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
