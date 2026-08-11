import type {
  ProductQuoteSnapshot,
  ProductUsageRecord,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import {
  BillingIdentityError,
  billingIdentityReservationFingerprint,
  billingPackageAllocation,
} from '../execution-spine/billing-identity.js';
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
import type {
  HarnessCarrierSettlementCoordinator,
  ReadyWorkSettlement,
} from './carrier-settlement-coordinator.js';

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
    _creditUsageLineage?: {
      readByTask(input: { workspaceId: string; taskId: string }): Promise<{
        usageReservation: { creditUsageOperationId?: string };
      } | null>;
    },
    private readonly carrierSettlements?: HarnessCarrierSettlementCoordinator,
  ) {}

  async commit(input: HarnessBillingSettlementInput) {
    if (this.carrierSettlements) {
      const ready = await this.carrierSettlements.recordCarrierTerminal({
        action: 'commit',
        settlement: input,
      });
      if (!ready) return;
      await this.settleReadyWork(ready);
      await this.carrierSettlements.markWorkSettled(ready.aggregateKey);
      return;
    }
    await this.commitAggregate(input);
  }

  async refund(input: HarnessBillingSettlementInput) {
    if (this.carrierSettlements) {
      const ready = await this.carrierSettlements.recordCarrierTerminal({
        action: 'refund',
        settlement: input,
      });
      if (!ready) return;
      await this.settleReadyWork(ready);
      await this.carrierSettlements.markWorkSettled(ready.aggregateKey);
      return;
    }
    await this.refundAggregate(input);
  }

  /**
   * Consumes the immutable aggregate materialized by the coordinator. It must
   * never re-record a carrier receipt: a recovery worker may receive a mixed
   * commit/refund aggregate whose action differs from its canonical receipt.
   */
  async settleReadyWork(ready: ReadyWorkSettlement) {
    if (ready.action === 'commit') {
      await this.commitAggregate(ready.settlement);
    } else {
      await this.refundAggregate(ready.settlement);
    }
  }

  private async commitAggregate(input: HarnessBillingSettlementInput) {
    const quote = await this.assertQuoteRevision(input);
    assertAggregatePartialDelivery(input, quote);
    await this.billing.settleTask({
      workspaceId: input.workspaceId,
      taskId: billingTaskId(input),
      attemptId: `harness-receipt:${billingTaskId(input)}`,
      deploymentId: 'coordinator',
      status: 'completed',
      ...(input.trustedUsage ? { trustedUsage: input.trustedUsage } : {}),
      ...(input.partialDelivery
        ? { partialDelivery: input.partialDelivery }
        : {}),
      ...(input.packagePartialDelivery
        ? { packagePartialDelivery: input.packagePartialDelivery }
        : {}),
    });
    const usage = await this.requireUsage(input);
    assertActionUsageTerminal(usage, 'completed');
    await this.reconcileRefund(input, quote, usage, 'reconcile');
    await this.recordActionUsage(input, usage, 'completed');
  }

  private async refundAggregate(input: HarnessBillingSettlementInput) {
    const quote = await this.assertQuoteRevision(input);
    await this.billing.settleTask({
      workspaceId: input.workspaceId,
      taskId: billingTaskId(input),
      attemptId: `harness-receipt:${billingTaskId(input)}`,
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
    const taskId = billingTaskId(input);
    if (quote.creditCost !== undefined) {
      if (!usage.refundedCredits) return;
      if (!this.credits) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Merchant credit ledger is unavailable for a credit refund.',
        );
      }
      // R-P0-05: a credit hold key and a credit-ledger consume operation are
      // different typed authorities. Never infer one from the compatibility
      // reservation fingerprint or from its string prefix.
      const usageOperationId =
        input.creditUsageOperationId ??
        input.billingIdentity.creditUsageOperationId;
      if (!usageOperationId) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Credit refund for task ${taskId} requires the exact reservation operation id; refusing to guess one.`,
        );
      }
      await this.credits.refundUsageOperation({
        workspaceId: input.workspaceId,
        usageOperationId,
        refundOperationId: `credit-${kind}:${taskId}`,
        credits: usage.refundedCredits,
        actorId: 'system-harness',
        correlationId: `harness:${taskId}`,
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
          taskId,
          unit.resource,
          reservedUnits.length,
        ),
        refundOperationId: `product-usage-${kind}:${taskId}:${unit.resource}`,
        amount: unit.quantity,
        actorId: 'system-harness',
        correlationId: `harness:${taskId}`,
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
    // Carrier receipts produce one Work-level ProductUsage terminal state. Do
    // not attach that one ledger event to whichever carrier happened to be
    // sorted first by the receipt reducer.
    const observabilityTaskId =
      (input.billingIdentity.carrierUnitIds?.length ?? 1) > 1
        ? input.billingTaskId
        : input.taskId;
    const binding = await this.observability.context.readTaskRootAxes(
      input.workspaceId,
      observabilityTaskId,
    );
    if (!binding) {
      throw new Error('Settled task observability axes are unavailable.');
    }
    const actionUsage = projectActionUsage(
      { ...usage, taskId: observabilityTaskId },
      status,
    );
    if (!actionUsage) {
      throw new Error('Settled task usage is not terminal.');
    }
    const event = canonicalObservabilityEvent({
      taskId: observabilityTaskId,
      binding,
      eventType: 'action_usage.recorded',
      payload: actionUsage,
    });
    await this.observability.events.append(
      input.workspaceId,
      event,
      `action-usage:${observabilityTaskId}`,
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
    assertBillingIdentitySettlement(input);
    assertHarnessQuoteFacts(input, quote);
    assertHarnessSettlementLifecycle(quote);
    return quote;
  }

  private async requireUsage(
    input: HarnessBillingSettlementInput,
  ): Promise<ProductUsageRecord> {
    const taskId = billingTaskId(input);
    const usage = await this.billing.getUsage(taskId, input.workspaceId);
    if (!usage) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Product usage for task ${taskId} was not found.`,
      );
    }
    return usage;
  }
}

/**
 * R-P0-05: the settlement boundary accepts only the canonical identity frozen
 * at admission. Missing identity or any inconsistency between the identity and
 * the settlement input fails closed BEFORE any ledger mutation.
 */
function assertBillingIdentitySettlement(
  input: HarnessBillingSettlementInput,
): void {
  const identity = input.billingIdentity;
  if (!identity) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      `Settlement for task ${input.taskId} requires the canonical billing identity frozen at admission.`,
    );
  }
  if (
    identity.workspaceId !== input.workspaceId ||
    identity.workflowId !== input.taskId ||
    identity.taskId !== input.billingTaskId ||
    identity.quoteRef.id !== input.quoteId ||
    identity.quoteRef.revision !== input.quoteRevision
  ) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_MISMATCH',
      'Settlement identity no longer matches the accepted execution contract.',
    );
  }
  const suppliedCreditUsageOperationId = input.creditUsageOperationId?.trim();
  if (
    suppliedCreditUsageOperationId &&
    suppliedCreditUsageOperationId !== identity.creditUsageOperationId
  ) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_MISMATCH',
      'Caller credit usage operation does not match the frozen billing identity.',
    );
  }
  const carrierUnitId = identity.carrierUnitId?.trim();
  const carrierUnitIds = identity.carrierUnitIds?.map((value) => value.trim());
  if (
    !carrierUnitId ||
    !carrierUnitIds ||
    carrierUnitIds.length === 0 ||
    carrierUnitIds.some((value) => !value) ||
    new Set(carrierUnitIds).size !== carrierUnitIds.length ||
    !carrierUnitIds.includes(carrierUnitId) ||
    !Number.isSafeInteger(identity.carrierBillableUnits) ||
    (identity.carrierBillableUnits ?? 0) < 1
  ) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Settlement identity is missing its frozen carrier allocation.',
    );
  }
  if (identity.packageBilling) billingPackageAllocation(identity);
  billingIdentityReservationFingerprint(identity);
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

function assertPackageQuoteIdentity(
  input: HarnessBillingSettlementInput,
  quote: ProductQuoteSnapshot,
) {
  const frozen = input.billingIdentity.packageBilling;
  const quoted = quote.packageContract;
  if (!frozen && !quoted) return;
  if (!frozen || !quoted || frozen.contractHash !== quoted.contractHash) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Package quote does not match the package billing contract frozen at admission.',
    );
  }
  if (frozen.allocations.length !== quoted.allocations.length) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Package quote allocation count does not match the frozen execution contract.',
    );
  }
  const quotedById = new Map(
    quoted.allocations.map((allocation) => [allocation.allocationId, allocation]),
  );
  for (const allocation of frozen.allocations) {
    const quoteAllocation = quotedById.get(allocation.allocationId);
    if (
      !quoteAllocation ||
      quoteAllocation.carrier !== allocation.carrier ||
      quoteAllocation.deliveryUnits !== allocation.deliveryUnits ||
      quoteAllocation.creditCost !== allocation.creditCost ||
      quoteAllocation.failureRefundsCredits !== allocation.failureRefundsCredits ||
      quoteAllocation.operation !== allocation.operation ||
      quoteAllocation.catalogModel.id !== allocation.catalogModel.id ||
      quoteAllocation.catalogModel.revision !== allocation.catalogModel.revision ||
      quoteAllocation.routeSnapshotRef !== allocation.routeSnapshotRef ||
      !sameStringSet(
        quoteAllocation.rightsRevisionRefs,
        allocation.rightsRevisionRefs,
      )
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Package quote allocation does not match the frozen execution contract.',
      );
    }
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function assertHarnessQuoteFacts(
  input: HarnessBillingSettlementInput,
  quote: ProductQuoteSnapshot,
) {
  if (
    quote.taskId !== input.billingTaskId ||
    quote.workspaceId !== input.workspaceId ||
    quote.revision !== input.quoteRevision
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Product quote ${quote.quoteId} no longer matches the accepted execution contract.`,
    );
  }
  assertPackageQuoteIdentity(input, quote);
}

function assertAggregatePartialDelivery(
  input: HarnessBillingSettlementInput,
  quote: ProductQuoteSnapshot,
) {
  if (quote.packageContract) {
    if (input.partialDelivery) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Package settlement rejects a global partial delivery basis.',
      );
    }
    if (!input.packagePartialDelivery) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Package settlement requires exact allocation delivery evidence.',
      );
    }
    return;
  }
  if (input.packagePartialDelivery) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Single-carrier settlement cannot carry package delivery evidence.',
    );
  }
  const partial = input.partialDelivery;
  if (!partial) return;
  if (
    quote.creditCost !== undefined &&
    quote.outputCount !== undefined &&
    partial.totalUnits !== quote.outputCount
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Carrier allocations (${partial.totalUnits}) do not match the frozen quote output count (${quote.outputCount}).`,
    );
  }
  if (
    quote.creditCost === undefined &&
    partial.deliveredUnits < partial.totalUnits
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Partial multi-carrier settlement requires a product-unit receipt reducer.',
    );
  }
}

function billingTaskId(input: HarnessBillingSettlementInput): string {
  return input.billingTaskId;
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
