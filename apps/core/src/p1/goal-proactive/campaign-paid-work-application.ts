import { z } from 'zod';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import {
  composerSubmissionBodySchema,
  type ComposerSubmissionBody,
  type ComposerSubmissionRequest,
} from '../execution-spine/creation-execution-snapshot.js';
import type {
  CampaignPaidWorkLifecycleRecord,
  CampaignPaidWorkResult,
} from './campaign-paid-work-lifecycle.js';

export const campaignPaidWorkStartBodySchema = z
  .object({
    firstWork: composerSubmissionBodySchema,
    secondWorkIntent: z.string().trim().min(1).max(10_000),
  })
  .strict();

export type CampaignPaidWorkApplicationRecord = CampaignPaidWorkLifecycleRecord<
  ComposerSubmissionRequest,
  CampaignPaidWorkResult
>;
export type CampaignPaidWorkApplicationStart = Omit<
  CampaignPaidWorkApplicationRecord,
  'results'
>;

export type CampaignPlanApprovalProjection = {
  approvalScope: 'plan_only';
  planOnlyNotice: string;
  requestId: string;
  reservedCredits: 0;
  status: 'pending' | 'confirmed' | 'rejected' | 'expired';
};

export interface CampaignPlanApprovalPort {
  ensure(input: {
    actorId: string;
    campaignId: string;
    campaignPlanRef: { id: string; revision: number };
    quoteRef: { id: string; revision: string | number };
    snapshotHash: string;
    workspaceId: string;
  }): Promise<CampaignPlanApprovalProjection>;
  read(
    workspaceId: string,
    requestId: string
  ): Promise<CampaignPlanApprovalProjection>;
}

type LifecyclePort = {
  start(input: CampaignPaidWorkApplicationStart): Promise<CampaignPaidWorkApplicationRecord>;
  advance(
    workspaceId: string,
    campaignId: string
  ): Promise<CampaignPaidWorkApplicationRecord>;
  get(
    workspaceId: string,
    campaignId: string
  ): Promise<CampaignPaidWorkApplicationRecord>;
};

export class CampaignPaidWorkApplication {
  constructor(
    private readonly lifecycle: LifecyclePort,
    private readonly planApproval: CampaignPlanApprovalPort
  ) {}

  async start(input: {
    actorId: string;
    firstWork: ComposerSubmissionBody;
    secondWorkIntent: string;
    workspaceId: string;
  }) {
    const campaignId = `campaign-${fingerprintValue({
      idempotencyKey: input.firstWork.idempotencyKey,
      workspaceId: input.workspaceId,
    }).slice(0, 32)}`;
    const base = {
      ...input.firstWork,
      actorId: input.actorId,
      workspaceId: input.workspaceId,
    } as ComposerSubmissionRequest;
    const campaignPlanRef = { id: `${campaignId}:plan`, revision: 1 };
    const submissions: [ComposerSubmissionRequest, ComposerSubmissionRequest] = [
      base,
      {
        ...base,
        idempotencyKey: `${input.firstWork.idempotencyKey}:campaign:2`,
        intent: input.secondWorkIntent,
      },
    ];
    const planApproval = await this.planApproval.ensure({
      actorId: input.actorId,
      campaignId,
      campaignPlanRef,
      quoteRef: input.firstWork.quote,
      snapshotHash: fingerprintValue({ campaignPlanRef, submissions }),
      workspaceId: input.workspaceId,
    });
    const record = await this.lifecycle.start({
      campaignId,
      campaignPlanRef,
      planApprovalRequestId: planApproval.requestId,
      submissions,
      workspaceId: input.workspaceId,
    });
    return projectCampaign(record, planApproval);
  }

  async advance(workspaceId: string, campaignId: string) {
    const record = await this.lifecycle.advance(workspaceId, campaignId);
    return projectCampaign(
      record,
      await this.planApproval.read(workspaceId, record.planApprovalRequestId)
    );
  }

  async get(workspaceId: string, campaignId: string) {
    const record = await this.lifecycle.get(workspaceId, campaignId);
    return projectCampaign(
      record,
      await this.planApproval.read(workspaceId, record.planApprovalRequestId)
    );
  }
}

function projectCampaign(
  record: CampaignPaidWorkApplicationRecord,
  planApproval: CampaignPlanApprovalProjection
) {
  return {
    campaignId: record.campaignId,
    campaignPlanRef: record.campaignPlanRef,
    planApproval,
    works: ([1, 2] as const).map((workOrdinal) => {
      const result = record.results[workOrdinal - 1];
      return result
        ? { approvalScope: 'single_work' as const, workOrdinal, ...result }
        : {
            approvalScope: 'single_work' as const,
            state:
              workOrdinal === 1 && planApproval.status !== 'confirmed'
                ? ('awaiting_plan_confirmation' as const)
                : workOrdinal === 1
                  ? ('creating' as const)
                  : ('scheduled' as const),
            workOrdinal,
          };
    }),
  };
}
