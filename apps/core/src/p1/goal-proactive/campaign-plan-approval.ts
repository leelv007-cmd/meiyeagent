import type { AgentRevisionRef } from '@meiye/contracts';

import type { ConfirmationAuthorityStore } from '../agent-session/execution-confirmation-authority-store.js';
import { projectConfirmationCard } from '../agent-session/execution-confirmation-projection.js';
import type { ExecutionConfirmationService } from '../agent-session/execution-confirmation-service.js';
import type {
  CampaignPlanApprovalPort,
  CampaignPlanApprovalProjection,
} from './campaign-paid-work-application.js';
import type { CampaignPlanApprovalDecisionPort } from './campaign-paid-work-lifecycle.js';

const PLAN_HOLD_MS = 48 * 60 * 60 * 1000;

export class CampaignPlanApprovalService
  implements CampaignPlanApprovalPort, CampaignPlanApprovalDecisionPort
{
  constructor(
    private readonly confirmations: Pick<
      ExecutionConfirmationService,
      'createRequest' | 'getDecisionForWorkspace' | 'getRequest'
    >,
    private readonly authorities: Pick<ConfirmationAuthorityStore, 'putCurrent'>,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async ensure(input: {
    actorId: string;
    campaignId: string;
    campaignPlanRef: { id: string; revision: number };
    quoteRef: AgentRevisionRef;
    snapshotHash: string;
    workspaceId: string;
  }): Promise<CampaignPlanApprovalProjection> {
    const requestId = `confirmation-${input.campaignId}-plan`;
    const existing = await this.confirmations.getRequest(requestId);
    const createdAt = existing?.request.createdAt ?? this.clock().toISOString();
    await this.authorities.putCurrent({
      factRevisionRefs: [],
      frozenAt: createdAt,
      planId: input.campaignPlanRef.id,
      planRevision: input.campaignPlanRef.revision,
      quoteRef: input.quoteRef,
      rightsRevisionRefs: [],
      snapshotHash: input.snapshotHash,
      workflowId: input.campaignId,
      workspaceId: input.workspaceId,
    });
    const created = await this.confirmations.createRequest({
      actorId: input.actorId,
      approvalScope: 'plan_only',
      campaignPlanRef: input.campaignPlanRef,
      createdAt,
      creditCost: 0,
      failureRefundsCredits: false,
      holdExpiresAt:
        existing?.request.holdExpiresAt ??
        new Date(Date.parse(createdAt) + PLAN_HOLD_MS).toISOString(),
      planId: input.campaignPlanRef.id,
      planRevision: input.campaignPlanRef.revision,
      quoteRef: input.quoteRef,
      requestId,
      reservationIdempotencyKey: `reserve-${input.campaignId}-plan`,
      snapshotHash: input.snapshotHash,
      workOrdinal: 1,
      workflowId: input.campaignId,
      workspaceId: input.workspaceId,
    });
    return this.read(input.workspaceId, created.stored.request.requestId);
  }

  async read(workspaceId: string, requestId: string) {
    const stored = await this.confirmations.getRequest(requestId);
    if (!stored || stored.request.workspaceId !== workspaceId) {
      throw new Error('Campaign plan approval was not found.');
    }
    const decision = await this.confirmations.getDecisionForWorkspace(
      workspaceId,
      requestId
    );
    const card = projectConfirmationCard({
      ...stored.projection,
      approvalScope: 'plan_only',
    });
    return {
      approvalScope: 'plan_only' as const,
      planOnlyNotice: card.planOnlyNotice!,
      requestId,
      reservedCredits: 0 as const,
      status:
        decision?.decision ??
        (stored.request.status === 'expired' ? ('expired' as const) : ('pending' as const)),
    };
  }

  async isConfirmed(workspaceId: string, requestId: string) {
    return (
      (await this.confirmations.getDecisionForWorkspace(workspaceId, requestId))
        ?.decision === 'confirmed'
    );
  }
}
