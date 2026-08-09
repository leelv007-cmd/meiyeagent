/**
 * Campaign goal → weekly Work schedule projection (V31-24).
 *
 * Confirmation granularity reuses V31-11 ExecutionConfirmationRequest /
 * PlanConfirmationDecision contracts (approvalScope=single_work + campaignPlanRef
 * + workOrdinal). This module only projects weekly slots — it does not reimplement
 * confirmation or billing.
 */

import type { AgentRevisionRef } from '@meiye/contracts';

export type CampaignWeeklySlot = {
  weekIndex: number;
  workOrdinal: number;
  weekStart: string;
  weekEnd: string;
  /** Always single_work for paid media — each slot confirms separately (U7). */
  approvalScope: 'single_work';
  campaignPlanRef: AgentRevisionRef;
};

/**
 * Split a campaign horizon into weekly slots. Each paid-media Work confirms
 * independently via V31-11 single_work + campaignPlanRef + workOrdinal.
 */
export function projectCampaignWeeklySlots(input: {
  campaignPlanRef: AgentRevisionRef;
  horizonFrom: string;
  horizonUntil: string;
  /** Max weeks to project (default 12). */
  maxWeeks?: number;
}): CampaignWeeklySlot[] {
  const fromMs = Date.parse(input.horizonFrom);
  const untilMs = Date.parse(input.horizonUntil);
  if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs <= fromMs) {
    return [];
  }
  const maxWeeks = input.maxWeeks ?? 12;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const slots: CampaignWeeklySlot[] = [];
  let cursor = fromMs;
  let weekIndex = 0;
  while (cursor < untilMs && weekIndex < maxWeeks) {
    const weekEnd = Math.min(cursor + weekMs, untilMs);
    slots.push({
      weekIndex,
      workOrdinal: weekIndex + 1,
      weekStart: new Date(cursor).toISOString(),
      weekEnd: new Date(weekEnd).toISOString(),
      approvalScope: 'single_work',
      campaignPlanRef: input.campaignPlanRef,
    });
    cursor = weekEnd;
    weekIndex += 1;
  }
  return slots;
}

export interface CampaignWorkSubmissionPort<TSubmission, TResult> {
  submitCampaignWork(input: {
    submission: TSubmission;
    campaignPlanRef: AgentRevisionRef;
    workOrdinal: number;
  }): Promise<TResult>;
}

/** Production producer: schedule slots become distinct paid Work submissions. */
export class CampaignPaidWorkProducer<TSubmission, TResult> {
  constructor(
    private readonly submissions: CampaignWorkSubmissionPort<
      TSubmission,
      TResult
    >,
  ) {}

  async produce(input: {
    slots: readonly CampaignWeeklySlot[];
    buildSubmission(slot: CampaignWeeklySlot): TSubmission;
  }): Promise<TResult[]> {
    const results: TResult[] = [];
    for (const slot of input.slots) {
      results.push(
        await this.submissions.submitCampaignWork({
          submission: input.buildSubmission(slot),
          campaignPlanRef: slot.campaignPlanRef,
          workOrdinal: slot.workOrdinal,
        }),
      );
    }
    return results;
  }
}
