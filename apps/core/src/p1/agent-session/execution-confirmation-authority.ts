import type { ProductQuoteSnapshot } from '@meiye/contracts';

import { creditUsageOperationId } from '../credit-billing/credit-ledger.js';
import type { AdmittedExecutionPlanSnapshot } from '../harness/execution-plan-admission.js';
import type {
  CreateExecutionConfirmationResult,
  ExecutionConfirmationService,
} from './execution-confirmation-service.js';
import { ExecutionConfirmationError } from './execution-confirmation-store.js';

const DEFAULT_HOLD_DURATION_MS = 48 * 60 * 60 * 1000;

export type CreateExecutionConfirmationAuthorityInput = {
  actorId: string;
  workspaceId: string;
  workflowId: string;
};

export interface ConfirmationAuthorityPlanReader {
  getByWorkflowId(
    workflowId: string,
  ): Promise<AdmittedExecutionPlanSnapshot | null>;
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
      'createRequest'
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
    const admitted = await this.plans.getByWorkflowId(input.workflowId);
    if (!admitted || admitted.workspaceId !== input.workspaceId) {
      throw new ExecutionConfirmationError(
        'NOT_FOUND',
        `Execution plan for workflow ${input.workflowId} was not found.`,
      );
    }
    const plan = admitted.snapshot;
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
    const createdAt = this.clock().toISOString();
    const taskId = quote.taskId ?? input.workflowId;
    return this.confirmations.createRequest({
      requestId: `confirmation:${input.workflowId}`,
      workspaceId: input.workspaceId,
      planId: plan.planId,
      planRevision: plan.planRevision,
      snapshotHash: plan.snapshotHash,
      quoteRef: { id: quote.quoteId, revision: quote.revision },
      reservationIdempotencyKey: creditUsageOperationId(taskId),
      createdAt,
      holdExpiresAt: new Date(
        Date.parse(createdAt) + this.holdDurationMs,
      ).toISOString(),
      actorId: input.actorId,
      creditCost: quote.creditCost!,
      failureRefundsCredits: quote.failureRefundsCredits === true,
      rightsSummary: [...plan.rightsRevisionRefs].sort().join(', ') || null,
      factSummary: [...plan.factRevisionRefs].sort().join(', ') || null,
    });
  }
}
