/**
 * Execution confirmation domain service (V31-11 / V3.1 §14.3 / U7 / U8).
 *
 * createRequest: same logical transaction =
 *   balance check + credit reservation (FEFO consume) + persist pending request
 *   under the workspace merchant-credit lock.
 *
 * decide: append immutable PlanConfirmationDecision; reject/timeout refund full
 * hold back to original lots (billing §4.1).
 *
 * hold expiry: cancel + refund + plain-language merchant message (D-153).
 */

import { isDeepStrictEqual } from 'node:util';

import {
  agentExecutionConfirmationRequestSchema,
  planConfirmationDecisionSchema,
  type AgentExecutionConfirmationRequest,
  type AgentRevisionRef,
  type ConfirmationApprovalScope,
  type PlanConfirmationDecision,
} from '@meiye/contracts';

import type {
  CreditBalanceProjection,
  CreditLotTransaction,
} from '../credit-billing/credit-ledger.js';
import {
  projectConfirmationCard,
  projectHoldExpiredMessage,
  projectRejectRefundMessage,
  type ConfirmationCardProjection,
} from './execution-confirmation-projection.js';
import {
  ExecutionConfirmationError,
  type ConfirmationTransactionClient,
  type ConfirmationRequestProjectionFacts,
  type ExecutionConfirmationRequestStore,
  type PlanConfirmationDecisionStore,
  type StoredConfirmationRequest,
} from './execution-confirmation-store.js';

/** Credit ledger surface required by confirmation create/decide/expire. */
export type ConfirmationCreditTransactionPort = {
  project(
    workspaceId: string,
    asOf?: string,
  ): Promise<CreditBalanceProjection> | CreditBalanceProjection;
  consume(input: {
    workspaceId: string;
    credits: number;
    transactionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): Promise<readonly CreditLotTransaction[]> | readonly CreditLotTransaction[];
  refundUsageOperation(input: {
    workspaceId: string;
    usageOperationId: string;
    refundOperationId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }):
    | Promise<readonly CreditLotTransaction[]>
    | readonly CreditLotTransaction[];
  transactionClient: ConfirmationTransactionClient;
};

export type ConfirmationCreditLedgerPort = {
  withWorkspaceCreditTransaction<T>(
    workspaceId: string,
    action: (ledger: ConfirmationCreditTransactionPort) => Promise<T>,
  ): Promise<T>;
};

export type CreateExecutionConfirmationInput = {
  requestId: string;
  workspaceId: string;
  planId: string;
  planRevision: number;
  snapshotHash: string;
  quoteRef: AgentRevisionRef;
  reservationIdempotencyKey: string;
  createdAt: string;
  holdExpiresAt: string;
  actorId: string;
  /**
   * Billing-domain quote cost (never invented). plan_only may pass 0.
   * single_work / paid path must be a positive integer.
   */
  creditCost: number;
  failureRefundsCredits: boolean;
  rightsSummary?: string | null;
  factSummary?: string | null;
  campaignPlanRef?: AgentRevisionRef;
  workOrdinal?: number;
  approvalScope?: ConfirmationApprovalScope;
};

export type DecideExecutionConfirmationInput = {
  decisionId: string;
  requestId: string;
  workspaceId: string;
  actorId: string;
  decision: 'confirmed' | 'rejected';
  decidedAt: string;
};

export type ExpireExecutionConfirmationInput = {
  requestId: string;
  workspaceId: string;
  actorId?: string;
  now: string;
};

export type CreateExecutionConfirmationResult = {
  stored: StoredConfirmationRequest;
  card: ConfirmationCardProjection;
  reservedCredits: number;
};

export type DecideExecutionConfirmationResult = {
  decision: PlanConfirmationDecision;
  request: AgentExecutionConfirmationRequest;
  merchantMessage: string | null;
  refundedCredits: number;
};

export type ExpireExecutionConfirmationResult = {
  request: AgentExecutionConfirmationRequest;
  merchantMessage: string;
  refundedCredits: number;
};

export class ExecutionConfirmationService {
  constructor(
    private readonly requests: ExecutionConfirmationRequestStore,
    private readonly decisions: PlanConfirmationDecisionStore,
    private readonly credits: ConfirmationCreditLedgerPort,
  ) {
    if (typeof credits.withWorkspaceCreditTransaction !== 'function') {
      throw new Error('Execution confirmation requires a workspace transaction port.');
    }
  }

  /**
   * Create pending request with pre-confirm reserve (U8=A).
   * plan_only: no credit consume (schedule approval only).
   * single_work / default paid: balance check + FEFO consume under workspace lock.
   */
  async createRequest(
    input: CreateExecutionConfirmationInput,
  ): Promise<CreateExecutionConfirmationResult> {
    const approvalScope = input.approvalScope;
    const requiresReserve =
      approvalScope !== 'plan_only' &&
      Number.isSafeInteger(input.creditCost) &&
      input.creditCost > 0;

    if (approvalScope !== 'plan_only') {
      if (!Number.isSafeInteger(input.creditCost) || input.creditCost <= 0) {
        throw new ExecutionConfirmationError(
          'INVALID_STATE',
          'Paid confirmation requires a positive creditCost from the billing domain.',
        );
      }
    }

    const request = agentExecutionConfirmationRequestSchema.parse({
      schemaVersion: 'agent-execution-confirmation-request/v1',
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      planId: input.planId,
      planRevision: input.planRevision,
      snapshotHash: input.snapshotHash,
      quoteRef: input.quoteRef,
      reservationIdempotencyKey: input.reservationIdempotencyKey,
      createdAt: input.createdAt,
      holdExpiresAt: input.holdExpiresAt,
      status: 'pending',
      ...(input.campaignPlanRef
        ? { campaignPlanRef: input.campaignPlanRef }
        : {}),
      ...(input.workOrdinal !== undefined
        ? { workOrdinal: input.workOrdinal }
        : {}),
      ...(input.approvalScope ? { approvalScope: input.approvalScope } : {}),
    });
    const projection: ConfirmationRequestProjectionFacts = {
      reservedCredits: requiresReserve ? input.creditCost : 0,
      failureRefundsCredits: input.failureRefundsCredits,
      rightsSummary: input.rightsSummary?.trim() || null,
      factSummary: input.factSummary?.trim() || null,
    };

    const run = async (ledger: ConfirmationCreditTransactionPort) => {
      // Idempotent re-entry on same requestId before reserve side-effects.
      const existing = await this.getRequestById(
        input.requestId,
        ledger.transactionClient,
      );
      if (existing) {
        if (existing.request.workspaceId !== input.workspaceId) {
          throw new ExecutionConfirmationError(
            'NOT_FOUND',
            `Confirmation request ${input.requestId} was not found.`,
          );
        }
        if (
          !isDeepStrictEqual(
            { ...existing.request, status: 'pending' },
            request,
          ) ||
          !isDeepStrictEqual(existing.projection, projection)
        ) {
          throw new ExecutionConfirmationError(
            'IDEMPOTENCY_CONFLICT',
            `Confirmation request ${input.requestId} already exists with different facts.`,
          );
        }
        const balance = await ledger.project(input.workspaceId, input.createdAt);
        return {
          stored: existing,
          card: projectConfirmationCard({
            reservedCredits: existing.projection.reservedCredits,
            failureRefundsCredits: existing.projection.failureRefundsCredits,
            availableCredits: balance.availableCredits,
            rightsSummary: existing.projection.rightsSummary,
            factSummary: existing.projection.factSummary,
            approvalScope: existing.request.approvalScope ?? null,
          }),
          reservedCredits: existing.projection.reservedCredits,
        };
      }

      if (
        input.approvalScope === 'single_work' &&
        input.campaignPlanRef &&
        input.workOrdinal !== undefined
      ) {
        const prior = await this.findCampaignWork(
          {
            workspaceId: input.workspaceId,
            campaignPlanId: input.campaignPlanRef.id,
            workOrdinal: input.workOrdinal,
          },
          ledger.transactionClient,
        );
        if (prior && prior.request.requestId !== input.requestId) {
          // U7: second paid Work must create its own request — different ordinal
          // is fine; same ordinal with different request is conflict.
          throw new ExecutionConfirmationError(
            'CAMPAIGN_WORK_ALREADY_OPEN',
            `Campaign work ordinal ${input.workOrdinal} already has confirmation ${prior.request.requestId}.`,
          );
        }
      }

      if (requiresReserve) {
        const balance = await ledger.project(input.workspaceId, input.createdAt);
        if (balance.availableCredits < input.creditCost) {
          throw new ExecutionConfirmationError(
            'INSUFFICIENT_CREDITS',
            `Insufficient credits: need ${input.creditCost}, available ${balance.availableCredits}.`,
          );
        }
        await ledger.consume({
          workspaceId: input.workspaceId,
          credits: input.creditCost,
          transactionId: input.reservationIdempotencyKey,
          actorId: input.actorId,
          correlationId: `confirmation:${input.requestId}`,
          createdAt: input.createdAt,
        });
      }

      let stored: StoredConfirmationRequest;
      try {
        stored = await this.requests.savePendingInTransaction(
          ledger.transactionClient,
          { request, projection },
        );
      } catch (error) {
        if (ledger.transactionClient === null && projection.reservedCredits > 0) {
          await ledger.refundUsageOperation({
            workspaceId: input.workspaceId,
            usageOperationId: input.reservationIdempotencyKey,
            refundOperationId: `confirmation-refund-orphan:${input.requestId}`,
            actorId: input.actorId,
            correlationId: `confirmation:${input.requestId}`,
            createdAt: input.createdAt,
          });
        }
        throw error;
      }
      const after = await ledger.project(input.workspaceId, input.createdAt);
      return {
        stored,
        card: projectConfirmationCard({
          reservedCredits: stored.projection.reservedCredits,
          failureRefundsCredits: stored.projection.failureRefundsCredits,
          availableCredits: after.availableCredits,
          rightsSummary: stored.projection.rightsSummary,
          factSummary: stored.projection.factSummary,
          approvalScope: stored.request.approvalScope ?? null,
        }),
        reservedCredits: stored.projection.reservedCredits,
      };
    };

    return this.credits.withWorkspaceCreditTransaction(input.workspaceId, run);
  }

  async decide(
    input: DecideExecutionConfirmationInput,
  ): Promise<DecideExecutionConfirmationResult> {
    return this.decideForWorkspace(input);
  }

  async decideForWorkspace(
    input: DecideExecutionConfirmationInput,
  ): Promise<DecideExecutionConfirmationResult> {
    const run = (ledger: ConfirmationCreditTransactionPort) =>
      this.completeDecision(input, ledger);
    return this.credits.withWorkspaceCreditTransaction(input.workspaceId, run);
  }

  private async completeDecision(
    input: DecideExecutionConfirmationInput,
    ledger: ConfirmationCreditTransactionPort,
  ): Promise<DecideExecutionConfirmationResult> {
    const stored = await this.getOwnedRequest(
      input.workspaceId,
      input.requestId,
      ledger.transactionClient,
      true,
    );
    if (!stored) {
      throw new ExecutionConfirmationError(
        'NOT_FOUND',
        `Confirmation request ${input.requestId} was not found.`,
      );
    }
    if (stored.request.status === 'expired') {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `Confirmation request ${input.requestId} already expired.`,
      );
    }

    const candidate = planConfirmationDecisionSchema.parse({
      schemaVersion: 'plan-confirmation-decision/v1',
      decisionId: input.decisionId,
      requestId: input.requestId,
      actorId: input.actorId,
      decision: input.decision,
      decidedAt: input.decidedAt,
    });

    const prior = await this.getDecisionById(
      input.decisionId,
      ledger.transactionClient,
    );
    if (
      prior &&
      (prior.requestId !== candidate.requestId ||
        prior.actorId !== candidate.actorId ||
        prior.decision !== candidate.decision)
    ) {
      throw new ExecutionConfirmationError(
        'DECISION_IMMUTABLE',
        `PlanConfirmationDecision ${input.decisionId} is immutable.`,
      );
    }
    const appended = await this.appendDecision(
      prior ?? candidate,
      ledger.transactionClient,
    );
    if (stored.request.status === 'pending') {
      await this.markOwnedStatus(
        {
          workspaceId: input.workspaceId,
          requestId: input.requestId,
          status: 'decided',
          expectedStatus: 'pending',
        },
        ledger.transactionClient,
      );
    }

    let refundedCredits = 0;
    let merchantMessage: string | null = null;
    if (appended.decision === 'rejected') {
      refundedCredits = await this.refundHold(
        {
          workspaceId: stored.request.workspaceId,
          reservationIdempotencyKey: stored.request.reservationIdempotencyKey,
          requestId: stored.request.requestId,
          actorId: input.actorId,
          createdAt: appended.decidedAt,
          reservedCredits: stored.projection.reservedCredits,
        },
        ledger,
      );
      merchantMessage = projectRejectRefundMessage(refundedCredits);
    }

    const updated = await this.getOwnedRequest(
      input.workspaceId,
      input.requestId,
      ledger.transactionClient,
    );
    return {
      decision: appended,
      request: updated?.request ?? { ...stored.request, status: 'decided' },
      merchantMessage,
      refundedCredits,
    };
  }

  /**
   * Durable hold-expiry seam: cancel pending request + full refund + plain copy.
   * Safe to call from DBOS after holdExpiresAt (D-153).
   */
  async expireHold(
    input: ExpireExecutionConfirmationInput,
  ): Promise<ExpireExecutionConfirmationResult> {
    return this.expireForWorkspace(input);
  }

  async expireForWorkspace(
    input: ExpireExecutionConfirmationInput,
  ): Promise<ExpireExecutionConfirmationResult> {
    const run = (ledger: ConfirmationCreditTransactionPort) =>
      this.completeExpiry(input, ledger);
    return this.credits.withWorkspaceCreditTransaction(input.workspaceId, run);
  }

  private async completeExpiry(
    input: ExpireExecutionConfirmationInput,
    ledger: ConfirmationCreditTransactionPort,
  ): Promise<ExpireExecutionConfirmationResult> {
    const stored = await this.getOwnedRequest(
      input.workspaceId,
      input.requestId,
      ledger.transactionClient,
      true,
    );
    if (!stored) {
      throw new ExecutionConfirmationError(
        'NOT_FOUND',
        `Confirmation request ${input.requestId} was not found.`,
      );
    }
    if (stored.request.status === 'decided') {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `Confirmation request ${input.requestId} already decided; cannot expire.`,
      );
    }
    if (
      stored.request.status !== 'expired' &&
      Date.parse(input.now) < Date.parse(stored.request.holdExpiresAt)
    ) {
      throw new ExecutionConfirmationError(
        'HOLD_NOT_EXPIRED',
        `Confirmation request ${input.requestId} hold has not expired yet.`,
      );
    }

    const actorId = input.actorId ?? 'system';
    const refundedCredits = await this.refundHold(
      {
        workspaceId: stored.request.workspaceId,
        reservationIdempotencyKey: stored.request.reservationIdempotencyKey,
        requestId: stored.request.requestId,
        actorId,
        createdAt: input.now,
        reservedCredits: stored.projection.reservedCredits,
      },
      ledger,
    );
    if (stored.request.status === 'pending') {
      await this.markOwnedStatus(
        {
          workspaceId: input.workspaceId,
          requestId: input.requestId,
          status: 'expired',
          expectedStatus: 'pending',
        },
        ledger.transactionClient,
      );
    }
    const updated = await this.getOwnedRequest(
      input.workspaceId,
      input.requestId,
      ledger.transactionClient,
    );
    return {
      request: updated?.request ?? { ...stored.request, status: 'expired' },
      merchantMessage: projectHoldExpiredMessage(refundedCredits),
      refundedCredits,
    };
  }

  async getRequest(
    requestId: string,
  ): Promise<StoredConfirmationRequest | null> {
    return this.requests.getById(requestId);
  }

  /**
   * Read projection for the confirmation-card HTTP surface (V31-11 wiring):
   * pending confirmation requests for one workspace.
   */
  async listPendingByWorkspace(
    workspaceId: string,
  ): Promise<StoredConfirmationRequest[]> {
    return this.requests.listPendingByWorkspace(workspaceId);
  }

  async expireDueHolds(input: {
    now: string;
    limit?: number;
  }): Promise<{ expiredRequestIds: string[] }> {
    const due = await this.requests.listDuePending(input.now, input.limit);
    const expiredRequestIds: string[] = [];
    for (const stored of due) {
      await this.expireForWorkspace({
        requestId: stored.request.requestId,
        workspaceId: stored.request.workspaceId,
        actorId: 'system:confirmation-expiry-sweeper',
        now: input.now,
      });
      expiredRequestIds.push(stored.request.requestId);
    }
    return { expiredRequestIds };
  }

  async getDecision(
    requestId: string,
  ): Promise<PlanConfirmationDecision | null> {
    return this.decisions.getByRequestId(requestId);
  }

  async getDecisionForWorkspace(
    workspaceId: string,
    requestId: string,
  ): Promise<PlanConfirmationDecision | null> {
    const stored = await this.requests.getById(requestId);
    return stored?.request.workspaceId === workspaceId
      ? this.decisions.getByRequestId(requestId)
      : null;
  }

  /**
   * U7 constructive check: two paid works under one campaign need two requests.
   */
  async assertCampaignWorkNeedsOwnConfirmation(input: {
    workspaceId: string;
    campaignPlanId: string;
    workOrdinal: number;
    existingRequestId?: string;
  }): Promise<{ requiresNewConfirmation: true } | { existingRequestId: string }> {
    const found = await this.requests.findCampaignWork({
      workspaceId: input.workspaceId,
      campaignPlanId: input.campaignPlanId,
      workOrdinal: input.workOrdinal,
    });
    if (!found) {
      return { requiresNewConfirmation: true };
    }
    if (
      input.existingRequestId &&
      found.request.requestId === input.existingRequestId
    ) {
      return { existingRequestId: found.request.requestId };
    }
    if (found.request.status === 'pending') {
      return { existingRequestId: found.request.requestId };
    }
    // Prior decided/expired work still needs a fresh request for a new cycle —
    // callers create a new requestId. Presence of a terminal row does not block.
    return { requiresNewConfirmation: true };
  }

  private async refundHold(
    input: {
      workspaceId: string;
      reservationIdempotencyKey: string;
      requestId: string;
      actorId: string;
      createdAt: string;
      reservedCredits: number;
    },
    ledger: ConfirmationCreditTransactionPort,
  ): Promise<number> {
    if (input.reservedCredits <= 0) return 0;
    const refunds = await ledger.refundUsageOperation({
      workspaceId: input.workspaceId,
      usageOperationId: input.reservationIdempotencyKey,
      refundOperationId: `confirmation-refund:${input.requestId}`,
      actorId: input.actorId,
      correlationId: `confirmation:${input.requestId}`,
      createdAt: input.createdAt,
    });
    return refunds
      .filter((row) => row.credited)
      .reduce((sum, row) => sum + row.credits, 0);
  }

  private async getOwnedRequest(
    workspaceId: string,
    requestId: string,
    client: ConfirmationTransactionClient,
    forUpdate = false,
  ): Promise<StoredConfirmationRequest | null> {
    return this.requests.getOwnedInTransaction(
      client,
      workspaceId,
      requestId,
      forUpdate,
    );
  }

  private async getRequestById(
    requestId: string,
    client: ConfirmationTransactionClient,
  ): Promise<StoredConfirmationRequest | null> {
    return this.requests.getByIdInTransaction(client, requestId);
  }

  private async findCampaignWork(
    input: {
      workspaceId: string;
      campaignPlanId: string;
      workOrdinal: number;
    },
    client: ConfirmationTransactionClient,
  ): Promise<StoredConfirmationRequest | null> {
    return this.requests.findCampaignWorkInTransaction(client, input);
  }

  private async appendDecision(
    decision: PlanConfirmationDecision,
    client: ConfirmationTransactionClient,
  ): Promise<PlanConfirmationDecision> {
    return this.decisions.appendInTransaction(client, decision);
  }

  private async getDecisionById(
    decisionId: string,
    client: ConfirmationTransactionClient,
  ): Promise<PlanConfirmationDecision | null> {
    return this.decisions.getByIdInTransaction(client, decisionId);
  }

  private async markOwnedStatus(
    input: {
      workspaceId: string;
      requestId: string;
      status: 'decided' | 'expired';
      expectedStatus?: 'pending';
    },
    client: ConfirmationTransactionClient,
  ): Promise<StoredConfirmationRequest | null> {
    return this.requests.markOwnedStatusInTransaction(client, input);
  }
}

/**
 * Adapter: MemoryCreditLedger (sync methods) → ConfirmationCreditLedgerPort.
 */
export function confirmationCreditPortFromMemoryLedger(ledger: {
  project(
    workspaceId: string,
    asOf?: string,
  ): CreditBalanceProjection;
  consume(input: {
    workspaceId: string;
    credits: number;
    transactionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): readonly CreditLotTransaction[];
  refundUsageOperation(input: {
    workspaceId: string;
    usageOperationId: string;
    refundOperationId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): readonly CreditLotTransaction[];
}): ConfirmationCreditLedgerPort {
  // Serialize operations to approximate the workspace lock for unit tests (A3).
  let tail: Promise<unknown> = Promise.resolve();
  const serialize = async <T>(action: () => T | Promise<T>): Promise<T> => {
    const run = tail.then(action, action);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return {
    withWorkspaceCreditTransaction: async (_workspaceId, action) =>
      serialize(() => action({
        transactionClient: null,
        project: (workspaceId, asOf) => ledger.project(workspaceId, asOf),
        consume: (input) => ledger.consume(input),
        refundUsageOperation: (input) => ledger.refundUsageOperation(input),
      })),
  };
}
