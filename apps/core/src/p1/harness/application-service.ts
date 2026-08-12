import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  FirstUsableDraftMetric,
  StructuredDecisionInput,
} from '@meiye/contracts';
import {
  confirmationCardTimeoutSecondsSchema,
  executionConfirmationAnswerSchema,
  harnessDecisionSnapshotSchema,
  harnessInteractionRendererAckSchema,
  questionCardUnattended,
} from '@meiye/contracts';

import { harnessActiveTaskListSchema } from '@meiye/contracts';

import type { HarnessDecisionService } from './decision-service.js';
import type { TodayRecommendationState } from '@meiye/contracts';
import type {
  HarnessTaskAdmissionService,
  HarnessTaskRequest,
} from './task-admission.js';
import {
  HarnessInteractionError,
  repricedSuccessorConfirmationInteractionRequest,
  type HarnessInteractionService,
} from './interaction-service.js';

export interface HarnessTaskAccess {
  taskBelongsToWorkspace(taskId: string, workspaceId: string): Promise<boolean>;
  /** 时间桥 (D-145): runs still on the server, newest first. */
  listActiveTasks?(workspaceId: string): Promise<
    Array<{
      taskId: string;
      workId: string;
      packageId: string;
      agentThreadId?: string;
      agentRunId?: string;
      executionConfirmationRequestId?: string;
      merchantText: string;
      submittedAt: string;
    }>
  >;
}

export interface HarnessRecommendationReader {
  readTodayRecommendation(workspaceId: string): Promise<TodayRecommendationState>;
}

export interface HarnessProductMetricRecorder {
  appendAudit(event: {
    workspaceId: string;
    id: string;
    workflowId: string;
    stage: string;
    eventType: string;
    payload: unknown;
  }): Promise<void>;
}

export interface HarnessConfirmationTimeoutReader {
  readTimeoutSeconds(): Promise<unknown>;
}

export type HarnessInteractionApplicationPort = Pick<
  HarnessInteractionService,
  | 'ackRenderer'
  | 'readForCarrier'
  | 'readWaitingMessageForCarrier'
  | 'setEditing'
  | 'submit'
  | 'submitMerchantMessage'
> &
  Partial<Pick<HarnessInteractionService, 'readSnapshotForCarrier'>>;

/**
 * V31-63 §37.4-E design decision: the browser session that watched the
 * superseded run keeps polling the ORIGINAL task id every 2s, so the reprice
 * successor's pending confirmation must be projected server-side into that
 * same thread — the successor is resolved through the durable predecessor
 * chain rather than teaching every surface a second task id. The successor
 * has no suspended workflow: an approved answer routes to its explicit
 * prepared start (the coordinator verifies the immutable confirmed decision),
 * a rejected answer leaves the reserved admission to its decide-side refund.
 */
export interface HarnessSuccessorConfirmationProjection {
  successorWorkflowId: string;
  successorTaskId: string;
  planRevision: number;
  confirmationStatus: 'pending' | 'decided';
  /** The successor's locked durable task request (structural subset). */
  request: {
    workflowRevision: number;
    executionConfirmationRequestId?: string;
    executionConfirmationReservedCredits?: number;
    executionSnapshot?: {
      id: string;
      revision: number;
      quote: { revision: string };
      operation: string;
      catalogModel: { id: string; revision: string };
      deliverable: { kind: string };
      distributionTarget: string;
      work: { id: string };
      contentPackage: { id: string };
    };
  };
}

export interface HarnessSuccessorConfirmationPort {
  readPendingSuccessorConfirmation(
    workspaceId: string,
    taskId: string,
  ): Promise<HarnessSuccessorConfirmationProjection | null>;
  startConfirmedSuccessor(input: {
    workspaceId: string;
    taskId: string;
    planRevision: number;
  }): Promise<void>;
}

export class HarnessAccessError extends Error {
  readonly code = 'HARNESS_TASK_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Harness task was not found.');
    this.name = 'HarnessAccessError';
  }
}

export class HarnessInteractionTaskMismatchError extends Error {
  readonly code = 'HARNESS_INTERACTION_TASK_MISMATCH';
  readonly status = 409;

  constructor() {
    super('Harness interaction does not belong to the requested task.');
    this.name = 'HarnessInteractionTaskMismatchError';
  }
}

const interactionAnswerTaskSchema = z
  .object({
    resume: z.object({ runId: z.string().trim().min(1) }).passthrough(),
  })
  .passthrough();

export class HarnessApplicationService {
  constructor(
    private readonly admission: HarnessTaskAdmissionService,
    private readonly decisions: HarnessDecisionService,
    private readonly access: HarnessTaskAccess,
    private readonly recommendations?: HarnessRecommendationReader,
    private readonly productMetrics?: HarnessProductMetricRecorder,
    private readonly confirmationTimeout?: HarnessConfirmationTimeoutReader,
    private readonly interactions?: HarnessInteractionApplicationPort,
    private readonly successorConfirmations?: HarnessSuccessorConfirmationPort,
  ) {}

  submit(input: HarnessTaskRequest) {
    return this.admission.submit(input);
  }

  taskBelongsToWorkspace(taskId: string, workspaceId: string) {
    return this.access.taskBelongsToWorkspace(taskId, workspaceId);
  }

  async readPendingDecision(workspaceId: string, taskId: string) {
    await this.requireTask(workspaceId, taskId);
    const target = await this.decisions.readDecisionTarget(
      workspaceId,
      taskId,
    );
    if (!target) {
      return harnessDecisionSnapshotSchema.parse({
        question: null,
        reservationReleased: false,
        resolutionSource: null,
        status: 'absent',
        timeoutSeconds: null,
      });
    }

    const keepResolvedQuestion =
      target.status === 'resolved' &&
      (target.resolutionSource === 'core_timeout' ||
        target.resolutionSource === 'core_hold_expired' ||
        target.resolutionSource === 'late_answer');
    const question =
      target.status === 'pending' || keepResolvedQuestion
        ? target.question
        : null;
    const timeoutSeconds =
      question &&
      target.status === 'pending' &&
      questionCardUnattended(question) === 'continue'
        ? target.timeoutSeconds === undefined
          ? confirmationCardTimeoutSecondsSchema.parse(
              await this.confirmationTimeout?.readTimeoutSeconds(),
            )
          : target.timeoutSeconds === null
            ? null
            : confirmationCardTimeoutSecondsSchema.parse(
                target.timeoutSeconds,
              )
        : null;

    return harnessDecisionSnapshotSchema.parse({
      question,
      reservationReleased: target.reservationReleased === true,
      resolutionSource:
        target.status === 'resolved' ? target.resolutionSource : null,
      status: target.status,
      timeoutSeconds,
    });
  }

  /**
   * The server side of 时间桥拉回 (D-145). Returns an empty list rather than
   * failing when the store cannot answer: a missing bridge must never be the
   * reason a composer will not mount.
   */
  async listActiveTasks(workspaceId: string) {
    const tasks = (await this.access.listActiveTasks?.(workspaceId)) ?? [];
    return harnessActiveTaskListSchema.parse({ tasks });
  }

  async submitDecision(
    workspaceId: string,
    taskId: string,
    input: StructuredDecisionInput,
  ) {
    await this.requireTask(workspaceId, taskId);
    return this.decisions.submit(workspaceId, taskId, input);
  }

  async readPendingInteraction(workspaceId: string, taskId: string) {
    await this.requireTask(workspaceId, taskId);
    if (!this.interactions) return null;
    const pending = await this.interactions.readForCarrier(
      workspaceId,
      taskId,
      'conversation',
    );
    if (pending) return pending;
    // V31-63: a reprice successor's confirmation card renders in the
    // predecessor's session thread — same GET, projected from the durable
    // successor admission when no suspended interaction exists.
    return this.readProjectedSuccessorConfirmation(workspaceId, taskId);
  }

  async readInteractionSnapshot(workspaceId: string, taskId: string) {
    await this.requireTask(workspaceId, taskId);
    if (!this.interactions?.readSnapshotForCarrier) {
      return {
        request: null,
        resolutionSource: null,
        status: 'absent' as const,
      };
    }
    return this.interactions.readSnapshotForCarrier(
      workspaceId,
      taskId,
      'conversation',
    );
  }

  async submitInteraction(
    workspaceId: string,
    taskId: string,
    input: unknown,
  ) {
    await this.requireTask(workspaceId, taskId);
    if (!this.interactions) {
      throw new Error('Harness interactions are unavailable.');
    }
    if (interactionAnswerTaskSchema.parse(input).resume.runId !== taskId) {
      // V31-63: an answer to the projected successor card names the successor
      // workflow as its run while the browser still posts to the original
      // task's thread. Route it to the successor's explicit start; anything
      // else with a foreign run id stays a 409.
      const successorResult = await this.submitProjectedSuccessorAnswer(
        workspaceId,
        taskId,
        input,
      );
      if (successorResult) return successorResult;
      throw new HarnessInteractionTaskMismatchError();
    }
    return this.interactions.submit(workspaceId, input, taskId);
  }

  async setInteractionEditing(
    workspaceId: string,
    taskId: string,
    input: unknown,
  ) {
    await this.requireTask(workspaceId, taskId);
    if (!this.interactions) {
      throw new Error('Harness interactions are unavailable.');
    }
    return this.interactions.setEditing(workspaceId, taskId, input);
  }

  async ackInteractionRenderer(
    workspaceId: string,
    taskId: string,
    input: unknown,
  ) {
    await this.requireTask(workspaceId, taskId);
    if (!this.interactions) {
      throw new Error('Harness interactions are unavailable.');
    }
    try {
      return await this.interactions.ackRenderer(workspaceId, taskId, input);
    } catch (error) {
      // V31-63: the projected successor card has no pending_questions row, so
      // the durable ack lands 'stale'. When the ack names exactly the
      // projected request, accept it — the projection itself is the durable
      // record that the card is renderable.
      if (
        error instanceof HarnessInteractionError &&
        error.code === 'STALE_INTERACTION_REQUEST' &&
        (await this.projectedSuccessorAckMatches(workspaceId, taskId, input))
      ) {
        return;
      }
      throw error;
    }
  }

  async submitInteractionMerchantMessage(
    workspaceId: string,
    taskId: string,
    input: unknown,
  ) {
    await this.requireTask(workspaceId, taskId);
    if (!this.interactions) {
      throw new Error('Harness interactions are unavailable.');
    }
    return this.interactions.submitMerchantMessage(
      workspaceId,
      taskId,
      input,
    );
  }

  async readInteractionMerchantMessage(
    workspaceId: string,
    taskId: string,
  ) {
    await this.requireTask(workspaceId, taskId);
    if (!this.interactions) return null;
    return this.interactions.readWaitingMessageForCarrier(
      workspaceId,
      taskId,
      'conversation',
    );
  }

  readTodayRecommendation(workspaceId: string) {
    if (!this.recommendations) {
      throw new Error('Harness recommendations are unavailable.');
    }
    return this.recommendations.readTodayRecommendation(workspaceId);
  }

  async recordFirstUsableDraftMetric(
    workspaceId: string,
    taskId: string,
    input: FirstUsableDraftMetric,
  ) {
    await this.requireTask(workspaceId, taskId);
    if (!this.productMetrics) {
      throw new Error('Harness product metrics are unavailable.');
    }
    const eventSuffix = createHash('sha256')
      .update(`${taskId}:${input.idempotencyKey}`)
      .digest('hex')
      .slice(0, 24);
    await this.productMetrics.appendAudit({
      workspaceId,
      id: `audit-${taskId}-first-usable-draft-${eventSuffix}`,
      workflowId: taskId,
      stage: 'product_experience',
      eventType: 'first_usable_draft_observed',
      payload: {
        path: input.path,
        timeToFirstUsableDraftMs: input.timeToFirstUsableDraftMs,
        userActivationCount: input.userActivationCount,
      },
    });
    return { recorded: true as const };
  }

  private async requireTask(workspaceId: string, taskId: string) {
    if (!(await this.access.taskBelongsToWorkspace(taskId, workspaceId))) {
      throw new HarnessAccessError();
    }
  }

  /** Pending-only read projection of the reprice successor's confirmation. */
  private async readProjectedSuccessorConfirmation(
    workspaceId: string,
    taskId: string,
  ) {
    const successor = await this.projectSuccessorConfirmation(
      workspaceId,
      taskId,
    );
    return successor?.chain.confirmationStatus === 'pending'
      ? successor.request
      : null;
  }

  private async projectSuccessorConfirmation(
    workspaceId: string,
    taskId: string,
  ) {
    if (!this.successorConfirmations) return null;
    const chain =
      await this.successorConfirmations.readPendingSuccessorConfirmation(
        workspaceId,
        taskId,
      );
    if (!chain) return null;
    const request = repricedSuccessorConfirmationInteractionRequest({
      successorWorkflowId: chain.successorWorkflowId,
      request: chain.request,
    });
    return request ? { chain, request } : null;
  }

  /**
   * Answer path for the projected successor card. The identity must match the
   * projection exactly (same request/revision/run/step). `approved` starts the
   * prepared successor — the coordinator independently verifies the immutable
   * confirmed decision the browser recorded through the decide endpoint before
   * this call. `rejected` resolves the exchange without a start; the decide
   * endpoint already settled the refund. Returns null when the answer does not
   * belong to a projected successor, so the caller keeps its 409.
   */
  private async submitProjectedSuccessorAnswer(
    workspaceId: string,
    taskId: string,
    input: unknown,
  ): Promise<{
    kind: 'resumed';
    replayed: boolean;
    successorTask?: { taskId: string; workId: string; packageId: string };
  } | null> {
    if (!this.successorConfirmations) return null;
    const answer = executionConfirmationAnswerSchema.safeParse(input);
    if (!answer.success) return null;
    const successor = await this.projectSuccessorConfirmation(
      workspaceId,
      taskId,
    );
    if (
      !successor ||
      successor.request.requestId !== answer.data.requestId ||
      successor.request.revision !== answer.data.revision ||
      successor.request.runId !== answer.data.resume.runId ||
      successor.request.step !== answer.data.resume.step
    ) {
      return null;
    }
    if (answer.data.response.kind !== 'approved') {
      // The decide endpoint already recorded the immutable rejection and its
      // refund; the reserved successor admission simply never starts.
      return { kind: 'resumed', replayed: false };
    }
    await this.successorConfirmations.startConfirmedSuccessor({
      workspaceId,
      taskId: successor.chain.successorTaskId,
      planRevision: successor.chain.planRevision,
    });
    // Hand the successor's task handle back so the session that was watching
    // the superseded run can bind onto the run that will actually deliver.
    const snapshot = successor.chain.request.executionSnapshot;
    return {
      kind: 'resumed',
      replayed: false,
      ...(snapshot
        ? {
            successorTask: {
              taskId: successor.chain.successorTaskId,
              workId: snapshot.work.id,
              packageId: snapshot.contentPackage.id,
            },
          }
        : {}),
    };
  }

  private async projectedSuccessorAckMatches(
    workspaceId: string,
    taskId: string,
    input: unknown,
  ) {
    const ack = harnessInteractionRendererAckSchema.safeParse(input);
    if (!ack.success) return false;
    const successor = await this.projectSuccessorConfirmation(
      workspaceId,
      taskId,
    );
    return Boolean(
      successor &&
        successor.chain.confirmationStatus === 'pending' &&
        successor.request.requestId === ack.data.requestId &&
        successor.request.revision === ack.data.revision &&
        successor.request.step === ack.data.step &&
        (successor.request.presentation.carriers as readonly string[]).includes(
          ack.data.carrier,
        ),
    );
  }
}
