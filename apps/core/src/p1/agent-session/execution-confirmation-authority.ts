import { createHash } from 'node:crypto';

import type { ProductQuoteSnapshot } from '@meiye/contracts';

import { creditUsageOperationId } from '../credit-billing/credit-ledger.js';
import type {
  CreateExecutionConfirmationResult,
  ExecutionConfirmationService,
} from './execution-confirmation-service.js';
import { ExecutionConfirmationError } from './execution-confirmation-store.js';
import type {
  ConfirmationAuthorityStore,
  PendingConfirmationAuthority,
} from './execution-confirmation-authority-store.js';

const DEFAULT_HOLD_DURATION_MS = 48 * 60 * 60 * 1000;

export type CreateExecutionConfirmationAuthorityInput = {
  actorId: string;
  workspaceId: string;
  workflowId: string;
};

export interface ConfirmationAuthorityPlanReader
  extends Pick<ConfirmationAuthorityStore, 'getCurrentByWorkflowId'> {
  getCurrentByWorkflowId(
    workflowId: string,
  ): Promise<PendingConfirmationAuthority | null>;
}

export interface ConfirmationAuthorityQuoteReader {
  getQuote(
    quoteId: string,
    workspaceId?: string,
  ): ProductQuoteSnapshot | null | Promise<ProductQuoteSnapshot | null>;
}

export class ConfirmationAuthorityAssembler {
  private readonly clock: () => Date;
  private readonly holdDurationMs: number;

  constructor(
    private readonly confirmations: Pick<
      ExecutionConfirmationService,
      'createRequest' | 'getRequest' | 'getDecision'
    >,
    private readonly plans: ConfirmationAuthorityPlanReader,
    private readonly quotes: ConfirmationAuthorityQuoteReader,
    options: { clock?: () => Date; holdDurationMs?: number } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.holdDurationMs = options.holdDurationMs ?? DEFAULT_HOLD_DURATION_MS;
  }

  async createRequest(
    input: CreateExecutionConfirmationAuthorityInput,
  ): Promise<CreateExecutionConfirmationResult> {
    const plan = await this.plans.getCurrentByWorkflowId(input.workflowId);
    if (!plan || plan.workspaceId !== input.workspaceId) {
      throw new ExecutionConfirmationError(
        'NOT_FOUND',
        `Execution plan for workflow ${input.workflowId} was not found.`,
      );
    }
    const quote = await this.quotes.getQuote(
      plan.quoteRef.id,
      input.workspaceId,
    );
    if (!quote || quote.quoteId !== plan.quoteRef.id) {
      throw new ExecutionConfirmationError(
        'NOT_FOUND',
        `ProductQuote ${plan.quoteRef.id} was not found.`,
      );
    }
    if (String(quote.revision) !== String(plan.quoteRef.revision)) {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `ProductQuote ${quote.quoteId} revision is not current for the frozen plan.`,
      );
    }
    if (
      !Number.isSafeInteger(quote.creditCost) ||
      (quote.creditCost ?? 0) <= 0
    ) {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `ProductQuote ${quote.quoteId} does not contain a positive server credit cost.`,
      );
    }
    const { baseRequestId, requestId } = await this.resolveRequestId(
      input.workflowId,
      plan,
    );
    const existing = await this.confirmations.getRequest(requestId);
    const createdAt = existing?.request.createdAt ?? this.clock().toISOString();
    const taskId = quote.taskId ?? input.workflowId;
    const baseReservationId = creditUsageOperationId(taskId);
    return this.confirmations.createRequest({
      requestId,
      workspaceId: input.workspaceId,
      planId: plan.planId,
      planRevision: plan.planRevision,
      snapshotHash: plan.snapshotHash,
      quoteRef: { id: quote.quoteId, revision: quote.revision },
      reservationIdempotencyKey:
        requestId === baseRequestId
          ? baseReservationId
          : `consume:confirmation:${digest(`${baseReservationId}\0${requestId}`)}`,
      createdAt,
      holdExpiresAt:
        existing?.request.holdExpiresAt ??
        new Date(Date.parse(createdAt) + this.holdDurationMs).toISOString(),
      actorId: input.actorId,
      creditCost: quote.creditCost!,
      failureRefundsCredits: quote.failureRefundsCredits === true,
      rightsSummary: [...plan.rightsRevisionRefs].sort().join(', ') || null,
      factSummary: [...plan.factRevisionRefs].sort().join(', ') || null,
      ...(plan.executionConfirmationContext ?? {}),
    });
  }

  private async resolveRequestId(
    workflowId: string,
    plan: PendingConfirmationAuthority,
  ): Promise<{ baseRequestId: string; requestId: string }> {
    const base = `confirmation:${digest(`${workflowId}\0${plan.planRevision}\0${plan.snapshotHash}`)}`;
    let candidate = base;
    for (;;) {
      const existing = await this.confirmations.getRequest(candidate);
      if (!existing) return { baseRequestId: base, requestId: candidate };
      if (existing.request.workspaceId !== plan.workspaceId) {
        throw new ExecutionConfirmationError('NOT_FOUND', 'Workflow was not found.');
      }
      if (existing.request.status === 'pending') {
        return { baseRequestId: base, requestId: candidate };
      }
      const decision = await this.confirmations.getDecision(candidate);
      if (existing.request.status === 'decided' && !decision) {
        throw new ExecutionConfirmationError(
          'INVALID_STATE',
          `Confirmation request ${candidate} is awaiting decision reconciliation.`,
        );
      }
      if (decision?.decision === 'confirmed') {
        return { baseRequestId: base, requestId: candidate };
      }
      const terminalFact = decision?.decisionId ?? 'expired';
      candidate = `${base}:r:${digest(`${candidate}\0${terminalFact}`).slice(0, 16)}`;
    }
  }
}

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 40);
}
