import type {
  ProductQuoteSnapshot,
  ProductUsageRecord,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import type { PostgresGrantLotLedger } from '../foundation/postgres-grant-lot.js';
import type { DurableProductBillingService } from '../product-billing/durable-service.js';
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
      'assertAcceptedQuote' | 'getQuote' | 'getUsage' | 'settleTask'
    >,
    private readonly grantLots: Pick<
      PostgresGrantLotLedger,
      'refundUsageOperation'
    >,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async commit(input: HarnessBillingSettlementInput) {
    await this.assertQuoteRevision(input);
    await this.billing.settleTask({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: `harness-receipt:${input.taskId}`,
      deploymentId: 'coordinator',
      status: 'completed',
      ...(input.trustedUsage ? { trustedUsage: input.trustedUsage } : {}),
    });
    const usage = await this.requireUsage(input);
    if (usage.refundedQuantity > 0) {
      await this.grantLots.refundUsageOperation({
        workspaceId: input.workspaceId,
        usageOperationId: `product-usage:${input.taskId}`,
        refundOperationId: `product-usage-reconcile:${input.taskId}`,
        amount: usage.refundedQuantity,
        actorId: 'system-harness',
        correlationId: `harness:${input.taskId}`,
        createdAt: this.clock().toISOString(),
      });
    }
  }

  async refund(input: HarnessBillingSettlementInput) {
    await this.assertQuoteRevision(input);
    await this.billing.settleTask({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: `harness-receipt:${input.taskId}`,
      deploymentId: 'coordinator',
      status: 'failed',
    });
    await this.grantLots.refundUsageOperation({
      workspaceId: input.workspaceId,
      usageOperationId: `product-usage:${input.taskId}`,
      refundOperationId: `product-usage-refund:${input.taskId}`,
      actorId: 'system-harness',
      correlationId: `harness:${input.taskId}`,
      createdAt: this.clock().toISOString(),
    });
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
    if (
      quote.lifecycleStatus !== 'settled' &&
      quote.lifecycleStatus !== 'refunded'
    ) {
      await this.billing.assertAcceptedQuote(input);
    }
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
