import type {
  ProductQuoteSnapshot,
  ProductUsageRecord,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import { creditUsageOperationId } from '../credit-billing/credit-ledger.js';
import type { PostgresCreditLedger } from '../credit-billing/postgres-credit-ledger.js';
import type { PostgresGrantLotLedger } from '../foundation/postgres-grant-lot.js';
import type { DurableProductBillingService } from '../product-billing/durable-service.js';
import {
  canonicalObservabilityEvent,
  type ObservabilityEventAuditPort,
  type TaskObservabilityContextPort,
} from '../creation-experience/observability-events.js';
import {
  grantLotUsageOperationId,
  refundedProductUsageUnits,
  reservedProductUsageUnits,
} from '../product-billing/product-usage-ledger.js';
import { projectActionUsage } from './action-usage.js';
import type {
  HarnessBillingSettlementExecutor,
  HarnessBillingSettlementInput,
} from './billing-compensation.js';

export class HarnessProductBillingSettlementExecutor
  implements HarnessBillingSettlementExecutor
{
  constructor(
    private readonly billing: Pick<
      DurableProductBillingService,
      'getQuote' | 'getUsage' | 'settleTask'
    >,
    private readonly grantLots?: Pick<
      PostgresGrantLotLedger,
      'refundUsageOperation'
    >,
    private readonly clock: () => Date = () => new Date(),
    private readonly observability?: {
      events: ObservabilityEventAuditPort;
      context: Pick<TaskObservabilityContextPort, 'readTaskRootAxes'>;
    },
    private readonly credits?: Pick<
      PostgresCreditLedger,
      'refundUsageOperation'
    >,
  ) {}

  async commit(input: HarnessBillingSettlementInput) {
    const quote = await this.assertQuoteRevision(input);
    await this.billing.settleTask({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: `harness-receipt:${input.taskId}`,
      deploymentId: 'coordinator',
      status: 'completed',
      ...(input.trustedUsage ? { trustedUsage: input.trustedUsage } : {}),
    });
    const usage = await this.requireUsage(input);
    assertActionUsageTerminal(usage, 'completed');
    await this.reconcileRefund(input, quote, usage, 'reconcile');
    await this.recordActionUsage(input, usage, 'completed');
  }

  async refund(input: HarnessBillingSettlementInput) {
    const quote = await this.assertQuoteRevision(input);
    await this.billing.settleTask({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: `harness-receipt:${input.taskId}`,
      deploymentId: 'coordinator',
      status: 'failed',
      ...(input.forceCreditRefund ? { forceCreditRefund: true } : {}),
    });
    const usage = await this.requireUsage(input);
    if (quote.creditCost === undefined) {
      assertActionUsageTerminal(usage, 'rejected');
    } else {
      if (usage.status !== 'refunded' && usage.status !== 'committed') {
        throw new Error(
          `Credit terminal usage ${usage.status} cannot satisfy failed settlement.`,
        );
      }
    }
    await this.reconcileRefund(input, quote, usage, 'refund');
    await this.recordActionUsage(input, usage, 'rejected');
  }

  private async reconcileRefund(
    input: HarnessBillingSettlementInput,
    quote: ProductQuoteSnapshot,
    usage: ProductUsageRecord,
    kind: 'reconcile' | 'refund',
  ) {
    if (quote.creditCost !== undefined) {
      if (!usage.refundedCredits) return;
      if (!this.credits) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Merchant credit ledger is unavailable for a credit refund.',
        );
      }
      await this.credits.refundUsageOperation({
        workspaceId: input.workspaceId,
        usageOperationId: creditUsageOperationId(input.taskId),
        refundOperationId: `credit-${kind}:${input.taskId}`,
        credits: usage.refundedCredits,
        actorId: 'system-harness',
        correlationId: `harness:${input.taskId}`,
        createdAt: this.clock().toISOString(),
      });
      return;
    }
    if (!this.grantLots) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Legacy grant-lot ledger is unavailable for a historical refund.',
      );
    }
    const reservedUnits = reservedProductUsageUnits(usage);
    for (const unit of refundedProductUsageUnits(usage)) {
      await this.grantLots.refundUsageOperation({
        workspaceId: input.workspaceId,
        usageOperationId: grantLotUsageOperationId(
          input.taskId,
          unit.resource,
          reservedUnits.length,
        ),
        refundOperationId: `product-usage-${kind}:${input.taskId}:${unit.resource}`,
        amount: unit.quantity,
        actorId: 'system-harness',
        correlationId: `harness:${input.taskId}`,
        createdAt: this.clock().toISOString(),
      });
    }
  }

  private async recordActionUsage(
    input: HarnessBillingSettlementInput,
    usage: ProductUsageRecord,
    status: 'completed' | 'rejected',
  ) {
    if (!this.observability) return;
    const binding = await this.observability.context.readTaskRootAxes(
      input.workspaceId,
      input.taskId,
    );
    if (!binding) {
      throw new Error('Settled task observability axes are unavailable.');
    }
    const actionUsage = projectActionUsage(usage, status);
    if (!actionUsage) {
      throw new Error('Settled task usage is not terminal.');
    }
    const event = canonicalObservabilityEvent({
      taskId: input.taskId,
      binding,
      eventType: 'action_usage.recorded',
      payload: actionUsage,
    });
    await this.observability.events.append(
      input.workspaceId,
      event,
      `action-usage:${input.taskId}`,
    );
  }

  private async assertQuoteRevision(input: HarnessBillingSettlementInput) {
    const quote = await this.billing.getQuote(input.quoteId, input.workspaceId);
    if (!quote) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Product quote ${input.quoteId} was not found.`,
      );
    }
    assertHarnessQuoteFacts(input, quote);
    assertHarnessSettlementLifecycle(quote);
    return quote;
  }

  private async requireUsage(
    input: HarnessBillingSettlementInput,
  ): Promise<ProductUsageRecord> {
    const usage = await this.billing.getUsage(input.taskId, input.workspaceId);
    if (!usage) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Product usage for task ${input.taskId} was not found.`,
      );
    }
    return usage;
  }
}

function actionUsageStatus(
  usage: ProductUsageRecord,
): 'completed' | 'rejected' {
  if (usage.status === 'refunded') return 'rejected';
  if (
    usage.status === 'committed' ||
    usage.status === 'partially_refunded'
  ) {
    return 'completed';
  }
  throw new Error('Settled task usage is not terminal.');
}

function assertActionUsageTerminal(
  usage: ProductUsageRecord,
  expected: 'completed' | 'rejected',
) {
  const actual = actionUsageStatus(usage);
  if (actual !== expected) {
    throw new Error(
      `Product terminal usage ${usage.status} cannot satisfy ${expected} settlement.`,
    );
  }
}

function assertHarnessQuoteFacts(
  input: HarnessBillingSettlementInput,
  quote: ProductQuoteSnapshot,
) {
  if (
    quote.taskId !== input.taskId ||
    quote.workspaceId !== input.workspaceId ||
    quote.revision !== input.quoteRevision
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Product quote ${quote.quoteId} no longer matches the accepted execution contract.`,
    );
  }
}

const HARNESS_SETTLEMENT_LIFECYCLE_STATUSES = new Set<
  ProductQuoteSnapshot['lifecycleStatus']
>(['reserved', 'dispatched', 'settled', 'refunded']);

function assertHarnessSettlementLifecycle(quote: ProductQuoteSnapshot) {
  if (!HARNESS_SETTLEMENT_LIFECYCLE_STATUSES.has(quote.lifecycleStatus)) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Product quote ${quote.quoteId} cannot settle from status ${quote.lifecycleStatus}.`,
    );
  }
}
