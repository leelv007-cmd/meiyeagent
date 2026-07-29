import type {
  ProductBillingMode,
  ProductQuoteSnapshot,
  ProductUsageRecord,
  ProviderFailoverBillingEvent,
  TrustedUsageEvidenceKind,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import {
  productUsageUnitsForQuote,
  type ProductQuoteService,
  type TrustedUsageEvidence,
} from './quote-service.js';

export type BillingResource = NonNullable<ProductUsageRecord['resource']>;

export interface BillingAttemptCost {
  /** Supplier-side metering mode; independent from merchant ProductUsage. */
  billingMode?: ProductBillingMode;
  supplierPriceRevision: string;
  unitPriceMicros: number;
  currency: string;
  unit: string;
  estimatedCostMicros?: number | null;
  observedCostMicros?: number | null;
  usageQuantity?: number;
  usageUnit?: string;
  evidence?: string;
  evidenceKind?: TrustedUsageEvidenceKind | 'estimated' | 'unknown';
  payer?: 'platform' | 'workspace_byok';
  failover?: ProviderFailoverBillingEvent;
}

export function providerBillingMode(
  cost: BillingAttemptCost,
  fallback: ProductBillingMode,
): ProductBillingMode {
  if (cost.billingMode) return cost.billingMode;
  return /second/iu.test(cost.unit) ? 'per_output_second' : fallback;
}

export interface BillingLifecyclePort {
  assertAcceptedQuote?(input: {
    workspaceId: string;
    taskId: string;
    quoteId: string;
    quoteRevision: string;
  }): ProductQuoteSnapshot | Promise<ProductQuoteSnapshot>;
  beforeSubmit(input: {
    workspaceId: string;
    taskId: string;
    quoteId?: string;
    quoteRevision: string;
    resource: BillingResource;
  }): void | Promise<void>;
  dispatchAttempt(input: {
    workspaceId: string;
    taskId: string;
    attemptId: string;
    deploymentId: string;
    providerCost: BillingAttemptCost;
  }): void | Promise<void>;
  settleTask(input: {
    workspaceId: string;
    taskId: string;
    attemptId: string;
    deploymentId: string;
    status: 'completed' | 'failed';
    providerCost?: BillingAttemptCost;
    trustedUsage?: TrustedUsageEvidence;
  }): void | Promise<void>;
}

/**
 * Production lifecycle adapter for the canonical ProductQuote/ProductUsage and
 * attempt-level ProviderCost ledgers. Callers supply lifecycle facts only;
 * pricing and settlement rules remain owned by ProductQuoteService.
 */
export class ProductBillingLifecycle implements BillingLifecyclePort {
  constructor(private readonly quotes: ProductQuoteService) {}

  assertAcceptedQuote(input: {
    workspaceId: string;
    taskId: string;
    quoteId: string;
    quoteRevision: string;
  }) {
    const quote = this.quotes.getQuote(input.quoteId);
    if (!quote) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Product quote ${input.quoteId} was not found.`,
      );
    }
    this.assertWorkspace(input.workspaceId, quote.workspaceId, quote.quoteId);
    if (quote.taskId !== input.taskId) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Product quote ${quote.quoteId} is not bound to task ${input.taskId}.`,
      );
    }
    if (quote.revision !== input.quoteRevision) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Product quote ${quote.quoteId} revision no longer matches the accepted execution contract.`,
      );
    }
    if (
      quote.lifecycleStatus !== 'confirmed' &&
      quote.lifecycleStatus !== 'reserved'
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Product quote ${quote.quoteId} is not confirmed for submission.`,
      );
    }
    return quote;
  }

  beforeSubmit(input: {
    workspaceId: string;
    taskId: string;
    quoteId?: string;
    quoteRevision: string;
    resource: BillingResource;
  }) {
    const quote = input.quoteId
      ? this.quotes.getQuote(input.quoteId)
      : this.quotes.getQuoteByTask(input.taskId);
    if (!quote) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Product quote for task ${input.taskId} was not found.`,
      );
    }
    this.assertWorkspace(input.workspaceId, quote.workspaceId, quote.quoteId);
    if (quote.revision !== input.quoteRevision) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Product quote ${quote.quoteId} revision no longer matches the accepted execution contract.`,
      );
    }
    // Confirm is an explicit user/product step; never auto-promote quoted →
    // confirmed inside reserve/submit.
    if (
      quote.lifecycleStatus !== 'confirmed' &&
      quote.lifecycleStatus !== 'reserved'
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Product quote ${quote.quoteId} is not confirmed for submission.`,
      );
    }
    if (quote.taskId !== input.taskId) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Product quote ${quote.quoteId} is not bound to task ${input.taskId}.`,
      );
    }
    this.quotes.reserve({
      quoteId: quote.quoteId,
      units: productUsageUnitsForQuote(quote, input.resource),
    });
  }

  dispatchAttempt(input: {
    workspaceId: string;
    taskId: string;
    attemptId: string;
    deploymentId: string;
    providerCost: BillingAttemptCost;
  }) {
    const quote = this.requireTaskQuote(input.workspaceId, input.taskId);
    const providerCost = {
      ...input.providerCost,
      billingMode: providerBillingMode(input.providerCost, quote.billingMode),
    } satisfies BillingAttemptCost & { billingMode: ProductBillingMode };
    const costs = this.quotes.listProviderCosts(input.taskId);
    const existing = costs.find((cost) => cost.attemptId === input.attemptId);
    if (existing || costs.length === 0) {
      this.quotes.dispatch({
        quoteId: quote.quoteId,
        attemptId: input.attemptId,
        deploymentId: input.deploymentId,
        providerCost,
      });
      return;
    }
    this.quotes.fallbackDispatch({
      quoteId: quote.quoteId,
      attemptId: input.attemptId,
      deploymentId: input.deploymentId,
      providerCost,
    });
  }

  settleTask(input: {
    workspaceId: string;
    taskId: string;
    attemptId: string;
    deploymentId: string;
    status: 'completed' | 'failed';
    providerCost?: BillingAttemptCost;
    trustedUsage?: TrustedUsageEvidence;
  }) {
    const quote = this.requireTaskQuote(input.workspaceId, input.taskId);
    if (quote.lifecycleStatus === 'settled' || quote.lifecycleStatus === 'refunded') {
      return;
    }
    if (input.providerCost) {
      this.dispatchAttempt({
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        deploymentId: input.deploymentId,
        providerCost: input.providerCost,
      });
    }
    if (input.status === 'completed') {
      this.quotes.settle({
        quoteId: quote.quoteId,
        attemptId: input.attemptId,
        ...(input.trustedUsage ? { trustedUsage: input.trustedUsage } : {}),
      });
      return;
    }
    this.quotes.failAndRefund({
      quoteId: quote.quoteId,
      ...(input.trustedUsage ? { trustedUsage: input.trustedUsage } : {}),
    });
  }

  private requireTaskQuote(workspaceId: string, taskId: string) {
    const quote = this.quotes.getQuoteByTask(taskId);
    if (!quote) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Product quote for task ${taskId} was not found.`,
      );
    }
    this.assertWorkspace(workspaceId, quote.workspaceId, quote.quoteId);
    return quote;
  }

  private assertWorkspace(
    workspaceId: string,
    quoteWorkspaceId: string | undefined,
    quoteId: string,
  ) {
    if (!quoteWorkspaceId || quoteWorkspaceId !== workspaceId) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Product quote ${quoteId} does not belong to workspace ${workspaceId}.`,
      );
    }
  }
}
