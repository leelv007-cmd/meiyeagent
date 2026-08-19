import { todayRecommendationStateSchema } from '@meiye/contracts';
import { serializeCanonicalDeepLink } from '../../canonical-deep-link.js';
import { z } from 'zod';

import type { ProductNotifier } from '../../product/notifier.js';
import type { DueDeliveryPort } from './worker.js';
import { dailyRecommendationDeliveryOutputSchema } from './recommendation-reader.js';

export interface DailyRecommendationCandidateReader {
  readDailyRecommendationCandidate(
    workspaceId: string,
    at: string,
  ): Promise<unknown>;
}

export const taskRecallDeliveryOutputSchema = z
  .object({
    notification: z
      .object({
        nextStep: z.string().trim().min(1).optional(),
        taskId: z.string().trim().min(1),
        title: z.string().trim().min(1),
      })
      .strict(),
    schemaVersion: z.literal('task-recall-delivery/v1'),
    source: z
      .object({
        actorId: z.literal('system:due-scanner'),
        generationRequested: z.literal(false),
        runId: z.string().trim().min(1),
        taskId: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export class DailyRecommendationDeliveryPort implements DueDeliveryPort {
  constructor(
    private readonly candidates: DailyRecommendationCandidateReader,
    private readonly clock: () => Date = () => new Date(),
    private readonly notifier?: Pick<ProductNotifier, 'notify'>,
  ) {}

  async deliver(input: Parameters<DueDeliveryPort['deliver']>[0]) {
    if (
      input.actorId !== 'system:due-scanner' ||
      input.generationRequested !== false ||
      input.idempotencyKey !== input.runId
    ) {
      throw new Error('Due delivery source identity is invalid.');
    }
    if (input.type === 'task_recall') {
      if (input.payload.schemaVersion !== 'task-recall/v1') {
        throw new Error('Task recall delivery payload is invalid.');
      }
      const output = taskRecallDeliveryOutputSchema.parse({
        notification: {
          ...(input.payload.nextStep
            ? { nextStep: input.payload.nextStep }
            : {}),
          taskId: input.payload.taskId,
          title: input.payload.title,
        },
        schemaVersion: 'task-recall-delivery/v1',
        source: {
          actorId: input.actorId,
          generationRequested: input.generationRequested,
          runId: input.runId,
          taskId: input.taskId,
        },
      });
      if (!this.notifier) {
        throw new Error('Task recall delivery requires a product notifier.');
      }
      await this.notifier.notify({
        correlationId: input.runId,
        deepLink: serializeCanonicalDeepLink({
          producer: 'notification',
          objectClass: 'taskId',
          id: output.notification.taskId,
        }),
        idempotencyKey: input.runId,
        jobId: output.notification.taskId,
        message: output.notification.nextStep
          ? `${output.notification.title}：${output.notification.nextStep}`
          : output.notification.title,
        status: 'completed',
        workspaceId: input.workspaceId,
      });
      return { output };
    }
    if (
      input.payload.schemaVersion !== 'daily-recommendation/v1' ||
      !input.businessDate ||
      input.payload.businessDate !== input.businessDate
    ) {
      throw new Error('Daily recommendation delivery payload is invalid.');
    }
    const deliveredAt = this.clock().toISOString();
    const state = todayRecommendationStateSchema.parse(
      await this.candidates.readDailyRecommendationCandidate(
        input.workspaceId,
        deliveredAt,
      ),
    );
    if (
      state.workspaceId !== input.workspaceId ||
      !state.recommendation ||
      state.recommendation.workspaceId !== input.workspaceId
    ) {
      throw new Error('Daily delivery requires a usable recommendation.');
    }
    return {
      output: dailyRecommendationDeliveryOutputSchema.parse({
        schemaVersion: 'daily-recommendation-delivery/v1',
        source: {
          actorId: input.actorId,
          businessDate: input.businessDate,
          generationRequested: input.generationRequested,
          runId: input.runId,
          taskId: input.taskId,
        },
        state: {
          ...state,
          recommendation: {
            ...state.recommendation,
            createdAt: deliveredAt,
            taskId: input.taskId,
          },
        },
      }),
    };
  }
}
