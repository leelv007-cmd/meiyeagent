import { createHash } from 'node:crypto';

import type { ProductQuoteSnapshot } from '@meiye/contracts';

import { creditUsageOperationId } from '../credit-billing/credit-ledger.js';
import { executionConfirmationAuthorityRequestId } from '../harness/execution-confirmation-id.js';
export { executionConfirmationAuthorityRequestId } from '../harness/execution-confirmation-id.js';
import type {
  ConfirmationCreditTransactionPort,
  CreateExecutionConfirmationResult,
  CreateExecutionConfirmationInput,
  ExecutionConfirmationService,
} from './execution-confirmation-service.js';
import { ExecutionConfirmationError } from './execution-confirmation-store.js';
import type { ConfirmationTransactionClient } from './execution-confirmation-store.js';
import type {
  ConfirmationAuthorityStore,
  PendingConfirmationAuthority,
} from './execution-confirmation-authority-store.js';

const DEFAULT_HOLD_DURATION_MS = 48 * 60 * 60 * 1000;

export type CreateExecutionConfirmationAuthorityInput = {
  actorId: string;
  workspaceId: string;
  workflowId: string;
  /**
   * Admission already assembled this authority from its immutable pending
   * snapshot. It is intentionally only passed through here: the confirmation
   * service persists it with reserve and task admission in one transaction.
   */
  pendingAuthority?: PendingConfirmationAuthority;
  afterPendingPersisted?: CreateExecutionConfirmationInput['afterPendingPersisted'];
  /**
   * Living Plan reprice already moved the hold onto a successor usage
   * operation (`consume:plan-reprice:…`). Confirmation for the new
   * `plan-rN` attempt must replay that key. Defaulting to
   * `creditUsageOperationId(taskId)` would replay the admission 15-credit
   * consume against the successor amount and 409.
   */
  reservationIdempotencyKey?: string;
  /**
   * An expired hold may only be replaced by a newly admitted workflow. The
   * creation store derives these values from the locked predecessor row; this
   * assembler merely writes that exact immutable authority.
   */
  expiredSuccessor?: {
    requestId: string;
    predecessorRequestId: string;
    reservationIdempotencyKey: string;
    holdExpiresAt: string;
  };
  /**
   * A confirmed attempt whose authoritative price drifted is replaced by a
   * different immutable workflow. Its request id is durable and distinct from
   * both the predecessor and an expired-hold successor.
   */
  repricedConfirmedSuccessor?: {
    requestId: string;
    predecessorRequestId: string;
    reservationIdempotencyKey: string;
    holdExpiresAt: string;
  };
};

export interface ConfirmationAuthorityPlanReader
  extends Pick<ConfirmationAuthorityStore, 'getCurrentByWorkflowId'> {
  getCurrentByWorkflowId(
    workflowId: string,
  ): Promise<PendingConfirmationAuthority | null>;
}

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 40);
}

/** Stable, replay-safe authority id for the one expired-hold successor. */
export function expiredConfirmationSuccessorRequestId(
  predecessorRequestId: string,
): string {
  const root = predecessorRequestId.split(':r:')[0]!.trim();
  if (!root) throw new Error('Confirmation predecessor request id is required.');
  return `${root}:r:${digest(`${predecessorRequestId}\0expired`)}`;
}

/** Stable, replay-safe authority id for a confirmed price-drift successor. */
export function repricedConfirmationSuccessorRequestId(
  predecessorRequestId: string,
): string {
  const root = predecessorRequestId.split(':r:')[0]!.trim();
  if (!root) throw new Error('Confirmation predecessor request id is required.');
  return `${root}:r:${digest(`${predecessorRequestId}\0repriced-confirmed`)}`;
}

/** Reservation identity is new per successor attempt and never aliases old hold. */
export function confirmationSuccessorReservationIdempotencyKey(
  taskId: string,
  requestId: string,
): string {
  return `consume:confirmation:${digest(`${creditUsageOperationId(taskId)}\0${requestId}`)}`;
}

export interface ConfirmationAuthorityQuoteReader {
  getQuote(
    quoteId: string,
    workspaceId?: string,
  ): ProductQuoteSnapshot | null | Promise<ProductQuoteSnapshot | null>;
  /**
   * V31-63: resolve on the caller-owned admission transaction. A repriced
   * successor's quote is built and confirmed inside that still-open
   * transaction, so a pool read cannot see it yet.
   */
  getQuoteInTransaction?(
    client: NonNullable<ConfirmationTransactionClient>,
    quoteId: string,
    workspaceId?: string,
  ): Promise<ProductQuoteSnapshot | null>;
}

/**
 * A confirmation request belongs to one immutable Harness admission attempt.
 * Rejected or expired attempts must be replaced by a newly admitted task and
 * workflow, not by minting a `:r:` request under the old workflow id.
 */
export class ConfirmationRequiresSuccessorAdmissionError extends Error {
  readonly code = 'REQUIRES_SUCCESSOR_ADMISSION';
  readonly status = 409;

  constructor(
    readonly details: {
      workflowId: string;
      terminalRequestId?: string;
      terminalState: 'rejected' | 'expired' | 'terminal_race';
    },
  ) {
    super('当前确认已结束，请基于最新方案重新发起确认。');
    this.name = 'ConfirmationRequiresSuccessorAdmissionError';
  }
}

export class ConfirmationAuthorityAssembler {
  private readonly clock: () => Date;
  private readonly holdDurationMs: number;

  constructor(
    private readonly confirmations: Pick<
      ExecutionConfirmationService,
      'createRequest' | 'getRequest' | 'getDecision'
    > &
      Partial<Pick<ExecutionConfirmationService, 'createRequestInTransaction'>>,
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
          error.code === 'TERMINAL_CONFIRMATION_ATTEMPT'
        ) {
          throw new ConfirmationRequiresSuccessorAdmissionError({
            workflowId: input.workflowId,
            terminalState: 'terminal_race',
          });
        }
        if (
          error instanceof ExecutionConfirmationError &&
          error.code === 'AUTHORITY_ADVANCED'
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

  async createRequestInTransaction(
    input: CreateExecutionConfirmationAuthorityInput,
    ledger: ConfirmationCreditTransactionPort,
  ): Promise<CreateExecutionConfirmationResult> {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      try {
        return await this.createRequestAttempt(input, ledger);
      } catch (error) {
        if (
          error instanceof ExecutionConfirmationError &&
          error.code === 'TERMINAL_CONFIRMATION_ATTEMPT'
        ) {
          throw new ConfirmationRequiresSuccessorAdmissionError({
            workflowId: input.workflowId,
            terminalState: 'terminal_race',
          });
        }
        if (
          error instanceof ExecutionConfirmationError &&
          error.code === 'AUTHORITY_ADVANCED'
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
    ledger?: ConfirmationCreditTransactionPort,
  ): Promise<CreateExecutionConfirmationResult> {
    const plan = input.pendingAuthority
      ? structuredClone(input.pendingAuthority)
      : await this.plans.getCurrentByWorkflowId(input.workflowId);
    if (!plan || plan.workspaceId !== input.workspaceId) {
      throw new ExecutionConfirmationError(
        'NOT_FOUND',
        `Execution plan for workflow ${input.workflowId} was not found.`,
      );
    }
    // V31-63: inside a caller-owned admission transaction the frozen quote
    // may itself have been written by that transaction (repriced successor),
    // so the read must run on the same client when the reader supports it.
    const quote =
      ledger?.transactionClient && this.quotes.getQuoteInTransaction
        ? await this.quotes.getQuoteInTransaction(
            ledger.transactionClient,
            plan.quoteRef.id,
            input.workspaceId,
          )
        : await this.quotes.getQuote(plan.quoteRef.id, input.workspaceId);
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
    const explicitSuccessor =
      input.expiredSuccessor ?? input.repricedConfirmedSuccessor;
    const { baseRequestId, requestId } = explicitSuccessor
      ? {
          baseRequestId: executionConfirmationAuthorityRequestId({
            workflowId: input.workflowId,
            planRevision: plan.planRevision,
            snapshotHash: plan.snapshotHash,
          }),
          requestId: explicitSuccessor.requestId,
        }
      : await this.resolveRequestId(input.workflowId, plan);
    const existing = await this.confirmations.getRequest(requestId);
    const createdAt = existing?.request.createdAt ?? this.clock().toISOString();
    const taskId = quote.taskId?.trim();
    if (!taskId) {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `ProductQuote ${quote.quoteId} is missing its frozen billing task id.`,
      );
    }
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
    if (
      explicitSuccessor &&
      (plan.predecessorRequestId !== explicitSuccessor.predecessorRequestId ||
        requestId !==
          (input.expiredSuccessor
            ? expiredConfirmationSuccessorRequestId(
                explicitSuccessor.predecessorRequestId,
              )
            : repricedConfirmationSuccessorRequestId(
                explicitSuccessor.predecessorRequestId,
              )))
    ) {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        'Confirmation successor facts do not match its predecessor.',
      );
    }
    const suppliedReservationKey = input.reservationIdempotencyKey?.trim();
    const reservationIdempotencyKey = explicitSuccessor
      ? explicitSuccessor.reservationIdempotencyKey
      : suppliedReservationKey
        ? suppliedReservationKey
        : requestId === baseRequestId && plan.reservationAttempt !== 'successor'
          ? baseReservationId
          : `consume:confirmation:${digest(`${baseReservationId}\0${requestId}`)}`;
    const createInput: CreateExecutionConfirmationInput = {
      workflowId: input.workflowId,
      pendingAuthority: plan,
      requestId,
      workspaceId: input.workspaceId,
      planId: plan.planId,
      planRevision: plan.planRevision,
      snapshotHash: plan.snapshotHash,
      quoteRef: { id: quote.quoteId, revision: quote.revision },
      reservationIdempotencyKey,
      ...(predecessor && !explicitSuccessor
        ? {
            predecessorRequestId: predecessor.request.requestId,
            replacesReservationIdempotencyKey:
              predecessor.request.reservationIdempotencyKey,
          }
        : {}),
      createdAt,
      holdExpiresAt: explicitSuccessor?.holdExpiresAt ??
        existing?.request.holdExpiresAt ??
        new Date(Date.parse(createdAt) + this.holdDurationMs).toISOString(),
      actorId: input.actorId,
      creditCost: quote.creditCost!,
      failureRefundsCredits: quote.failureRefundsCredits === true,
      billingTaskId: taskId,
      rightsSummary: [...plan.rightsRevisionRefs].sort().join(', ') || null,
      factSummary: [...plan.factRevisionRefs].sort().join(', ') || null,
      ...(plan.executionConfirmationContext ?? {}),
      ...(input.afterPendingPersisted
        ? { afterPendingPersisted: input.afterPendingPersisted }
        : {}),
    };
    if (ledger && !this.confirmations.createRequestInTransaction) {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        'Confirmation authority does not support a caller-owned transaction.',
      );
    }
    return ledger
      ? this.confirmations.createRequestInTransaction!(createInput, ledger)
      : this.confirmations.createRequest(createInput);
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
      if (existing.request.status === 'expired') {
        throw new ConfirmationRequiresSuccessorAdmissionError({
          workflowId,
          terminalRequestId: candidate,
          terminalState: 'expired',
        });
      }
      if (decision?.decision === 'rejected') {
        throw new ConfirmationRequiresSuccessorAdmissionError({
          workflowId,
          terminalRequestId: candidate,
          terminalState: 'rejected',
        });
      }
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `Confirmation request ${candidate} has an unsupported terminal state.`,
      );
    }
  }
}
