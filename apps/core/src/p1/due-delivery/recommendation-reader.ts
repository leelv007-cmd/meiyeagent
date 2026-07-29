import {
  todayRecommendationStateSchema,
  type TodayRecommendationState,
} from '@meiye/contracts';
import { z } from 'zod';

import type { HarnessRecommendationReader } from '../harness/application-service.js';

export const dailyRecommendationDeliveryOutputSchema = z
  .object({
    schemaVersion: z.literal('daily-recommendation-delivery/v1'),
    source: z
      .object({
        actorId: z.literal('system:due-scanner'),
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
        generationRequested: z.literal(false),
        runId: z.string().trim().min(1),
        taskId: z.string().trim().min(1),
      })
      .strict(),
    state: todayRecommendationStateSchema,
  })
  .strict();

export type DailyRecommendationDeliveryOutput = z.infer<
  typeof dailyRecommendationDeliveryOutputSchema
>;

export interface DailyRecommendationDueReader {
  ensureDailyRecommendationDue(
    workspaceId: string,
    businessDate: string,
  ): Promise<unknown>;
  readLatestDelivered(
    workspaceId: string,
    type: 'daily_recommendation',
  ): Promise<{
    businessDate: string | null;
    completedAt: string;
    output: Record<string, unknown>;
    runId: string;
    taskId: string;
  } | null>;
}

export class DueAwareHarnessRecommendationReader
  implements HarnessRecommendationReader
{
  constructor(
    private readonly base: HarnessRecommendationReader,
    private readonly due: DailyRecommendationDueReader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async readTodayRecommendation(
    workspaceId: string,
  ): Promise<TodayRecommendationState> {
    const businessDate = this.clock().toISOString().slice(0, 10);
    await this.due.ensureDailyRecommendationDue(workspaceId, businessDate);
    const delivered = await this.due.readLatestDelivered(
      workspaceId,
      'daily_recommendation',
    );
    if (!delivered || delivered.businessDate !== businessDate) {
      return this.readPendingRecommendation(workspaceId);
    }
    const parsed = dailyRecommendationDeliveryOutputSchema.safeParse(
      delivered.output,
    );
    if (
      !parsed.success ||
      parsed.data.source.businessDate !== businessDate ||
      parsed.data.source.runId !== delivered.runId ||
      parsed.data.source.taskId !== delivered.taskId ||
      parsed.data.state.workspaceId !== workspaceId ||
      !parsed.data.state.recommendation ||
      parsed.data.state.recommendation.workspaceId !== workspaceId ||
      parsed.data.state.recommendation.taskId !== delivered.taskId
    ) {
      return this.readPendingRecommendation(workspaceId);
    }
    return parsed.data.state;
  }

  private async readPendingRecommendation(workspaceId: string) {
    const base = await this.base.readTodayRecommendation(workspaceId);
    return {
      ...base,
      recommendation: null,
    };
  }
}
