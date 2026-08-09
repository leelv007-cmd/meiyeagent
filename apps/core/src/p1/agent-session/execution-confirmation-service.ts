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
  type ConfirmationRequestProjectionFacts,
  type ExecutionConfirmationRequestStore,
  type PlanConfirmationDecisionStore,
  type StoredConfirmationRequest,
} from './execution-confirmation-store.js';

/** Credit ledger surface required by confirmation create/decide/expire. */
export type ConfirmationCreditLedgerPort = {
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
  /**
   * Optional transactional seam for Postgres: runs the whole create path under
   * one workspace credit lock (A3). Memory implementations may omit this.
   */
  withWorkspaceCreditTransaction?<T>(
    workspaceId: string,
    action: (ledger: ConfirmationCreditLedgerPort) => Promise<T>,
  ): Promise<T>;
  /**
   * Postgres seam: the transaction client, present only while running inside
   * withWorkspaceCreditTransaction. Lets the create path insert the pending
   * request row into the same DB transaction as balance check + reservation +
   * FEFO deduction (P1-b — no "row without deduction" window).
   */
  transactionClient?: import('pg').PoolClient;
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
  actorId: string;
  decision: 'confirmed' | 'rejected';
  decidedAt: string;
};

export type ExpireExecutionConfirmationInput = {
  requestId: string;
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
  ) {}

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

    const run = async (ledger: ConfirmationCreditLedgerPort) => {
      // Idempotent re-entry on same requestId before reserve side-effects.
      const existing = await this.requests.getById(input.requestId);
      if (existing) {
        assertConfirmationRequestReplay(existing, input);
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
        const prior = await this.requests.findCampaignWork({
          workspaceId: input.workspaceId,
          campaignPlanId: input.campaignPlanRef.id,
          workOrdinal: input.workOrdinal,
        });
        if (prior && prior.request.requestId !== input.requestId) {
          // U7: second paid Work must create its own request — different ordinal
          // is fine; same ordinal with different request is conflict.
          throw new ExecutionConfirmationError(
            'CAMPAIGN_WORK_ALREADY_OPEN',
            `Campaign work ordinal ${input.workOrdinal} already has confirmation ${prior.request.requestId}.`,
          );
        }
      }

      let reservedCredits = 0;
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
        reservedCredits = input.creditCost;
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
        reservedCredits,
        failureRefundsCredits: input.failureRefundsCredits,
        rightsSummary: input.rightsSummary?.trim() || null,
        factSummary: input.factSummary?.trim() || null,
      };

      let stored: StoredConfirmationRequest;
      const txClient = ledger.transactionClient;
      const txAwareStore = this.requests as ExecutionConfirmationRequestStore & {
        savePendingWithClient?(
          client: import('pg').PoolClient,
          input: StoredConfirmationRequest,
        ): Promise<StoredConfirmationRequest>;
      };
      try {
        stored =
          txClient && txAwareStore.savePendingWithClient
            ? await txAwareStore.savePendingWithClient(txClient, {
                request,
                projection,
              })
            : await this.requests.savePending({ request, projection });
      } catch (error) {
        // Compensate an orphan FEFO hold only on the non-transactional path:
        // inside a workspace transaction the rollback already removes the
        // reserve, and refunding on the aborted client would mask the error.
        if (!txClient && reservedCredits > 0) {
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

    if (this.credits.withWorkspaceCreditTransaction) {
      return this.credits.withWorkspaceCreditTransaction(input.workspaceId, run);
    }
    return run(this.credits);
  }

  async decide(
    input: DecideExecutionConfirmationInput,
  ): Promise<DecideExecutionConfirmationResult> {
    const stored = await this.requests.getById(input.requestId);
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

    const decision = planConfirmationDecisionSchema.parse({
      schemaVersion: 'plan-confirmation-decision/v1',
      decisionId: input.decisionId,
      requestId: input.requestId,
      actorId: input.actorId,
      decision: input.decision,
      decidedAt: input.decidedAt,
    });

    const prior = await this.decisions.getByRequestId(input.requestId);
    if (prior) {
      // Immutable: same decision facts replay; different facts fail closed.
      const appended = await this.decisions.append(decision);
      return {
        decision: appended,
        request: stored.request,
        merchantMessage:
          prior.decision === 'rejected'
            ? projectRejectRefundMessage(stored.projection.reservedCredits)
            : null,
        refundedCredits: prior.decision === 'rejected'
          ? stored.projection.reservedCredits
          : 0,
      };
    }

    await this.decisions.append(decision);
    await this.requests.markStatus({
      requestId: input.requestId,
      status: 'decided',
      expectedStatus: 'pending',
    });

    let refundedCredits = 0;
    let merchantMessage: string | null = null;
    if (input.decision === 'rejected') {
      refundedCredits = await this.refundHold({
        workspaceId: stored.request.workspaceId,
        reservationIdempotencyKey: stored.request.reservationIdempotencyKey,
        requestId: stored.request.requestId,
        actorId: input.actorId,
        createdAt: input.decidedAt,
        reservedCredits: stored.projection.reservedCredits,
      });
      merchantMessage = projectRejectRefundMessage(refundedCredits);
    }

    const updated = await this.requests.getById(input.requestId);
    return {
      decision,
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
    const stored = await this.requests.getById(input.requestId);
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
    if (stored.request.status === 'expired') {
      return {
        request: stored.request,
        merchantMessage: projectHoldExpiredMessage(
          stored.projection.reservedCredits,
        ),
        refundedCredits: stored.projection.reservedCredits,
      };
    }

    if (Date.parse(input.now) < Date.parse(stored.request.holdExpiresAt)) {
      throw new ExecutionConfirmationError(
        'HOLD_NOT_EXPIRED',
        `Confirmation request ${input.requestId} hold has not expired yet.`,
      );
    }

    const actorId = input.actorId ?? 'system';
    const refundedCredits = await this.refundHold({
      workspaceId: stored.request.workspaceId,
      reservationIdempotencyKey: stored.request.reservationIdempotencyKey,
      requestId: stored.request.requestId,
      actorId,
      createdAt: input.now,
      reservedCredits: stored.projection.reservedCredits,
    });
    await this.requests.markStatus({
      requestId: input.requestId,
      status: 'expired',
      expectedStatus: 'pending',
    });
    const updated = await this.requests.getById(input.requestId);
    return {
      request: updated?.request ?? { ...stored.request, status: 'expired' },
      merchantMessage: projectHoldExpiredMessage(refundedCredits),
      refundedCredits,
    };
  }

  /** Reprice successor: terminally release a stale pending attempt before a new request. */
  async supersedePending(input: {
    requestId: string;
    actorId: string;
    now: string;
  }): Promise<void> {
    const stored = await this.requests.getById(input.requestId);
    if (!stored || stored.request.status === 'expired') return;
    if (stored.request.status !== 'pending') {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `Confirmation request ${input.requestId} is not pending and cannot be superseded.`,
      );
    }
    await this.refundHold({
      workspaceId: stored.request.workspaceId,
      reservationIdempotencyKey: stored.request.reservationIdempotencyKey,
      requestId: stored.request.requestId,
      actorId: input.actorId,
      createdAt: input.now,
      reservedCredits: stored.projection.reservedCredits,
    });
    await this.requests.markStatus({
      requestId: input.requestId,
      status: 'expired',
      expectedStatus: 'pending',
    });
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

  async getDecision(
    requestId: string,
  ): Promise<PlanConfirmationDecision | null> {
    return this.decisions.getByRequestId(requestId);
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

  private async refundHold(input: {
    workspaceId: string;
    reservationIdempotencyKey: string;
    requestId: string;
    actorId: string;
    createdAt: string;
    reservedCredits: number;
  }): Promise<number> {
    if (input.reservedCredits <= 0) return 0;
    const refunds = await this.credits.refundUsageOperation({
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
}

function assertConfirmationRequestReplay(
  existing: StoredConfirmationRequest,
  input: CreateExecutionConfirmationInput,
) {
  const request = existing.request;
  const same =
    request.workspaceId === input.workspaceId &&
    request.planId === input.planId &&
    request.planRevision === input.planRevision &&
    request.snapshotHash === input.snapshotHash &&
    request.quoteRef.id === input.quoteRef.id &&
    String(request.quoteRef.revision) === String(input.quoteRef.revision) &&
    request.reservationIdempotencyKey === input.reservationIdempotencyKey &&
    request.approvalScope === input.approvalScope &&
    request.workOrdinal === input.workOrdinal &&
    request.campaignPlanRef?.id === input.campaignPlanRef?.id &&
    String(request.campaignPlanRef?.revision ?? '') ===
      String(input.campaignPlanRef?.revision ?? '') &&
    existing.projection.reservedCredits === input.creditCost &&
    existing.projection.failureRefundsCredits === input.failureRefundsCredits &&
    existing.projection.rightsSummary === (input.rightsSummary?.trim() || null) &&
    existing.projection.factSummary === (input.factSummary?.trim() || null);
  if (!same) {
    throw new ExecutionConfirmationError(
      'IDEMPOTENCY_CONFLICT',
      `Confirmation request ${input.requestId} was reused with different immutable authority.`,
    );
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
    project: (workspaceId, asOf) => ledger.project(workspaceId, asOf),
    consume: (input) => serialize(() => ledger.consume(input)),
    refundUsageOperation: (input) =>
      serialize(() => ledger.refundUsageOperation(input)),
    withWorkspaceCreditTransaction: async (_workspaceId, action) =>
      serialize(() => action({
        project: (workspaceId, asOf) => ledger.project(workspaceId, asOf),
        consume: (input) => ledger.consume(input),
        refundUsageOperation: (input) => ledger.refundUsageOperation(input),
      })),
  };
}
