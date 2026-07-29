import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  FirstUsableDraftMetric,
  StructuredDecisionInput,
} from '@meiye/contracts';
import {
  confirmationCardTimeoutSecondsSchema,
  harnessDecisionSnapshotSchema,
  questionCardUnattended,
} from '@meiye/contracts';

import { harnessActiveTaskListSchema } from '@meiye/contracts';

import type { HarnessDecisionService } from './decision-service.js';
import type { TodayRecommendationState } from '@meiye/contracts';
import type {
  HarnessTaskAdmissionService,
  HarnessTaskRequest,
} from './task-admission.js';
import type { HarnessInteractionService } from './interaction-service.js';

export interface HarnessTaskAccess {
  taskBelongsToWorkspace(taskId: string, workspaceId: string): Promise<boolean>;
  /** 时间桥 (D-145): runs still on the server, newest first. */
  listActiveTasks?(workspaceId: string): Promise<
    Array<{
      taskId: string;
      workId: string;
      packageId: string;
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
  | 'setEditing'
  | 'submit'
  | 'submitMerchantMessage'
>;

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
        resolutionSource: null,
        status: 'absent',
        timeoutSeconds: null,
      });
    }

    const keepResolvedQuestion =
      target.status === 'resolved' &&
      (target.resolutionSource === 'core_timeout' ||
        target.resolutionSource === 'core_hold_expired');
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
    return this.interactions.readForCarrier(
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
      throw new HarnessInteractionTaskMismatchError();
    }
    return this.interactions.submit(workspaceId, input, taskId);
  }

  async setInteractionEditing(
    workspaceId: string,
    taskId: string,
    editing: boolean,
  ) {
    await this.requireTask(workspaceId, taskId);
    if (!this.interactions) {
      throw new Error('Harness interactions are unavailable.');
    }
    return this.interactions.setEditing(workspaceId, taskId, editing);
  }

  async ackInteractionRenderer(workspaceId: string, taskId: string) {
    await this.requireTask(workspaceId, taskId);
    if (!this.interactions) {
      throw new Error('Harness interactions are unavailable.');
    }
    return this.interactions.ackRenderer(workspaceId, taskId);
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
}
