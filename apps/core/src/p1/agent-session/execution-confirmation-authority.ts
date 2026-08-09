import { createHash } from 'node:crypto';

import type { ProductQuoteSnapshot } from '@meiye/contracts';

import { creditUsageOperationId } from '../credit-billing/credit-ledger.js';
import { executionConfirmationAuthorityRequestId } from '../harness/execution-confirmation-id.js';
export { executionConfirmationAuthorityRequestId } from '../harness/execution-confirmation-id.js';
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
    for (let attempt = 0; attempt < 32; attempt += 1) {
      try {
        return await this.createRequestAttempt(input);
      } catch (error) {
        if (
          error instanceof ExecutionConfirmationError &&
          (error.code === 'TERMINAL_CONFIRMATION_ATTEMPT' ||
            error.code === 'AUTHORITY_ADVANCED')
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ExecutionConfirmationError(
      'IDEMPOTENCY_CONFLICT',
      `Confirmation authority ${input.workflowId} did not converge on a current attempt.`,
    );
  }

  private async createRequestAttempt(
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
    const predecessor = plan.predecessorRequestId
      ? await this.confirmations.getRequest(plan.predecessorRequestId)
      : null;
    if (
      plan.predecessorRequestId &&
      (!predecessor || predecessor.request.workspaceId !== input.workspaceId)
    ) {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `Confirmation predecessor ${plan.predecessorRequestId} was not found.`,
      );
    }
    const reservationIdempotencyKey =
      requestId === baseRequestId && plan.reservationAttempt !== 'successor'
        ? baseReservationId
        : `consume:confirmation:${digest(`${baseReservationId}\0${requestId}`)}`;
    return this.confirmations.createRequest({
      workflowId: input.workflowId,
      requestId,
      workspaceId: input.workspaceId,
      planId: plan.planId,
      planRevision: plan.planRevision,
      snapshotHash: plan.snapshotHash,
      quoteRef: { id: quote.quoteId, revision: quote.revision },
      reservationIdempotencyKey,
      ...(predecessor
        ? {
            predecessorRequestId: predecessor.request.requestId,
            replacesReservationIdempotencyKey:
              predecessor.request.reservationIdempotencyKey,
          }
        : {}),
      createdAt,
      holdExpiresAt:
        existing?.request.holdExpiresAt ??
        new Date(Date.parse(createdAt) + this.holdDurationMs).toISOString(),
      actorId: input.actorId,
      creditCost: quote.creditCost!,
      failureRefundsCredits: quote.failureRefundsCredits === true,
      billingTaskId: taskId,
      rightsSummary: [...plan.rightsRevisionRefs].sort().join(', ') || null,
      factSummary: [...plan.factRevisionRefs].sort().join(', ') || null,
      ...(plan.executionConfirmationContext ?? {}),
    });
  }

  private async resolveRequestId(
    workflowId: string,
    plan: PendingConfirmationAuthority,
  ): Promise<{ baseRequestId: string; requestId: string }> {
    const base = executionConfirmationAuthorityRequestId({
      workflowId,
      planRevision: plan.planRevision,
      snapshotHash: plan.snapshotHash,
    });
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
