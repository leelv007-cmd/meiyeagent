import type { AgentRevisionRef } from '@meiye/contracts';

import { CampaignPaidWorkProducer } from './campaign-weekly-schedule.js';

export type CampaignPaidWorkResult = {
  contentPackage: { id: string };
  /**
   * Present when submit withheld Make for a paid Living Plan park. The browser
   * commit strip must decide this authority before explicit start (U7 / V31-56).
   */
  executionConfirmationRequestId?: string;
  makeReady?: boolean;
  runId: string;
  task: { id: string };
  threadId: string;
  work: { id: string };
};

export type CampaignPaidWorkSubmission = {
  agentThreadId?: string;
  idempotencyKey: string;
};

export type CampaignPaidWorkLifecycleRecord<
  TSubmission extends CampaignPaidWorkSubmission,
  TResult extends CampaignPaidWorkResult,
> = {
  campaignId: string;
  campaignPlanRef: AgentRevisionRef;
  planApprovalRequestId: string;
  results: Array<TResult | undefined>;
  submissions: [TSubmission, TSubmission];
  workspaceId: string;
};

export interface CampaignPaidWorkLifecycleStore<
  TSubmission extends CampaignPaidWorkSubmission,
  TResult extends CampaignPaidWorkResult,
> {
  create(
    record: CampaignPaidWorkLifecycleRecord<TSubmission, TResult>
  ): Promise<CampaignPaidWorkLifecycleRecord<TSubmission, TResult>>;
  get(
    workspaceId: string,
    campaignId: string
  ): Promise<CampaignPaidWorkLifecycleRecord<TSubmission, TResult> | null>;
  isDelivered(workspaceId: string, taskId: string): Promise<boolean>;
  listOpen(limit: number): Promise<
    Array<CampaignPaidWorkLifecycleRecord<TSubmission, TResult>>
  >;
  claimWork(
    workspaceId: string,
    campaignId: string,
    workOrdinal: number
  ): Promise<
    | {
        kind: 'claimed' | 'busy' | 'complete';
        record: CampaignPaidWorkLifecycleRecord<TSubmission, TResult>;
      }
  >;
  completeWork(
    workspaceId: string,
    campaignId: string,
    workOrdinal: number,
    result: TResult
  ): Promise<CampaignPaidWorkLifecycleRecord<TSubmission, TResult>>;
  releaseWork(
    workspaceId: string,
    campaignId: string,
    workOrdinal: number
  ): Promise<void>;
}

export interface CampaignPlanApprovalDecisionPort {
  isConfirmed(workspaceId: string, requestId: string): Promise<boolean>;
}

/**
 * Durable Campaign lifecycle. Work 2 cannot be claimed until Work 1 has a
 * canonical package_delivered audit, and it continues the same Agent Thread.
 */
export class CampaignPaidWorkLifecycle<
  TSubmission extends CampaignPaidWorkSubmission,
  TResult extends CampaignPaidWorkResult,
> {
  constructor(
    private readonly store: CampaignPaidWorkLifecycleStore<
      TSubmission,
      TResult
    >,
    private readonly producer: CampaignPaidWorkProducer<TSubmission, TResult>,
    private readonly planApproval: CampaignPlanApprovalDecisionPort
  ) {}

  async start(input: {
    campaignId: string;
    campaignPlanRef: AgentRevisionRef;
    planApprovalRequestId: string;
    submissions: [TSubmission, TSubmission];
    workspaceId: string;
  }) {
    await this.store.create({
      campaignId: input.campaignId,
      campaignPlanRef: input.campaignPlanRef,
      planApprovalRequestId: input.planApprovalRequestId,
      results: [],
      submissions: input.submissions,
      workspaceId: input.workspaceId,
    });
    return this.requireRecord(input.workspaceId, input.campaignId);
  }

  async advance(workspaceId: string, campaignId: string) {
    let record = await this.requireRecord(workspaceId, campaignId);
    if (
      !record.results[0] &&
      !(await this.planApproval.isConfirmed(
        workspaceId,
        record.planApprovalRequestId
      ))
    ) {
      return record;
    }
    if (!record.results[0]) {
      record = await this.produceWork(record, 1);
    }
    const first = record.results[0];
    if (
      first &&
      !record.results[1] &&
      (await this.store.isDelivered(workspaceId, first.task.id))
    ) {
      record = await this.produceWork(record, 2);
    }
    return record;
  }

  async get(workspaceId: string, campaignId: string) {
    return this.requireRecord(workspaceId, campaignId);
  }

  async advanceOpen(limit = 50) {
    const records = await this.store.listOpen(limit);
    for (const record of records) {
      await this.advance(record.workspaceId, record.campaignId);
    }
    return records.length;
  }

  private async produceWork(
    record: CampaignPaidWorkLifecycleRecord<TSubmission, TResult>,
    workOrdinal: 1 | 2
  ) {
    const claim = await this.store.claimWork(
      record.workspaceId,
      record.campaignId,
      workOrdinal
    );
    if (claim.kind !== 'claimed') {
      return claim.record;
    }
    const first = claim.record.results[0];
    const submission = {
      ...claim.record.submissions[workOrdinal - 1],
      ...(workOrdinal === 2 && first
        ? { agentThreadId: first.threadId }
        : {}),
    } as TSubmission;
    try {
      const produced = await this.producer.produceWork({
        campaignPlanRef: claim.record.campaignPlanRef,
        submission,
        workOrdinal,
      });
      return this.store.completeWork(
        record.workspaceId,
        record.campaignId,
        workOrdinal,
        produced
      );
    } catch (error) {
      await this.store.releaseWork(
        record.workspaceId,
        record.campaignId,
        workOrdinal
      );
      throw error;
    }
  }

  private async requireRecord(workspaceId: string, campaignId: string) {
    const record = await this.store.get(workspaceId, campaignId);
    if (!record) {
      throw new Error('Campaign paid Work lifecycle was not found.');
    }
    return record;
  }
}
