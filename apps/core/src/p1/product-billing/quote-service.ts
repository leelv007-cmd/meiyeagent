/**
 * Product quote lifecycle: quote → confirm → reserve → dispatch → settle.
 *
 * Pure + in-memory service for #92 / D-088.
 * - Cap pre-auth at authorizedCeiling
 * - Trusted actual seconds settle (low refund / high no surcharge)
 * - Missing trusted usage → estimated/unknown (honest)
 * - One task one idempotent reserve/settle
 * - Fallback only within frozen candidates + confirmed ceiling
 */

import { createHash } from 'node:crypto';
import {
  applyBillableSecondsRules,
  computeProductAmount,
  type BuildProductQuoteInput,
  type ProductQuoteSnapshot,
  type ProductSettlementStatus,
  type ProductUsageRecord,
  type ProductUsageUnit,
  type ProviderCostSnapshot,
  type TrustedUsageEvidenceKind,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import {
  MemoryProductUsageLedger,
  reservedProductUsageUnits,
  type ProductUsageLedger,
} from './product-usage-ledger.js';
import {
  absorbOverproductionToSupplyCost,
  buildProviderCostSnapshot,
  isTrustedUsageEvidence,
  MemoryProviderCostSnapshotStore,
  type BuildProviderCostSnapshotInput,
} from './provider-cost-snapshot.js';

export type ConfirmQuoteInput = {
  quoteId: string;
  taskId: string;
  /** Optional explicit ceiling; defaults to confirmedAmount on the snapshot. */
  authorizedCeiling?: number;
};

export type ReserveQuoteInput = {
  quoteId: string;
  /** Legacy per-bucket units. Credit-priced quotes reserve an empty vector. */
  units: ProductUsageUnit[];
  usageId?: string;
};

export type DispatchQuoteInput = {
  quoteId: string;
  /** Deployment chosen for this attempt — must be in frozen candidates. */
  deploymentId: string;
  attemptId: string;
  providerCost?: Omit<
    BuildProviderCostSnapshotInput,
    'attemptId' | 'taskId' | 'deploymentId'
  >;
};

export type TrustedUsageEvidence =
  | {
      kind: TrustedUsageEvidenceKind;
      /** Actual output seconds from provider usage / media duration. */
      actualSeconds: number;
      evidenceRef?: string;
    }
  | {
      kind: 'product_units';
      /** Actual committed product units from the execution receipt. */
      units: ProductUsageUnit[];
      evidenceRef?: string;
    };

export type SettleQuoteInput = {
  quoteId: string;
  /**
   * Trusted usage evidence. When absent or untrusted, settlement stays
   * estimated/unknown and does not claim reconciled billedSeconds.
   */
  trustedUsage?: TrustedUsageEvidence;
  /** Optional attempt id to attach platform-absorbed supply cost delta. */
  attemptId?: string;
  /** Micros per product unit for platform absorption cost estimate. */
  overproductionUnitCostMicros?: number;
};

export type FallbackDispatchInput = {
  quoteId: string;
  deploymentId: string;
  attemptId: string;
  providerCost?: DispatchQuoteInput['providerCost'];
  /** Extra supply cost micros caused by fallback (product charge unchanged). */
  supplyCostDeltaMicros?: number;
};

function revisionFor(input: BuildProductQuoteInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        billingMode: input.billingMode,
        catalogModelId: input.catalogModelId,
        catalogModelRevision: input.catalogModelRevision,
        creditCost: input.creditCost,
        debitUnits: input.debitUnits,
        failureRefundsCredits: input.failureRefundsCredits,
        minChargeSeconds: input.minChargeSeconds,
        outputCount: input.outputCount,
        outputLabel: input.outputLabel,
        operation: input.operation,
        quotePolicyRevision: input.quotePolicyRevision,
        submissionContractHash: input.submissionContractHash,
        submissionPromptHash: input.submissionPromptHash,
        submissionReferenceAssetsHash: input.submissionReferenceAssetsHash,
        submissionInputAssetsHash: input.submissionInputAssetsHash,
        roundingStepSeconds: input.roundingStepSeconds,
        targetSeconds: input.targetSeconds,
        unitRate: input.unitRate,
      }),
    )
    .digest('hex')
    .slice(0, 16);
}

function usageIdFor(taskId: string, quoteId: string): string {
  return `product-usage-${createHash('sha256')
    .update(`${taskId}:${quoteId}`)
    .digest('hex')
    .slice(0, 20)}`;
}

/** Server policy registry. Unknown policy revisions fail safe at any paid quote. */
function extraConfirmThresholdFor(quotePolicyRevision: string) {
  if (quotePolicyRevision === 'quote.policy@1') return 20;
  return Number.EPSILON;
}

export class ProductQuoteService {
  private readonly quotes = new Map<string, ProductQuoteSnapshot>();
  private readonly taskIndex = new Map<string, string>();
  private readonly usage: ProductUsageLedger;
  private readonly providerCosts: MemoryProviderCostSnapshotStore;
  private readonly clock: () => Date;

  constructor(
    options: {
      usageLedger?: ProductUsageLedger;
      providerCostStore?: MemoryProviderCostSnapshotStore;
      clock?: () => Date;
    } = {},
  ) {
    this.usage = options.usageLedger ?? new MemoryProductUsageLedger();
    this.providerCosts =
      options.providerCostStore ?? new MemoryProviderCostSnapshotStore();
    this.clock = options.clock ?? (() => new Date());
  }

  /** Build and store a quoted snapshot (pre-confirm). */
  buildQuote(input: BuildProductQuoteInput): ProductQuoteSnapshot {
    if (!input.quoteId.trim() || !input.catalogModelId.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'quoteId and catalogModelId are required.',
      );
    }
    if (!input.quotePolicyRevision.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'quotePolicyRevision is required.',
      );
    }
    if (
      typeof input.unitRate !== 'number' ||
      !Number.isFinite(input.unitRate) ||
      input.unitRate < 0
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'unitRate must be a finite non-negative number.',
      );
    }
    if (
      input.outputCount !== undefined &&
      (!Number.isSafeInteger(input.outputCount) || input.outputCount < 1)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'outputCount must be a positive integer.',
      );
    }
    if (
      input.outputLabel !== undefined &&
      input.outputLabel.trim().length === 0
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'outputLabel must be a non-empty string.',
      );
    }
    if (input.debitUnits !== undefined) {
      assertProductUsageUnits(input.debitUnits);
    }
    if (
      input.creditCost !== undefined &&
      (!Number.isSafeInteger(input.creditCost) || input.creditCost < 1)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'creditCost must be a positive integer.',
      );
    }
    if (
      input.billingMode === 'per_output_second' &&
      (input.targetSeconds === undefined ||
        !Number.isFinite(input.targetSeconds) ||
        input.targetSeconds <= 0)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'per_output_second quotes require positive targetSeconds.',
      );
    }

    const existing = this.quotes.get(input.quoteId);
    if (existing) {
      // Idempotent rebuild with same facts.
      const nextRevision = revisionFor(input);
      if (existing.revision !== nextRevision) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          `Quote ${input.quoteId} already exists with different facts.`,
        );
      }
      return structuredClone(existing);
    }

    const quotedSeconds =
      input.billingMode === 'per_output_second'
        ? applyBillableSecondsRules({
            rawSeconds: input.targetSeconds as number,
            minChargeSeconds: input.minChargeSeconds,
            roundingStepSeconds: input.roundingStepSeconds,
          })
        : undefined;

    const confirmedAmount = computeProductAmount({
      billingMode: input.billingMode,
      unitRate: input.unitRate,
      billableSeconds: quotedSeconds,
    });
    const authorizedCeiling = input.authorizedCeiling ?? confirmedAmount;
    if (authorizedCeiling < confirmedAmount) {
      throw new P1DomainError(
        'INVALID_STATE',
        'authorizedCeiling cannot be below confirmed amount.',
      );
    }

    const now = this.clock().toISOString();
    const snapshot: ProductQuoteSnapshot = {
      quoteId: input.quoteId,
      revision: revisionFor(input),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      catalogModelId: input.catalogModelId,
      ...(input.operation ? { operation: input.operation } : {}),
      ...(input.catalogModelRevision
        ? { catalogModelRevision: input.catalogModelRevision }
        : {}),
      quotePolicyRevision: input.quotePolicyRevision,
      ...(input.submissionContractHash
        ? { submissionContractHash: input.submissionContractHash }
        : {}),
      ...(input.submissionPromptHash
        ? { submissionPromptHash: input.submissionPromptHash }
        : {}),
      ...(input.submissionReferenceAssetsHash
        ? { submissionReferenceAssetsHash: input.submissionReferenceAssetsHash }
        : {}),
      ...(input.submissionInputAssetsHash
        ? { submissionInputAssetsHash: input.submissionInputAssetsHash }
        : {}),
      extraConfirmThreshold: extraConfirmThresholdFor(
        input.quotePolicyRevision,
      ),
      billingMode: input.billingMode,
      ...(input.creditCost !== undefined ? { creditCost: input.creditCost } : {}),
      ...(input.debitUnits
        ? { debitUnits: structuredClone(input.debitUnits) }
        : {}),
      ...(input.failureRefundsCredits !== undefined
        ? { failureRefundsCredits: input.failureRefundsCredits }
        : {}),
      ...(input.outputCount !== undefined
        ? { outputCount: input.outputCount }
        : {}),
      ...(input.outputLabel
        ? { outputLabel: input.outputLabel.trim() }
        : {}),
      formula: {
        unitRate: input.unitRate,
        ...(input.currency ? { currency: input.currency } : {}),
        expression:
          input.formulaExpression ??
          (input.billingMode === 'per_request'
            ? `per_request × ${input.unitRate}`
            : `per_output_second × ${input.unitRate} × billableSeconds`),
      },
      ...(input.targetSeconds !== undefined
        ? { targetSeconds: input.targetSeconds }
        : {}),
      ...(quotedSeconds !== undefined ? { quotedSeconds } : {}),
      ...(input.minChargeSeconds !== undefined
        ? { minChargeSeconds: input.minChargeSeconds }
        : {}),
      ...(input.roundingStepSeconds !== undefined
        ? { roundingStepSeconds: input.roundingStepSeconds }
        : {}),
      confirmedAmount,
      authorizedCeiling,
      ...(input.routeSnapshotRef
        ? { routeSnapshotRef: input.routeSnapshotRef }
        : {}),
      ...(input.frozenCandidateDeploymentIds
        ? {
            frozenCandidateDeploymentIds: [
              ...input.frozenCandidateDeploymentIds,
            ],
          }
        : {}),
      lifecycleStatus: 'quoted',
      createdAt: now,
    };

    this.quotes.set(input.quoteId, snapshot);
    return structuredClone(snapshot);
  }

  getQuote(quoteId: string): ProductQuoteSnapshot | null {
    const quote = this.quotes.get(quoteId);
    return quote ? structuredClone(quote) : null;
  }

  getQuoteByTask(taskId: string): ProductQuoteSnapshot | null {
    const quoteId = this.taskIndex.get(taskId);
    if (!quoteId) return null;
    return this.getQuote(quoteId);
  }

  /** Hydrates a transaction-local service from a durable repository snapshot. */
  restoreState(input: {
    quote: ProductQuoteSnapshot;
    usage?: ProductUsageRecord | null;
    providerCosts?: ProviderCostSnapshot[];
  }) {
    this.quotes.set(input.quote.quoteId, structuredClone(input.quote));
    if (input.quote.taskId) {
      this.taskIndex.set(input.quote.taskId, input.quote.quoteId);
    }
    if (input.usage) {
      if (!this.usage.restore) {
        throw new P1DomainError(
          'INVALID_STATE',
          'The configured ProductUsage ledger cannot restore durable state.',
        );
      }
      this.usage.restore(structuredClone(input.usage));
    }
    for (const cost of input.providerCosts ?? []) {
      this.providerCosts.save(structuredClone(cost));
    }
  }

  confirm(input: ConfirmQuoteInput): ProductQuoteSnapshot {
    const quote = this.requireQuote(input.quoteId);
    if (!input.taskId.trim()) {
      throw new P1DomainError('INVALID_STATE', 'taskId is required to confirm.');
    }

    if (quote.taskId && quote.taskId !== input.taskId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Quote ${input.quoteId} is already bound to task ${quote.taskId}.`,
      );
    }

    // Idempotent: same task already bound to this quote past quoted.
    if (
      quote.taskId === input.taskId &&
      quote.lifecycleStatus !== 'quoted'
    ) {
      return structuredClone(quote);
    }

    if (quote.lifecycleStatus !== 'quoted' && quote.lifecycleStatus !== 'confirmed') {
      throw new P1DomainError(
        'INVALID_STATE',
        `Quote ${input.quoteId} cannot confirm from status ${quote.lifecycleStatus}.`,
      );
    }

    const existingTaskQuote = this.taskIndex.get(input.taskId);
    if (existingTaskQuote && existingTaskQuote !== input.quoteId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Task ${input.taskId} already has a confirmed quote.`,
      );
    }

    if (quote.lifecycleStatus === 'confirmed' && quote.taskId === input.taskId) {
      return structuredClone(quote);
    }

    const ceiling =
      input.authorizedCeiling ??
      quote.authorizedCeiling ??
      quote.confirmedAmount ??
      0;

    const next: ProductQuoteSnapshot = {
      ...quote,
      taskId: input.taskId,
      authorizedCeiling: ceiling,
      confirmedAmount: quote.confirmedAmount ?? ceiling,
      lifecycleStatus: 'confirmed',
      confirmedAt: this.clock().toISOString(),
    };
    this.quotes.set(input.quoteId, next);
    this.taskIndex.set(input.taskId, input.quoteId);
    return structuredClone(next);
  }

  reserve(input: ReserveQuoteInput): {
    quote: ProductQuoteSnapshot;
    usage: ProductUsageRecord;
  } {
    const quote = this.requireQuote(input.quoteId);
    if (
      quote.lifecycleStatus !== 'confirmed' &&
      quote.lifecycleStatus !== 'reserved' &&
      quote.lifecycleStatus !== 'dispatched' &&
      quote.lifecycleStatus !== 'settled'
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Quote ${input.quoteId} must be confirmed before reserve.`,
      );
    }
    if (!quote.taskId || !quote.workspaceId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Confirmed quote requires taskId and workspaceId for reserve.',
      );
    }

    if (quote.creditCost !== undefined) {
      if (input.units.length !== 0) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Credit quote ${input.quoteId} must not reserve legacy product units.`,
        );
      }
    } else {
      assertProductUsageUnits(input.units);
      if (
        quote.debitUnits &&
        !sameProductUsageUnits(quote.debitUnits, input.units)
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Quote ${input.quoteId} reservation does not match the frozen debit preview.`,
        );
      }
    }
    const usage = this.usage.reserve({
      id: input.usageId ?? usageIdFor(quote.taskId, quote.quoteId),
      taskId: quote.taskId,
      workspaceId: quote.workspaceId,
      quoteId: quote.quoteId,
      units: input.units,
      ...(quote.creditCost !== undefined ? { credits: quote.creditCost } : {}),
      billingMode: quote.billingMode,
      createdAt: this.clock().toISOString(),
    });

    if (quote.lifecycleStatus === 'confirmed') {
      const next: ProductQuoteSnapshot = {
        ...quote,
        lifecycleStatus: 'reserved',
        reservedAt: this.clock().toISOString(),
      };
      this.quotes.set(quote.quoteId, next);
      return { quote: structuredClone(next), usage };
    }

    return { quote: structuredClone(quote), usage };
  }

  dispatch(input: DispatchQuoteInput): {
    quote: ProductQuoteSnapshot;
    providerCost?: ProviderCostSnapshot;
  } {
    const quote = this.requireQuote(input.quoteId);
    if (
      quote.lifecycleStatus !== 'reserved' &&
      quote.lifecycleStatus !== 'dispatched'
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Quote ${input.quoteId} must be reserved before dispatch.`,
      );
    }
    this.assertCandidateAllowed(quote, input.deploymentId);

    let providerCost: ProviderCostSnapshot | undefined;
    if (input.providerCost && quote.taskId) {
      providerCost = this.providerCosts.save(
        buildProviderCostSnapshot({
          ...input.providerCost,
          attemptId: input.attemptId,
          taskId: quote.taskId,
          deploymentId: input.deploymentId,
        }),
      );
    }

    if (quote.lifecycleStatus === 'reserved') {
      const next: ProductQuoteSnapshot = {
        ...quote,
        lifecycleStatus: 'dispatched',
      };
      this.quotes.set(quote.quoteId, next);
      return {
        quote: structuredClone(next),
        ...(providerCost ? { providerCost } : {}),
      };
    }

    return {
      quote: structuredClone(quote),
      ...(providerCost ? { providerCost } : {}),
    };
  }

  /**
   * In-task fallback: only frozen candidates + confirmed ceiling.
   * Product charge is NOT re-reserved; supply cost delta is recorded.
   */
  fallbackDispatch(input: FallbackDispatchInput): {
    quote: ProductQuoteSnapshot;
    providerCost?: ProviderCostSnapshot;
  } {
    const quote = this.requireQuote(input.quoteId);
    if (
      quote.lifecycleStatus !== 'dispatched' &&
      quote.lifecycleStatus !== 'reserved'
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Fallback requires a reserved/dispatched quote (got ${quote.lifecycleStatus}).`,
      );
    }
    this.assertCandidateAllowed(quote, input.deploymentId);

    // Negative assert: product usage must remain a single reservation.
    if (quote.taskId) {
      const usage = this.usage.getByTask(quote.taskId);
      if (!usage || usage.status !== 'reserved') {
        throw new P1DomainError(
          'INVALID_STATE',
          'Fallback cannot re-charge product usage; expected a single reserved entry.',
        );
      }
    }

    let providerCost: ProviderCostSnapshot | undefined;
    if (quote.taskId) {
      const base = buildProviderCostSnapshot({
        attemptId: input.attemptId,
        taskId: quote.taskId,
        deploymentId: input.deploymentId,
        supplierPriceRevision:
          input.providerCost?.supplierPriceRevision ?? 'fallback-unknown',
        billingMode:
          input.providerCost?.billingMode ?? quote.billingMode,
        unitPriceMicros: input.providerCost?.unitPriceMicros ?? 0,
        currency: input.providerCost?.currency ?? quote.formula.currency ?? 'CNY',
        unit: input.providerCost?.unit ?? 'request',
        ...(input.providerCost ?? {}),
        ...(input.supplyCostDeltaMicros !== undefined
          ? { supplyCostDeltaMicros: input.supplyCostDeltaMicros }
          : {}),
      });
      providerCost = this.providerCosts.save(base);
    }

    if (quote.lifecycleStatus === 'reserved') {
      const next: ProductQuoteSnapshot = {
        ...quote,
        lifecycleStatus: 'dispatched',
      };
      this.quotes.set(quote.quoteId, next);
      return {
        quote: structuredClone(next),
        ...(providerCost ? { providerCost } : {}),
      };
    }

    return {
      quote: structuredClone(quote),
      ...(providerCost ? { providerCost } : {}),
    };
  }

  settle(input: SettleQuoteInput): {
    quote: ProductQuoteSnapshot;
    usage: ProductUsageRecord;
  } {
    const quote = this.requireQuote(input.quoteId);
    if (
      quote.lifecycleStatus !== 'dispatched' &&
      quote.lifecycleStatus !== 'reserved' &&
      quote.lifecycleStatus !== 'settled'
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Quote ${input.quoteId} cannot settle from status ${quote.lifecycleStatus}.`,
      );
    }
    if (!quote.taskId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Quote taskId is required for settle.',
      );
    }

    const ceiling = quote.authorizedCeiling ?? quote.confirmedAmount ?? 0;
    const now = this.clock().toISOString();

    // Idempotent settle replay.
    if (quote.lifecycleStatus === 'settled') {
      const usage = this.usage.getByTask(quote.taskId);
      if (!usage) {
        throw new P1DomainError(
          'NOT_FOUND',
          `Settled quote ${input.quoteId} is missing product usage.`,
        );
      }
      return { quote: structuredClone(quote), usage };
    }

    const reservedUsage = this.usage.getByTask(quote.taskId);
    if (!reservedUsage) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Quote ${input.quoteId} is missing product usage.`,
      );
    }

    // Credit-era (#298 / D-172): reservation is credits with empty legacy
    // product units. Note (and other) deliveries may still attach historical
    // product_units trustedUsage; that evidence must not block credit commit
    // or invent bucket settlements that were never reserved.
    if (quote.creditCost !== undefined) {
      const usage = this.usage.settle({
        taskId: quote.taskId,
        settledUnits: [],
        settlementStatus: 'estimated',
        updatedAt: now,
      });
      const next: ProductQuoteSnapshot = {
        ...quote,
        lifecycleStatus: ceiling === 0 ? 'refunded' : 'settled',
        settlementStatus: 'estimated',
        settledAmount: ceiling,
        refundedAmount: 0,
        settledAt: now,
      };
      this.quotes.set(quote.quoteId, next);
      return { quote: structuredClone(next), usage };
    }

    let settlementStatus: ProductSettlementStatus = 'estimated';
    let settledAmount = ceiling;
    let billedSeconds: number | undefined;
    let platformAbsorbedAmount = 0;
    let refundedAmount = 0;
    let settledUnitQuantity = reservedUsage.reservedQuantity;
    let settledUnits = reservedProductUsageUnits(reservedUsage);

    const trustedUnits =
      input.trustedUsage?.kind === 'product_units'
        ? input.trustedUsage.units
        : undefined;
    if (trustedUnits) assertProductUsageUnits(trustedUnits);
    const trustedSeconds =
      input.trustedUsage &&
      input.trustedUsage.kind !== 'product_units' &&
      isTrustedUsageEvidence(input.trustedUsage.kind) &&
      Number.isFinite(input.trustedUsage.actualSeconds) &&
      input.trustedUsage.actualSeconds >= 0
        ? input.trustedUsage
        : undefined;

    if (trustedUnits) {
      settlementStatus = 'reconciled';
      settledAmount = Math.min(ceiling, quote.confirmedAmount ?? ceiling);
      settledUnits = reconcileTrustedProductUsageUnits(
        settledUnits,
        trustedUnits,
      );
    } else if (!trustedSeconds) {
      // Honest: keep estimated/unknown; do not invent billedSeconds.
      settlementStatus = input.trustedUsage ? 'unknown' : 'estimated';
      settledAmount = ceiling;
    } else if (quote.billingMode === 'per_request') {
      settlementStatus = 'reconciled';
      settledAmount = Math.min(ceiling, quote.confirmedAmount ?? ceiling);
      billedSeconds = undefined;
    } else {
      // per_output_second with trusted evidence
      const billableSeconds = applyBillableSecondsRules({
        rawSeconds: trustedSeconds.actualSeconds,
        minChargeSeconds: quote.minChargeSeconds,
        roundingStepSeconds: quote.roundingStepSeconds,
      });
      billedSeconds = billableSeconds;
      settledUnitQuantity = Math.min(
        reservedUsage.reservedQuantity,
        Math.ceil(billableSeconds),
      );
      if (
        settledUnits.length !== 1 ||
        settledUnits[0]?.resource !== 'video'
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Per-second settlement requires one video product usage unit.',
        );
      }
      settledUnits = [
        { resource: 'video', quantity: settledUnitQuantity },
      ];
      const rawAmount = computeProductAmount({
        billingMode: 'per_output_second',
        unitRate: quote.formula.unitRate,
        billableSeconds,
      });

      if (rawAmount <= ceiling) {
        settledAmount = rawAmount;
        refundedAmount = ceiling - rawAmount;
        settlementStatus = 'reconciled';
      } else {
        // High: no silent surcharge — platform absorbs overproduction.
        settledAmount = ceiling;
        platformAbsorbedAmount = rawAmount - ceiling;
        settlementStatus = 'reconciled';

        if (input.attemptId) {
          const existing = this.providerCosts.get(input.attemptId);
          if (existing) {
            const costMicros =
              input.overproductionUnitCostMicros !== undefined
                ? platformAbsorbedAmount * input.overproductionUnitCostMicros
                : platformAbsorbedAmount * existing.unitPriceMicros;
            this.providerCosts.save(
              absorbOverproductionToSupplyCost(existing, costMicros),
            );
          }
        }
      }
    }

    const usage = this.usage.settle({
      taskId: quote.taskId,
      settledUnits,
      settlementStatus,
      updatedAt: now,
    });

    const next: ProductQuoteSnapshot = {
      ...quote,
      lifecycleStatus: settledAmount === 0 ? 'refunded' : 'settled',
      settlementStatus,
      settledAmount,
      refundedAmount,
      ...(platformAbsorbedAmount > 0 ? { platformAbsorbedAmount } : {}),
      // billedSeconds only when trusted evidence produced it
      ...(billedSeconds !== undefined ? { billedSeconds } : {}),
      settledAt: now,
    };
    this.quotes.set(quote.quoteId, next);
    return { quote: structuredClone(next), usage };
  }

  /**
   * Failure path: release the frozen product-unit reservation. Legacy
   * per-second quotes retain their historical partial-settlement behavior.
   */
  failAndRefund(input: {
    quoteId: string;
    trustedUsage?: TrustedUsageEvidence;
    reason?: string;
    /** Timeout and platform failures refund credits regardless of model policy. */
    forceCreditRefund?: boolean;
  }): {
    quote: ProductQuoteSnapshot;
    usage: ProductUsageRecord;
  } {
    const quote = this.requireQuote(input.quoteId);
    if (!quote.taskId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Quote taskId is required for fail/refund.',
      );
    }

    if (
      quote.lifecycleStatus === 'settled' ||
      quote.lifecycleStatus === 'refunded'
    ) {
      const usage = this.usage.getByTask(quote.taskId);
      if (!usage) {
        throw new P1DomainError(
          'NOT_FOUND',
          `Quote ${input.quoteId} is missing product usage.`,
        );
      }
      return { quote: structuredClone(quote), usage };
    }

    const now = this.clock().toISOString();
    const ceiling = quote.authorizedCeiling ?? quote.confirmedAmount ?? 0;
    const reservedUsage = this.usage.getByTask(quote.taskId);
    if (!reservedUsage) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Quote ${input.quoteId} is missing product usage.`,
      );
    }

    let remainingAmount = 0;
    let remainingUnitQuantity = 0;
    let remainingUnits: ProductUsageUnit[] = [];
    let billedSeconds: number | undefined;
    let settlementStatus: ProductSettlementStatus = 'reconciled';

    if (quote.creditCost !== undefined) {
      const refundCredits =
        input.forceCreditRefund === true || quote.failureRefundsCredits === true;
      const usage = refundCredits
        ? this.usage.refund({
            taskId: quote.taskId,
            remainingUnits: [],
            updatedAt: now,
          })
        : this.usage.settle({
            taskId: quote.taskId,
            settledUnits: [],
            settlementStatus,
            updatedAt: now,
          });
      const next: ProductQuoteSnapshot = {
        ...quote,
        lifecycleStatus: refundCredits ? 'refunded' : 'settled',
        settlementStatus,
        settledAmount: refundCredits ? 0 : ceiling,
        refundedAmount: refundCredits ? ceiling : 0,
        settledAt: now,
      };
      this.quotes.set(quote.quoteId, next);
      return { quote: structuredClone(next), usage };
    }

    if (input.trustedUsage?.kind === 'product_units') {
      assertProductUsageUnits(input.trustedUsage.units);
      remainingUnits = reconcileTrustedProductUsageUnits(
        reservedProductUsageUnits(reservedUsage),
        input.trustedUsage.units,
      );
      remainingUnitQuantity = remainingUnits.reduce(
        (total, unit) => total + unit.quantity,
        0,
      );
      remainingAmount = Math.min(
        ceiling,
        quote.confirmedAmount ?? ceiling,
      );
    } else if (
      input.trustedUsage &&
      isTrustedUsageEvidence(input.trustedUsage.kind) &&
      quote.billingMode === 'per_output_second'
    ) {
      // Partial failure with trusted seconds: charge only trusted billable.
      const billableSeconds = applyBillableSecondsRules({
        rawSeconds: input.trustedUsage.actualSeconds,
        minChargeSeconds: quote.minChargeSeconds,
        roundingStepSeconds: quote.roundingStepSeconds,
      });
      billedSeconds = billableSeconds;
      remainingAmount = Math.min(
        ceiling,
        computeProductAmount({
          billingMode: 'per_output_second',
          unitRate: quote.formula.unitRate,
          billableSeconds,
        }),
      );
      remainingUnitQuantity = Math.min(
        reservedUsage.reservedQuantity,
        Math.ceil(billableSeconds),
      );
      const reservedUnits = reservedProductUsageUnits(reservedUsage);
      if (
        reservedUnits.length !== 1 ||
        reservedUnits[0]?.resource !== 'video'
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Per-second refund requires one video product usage unit.',
        );
      }
      remainingUnits = [
        { resource: 'video', quantity: remainingUnitQuantity },
      ];
    } else if (input.trustedUsage && !isTrustedUsageEvidence(input.trustedUsage.kind)) {
      settlementStatus = 'unknown';
      remainingAmount = 0;
    } else {
      // Full failure without usable output — full refund.
      remainingAmount = 0;
    }

    const usage = this.usage.refund({
      taskId: quote.taskId,
      remainingUnits,
      updatedAt: now,
    });

    const next: ProductQuoteSnapshot = {
      ...quote,
      lifecycleStatus: remainingAmount === 0 ? 'refunded' : 'settled',
      settlementStatus,
      settledAmount: remainingAmount,
      refundedAmount: ceiling - remainingAmount,
      ...(billedSeconds !== undefined ? { billedSeconds } : {}),
      settledAt: now,
    };
    this.quotes.set(quote.quoteId, next);
    return { quote: structuredClone(next), usage };
  }

  listProviderCosts(taskId: string): ProviderCostSnapshot[] {
    return this.providerCosts.listForTask(taskId);
  }

  getUsage(taskId: string): ProductUsageRecord | null {
    return this.usage.getByTask(taskId);
  }

  private requireQuote(quoteId: string): ProductQuoteSnapshot {
    const quote = this.quotes.get(quoteId);
    if (!quote) {
      throw new P1DomainError('NOT_FOUND', `Quote ${quoteId} was not found.`);
    }
    return quote;
  }

  private assertCandidateAllowed(
    quote: ProductQuoteSnapshot,
    deploymentId: string,
  ) {
    const frozen = quote.frozenCandidateDeploymentIds;
    if (!frozen || frozen.length === 0) {
      // No frozen set recorded — allow but do not invent candidates.
      return;
    }
    if (!frozen.includes(deploymentId)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Deployment ${deploymentId} is outside the frozen fallback candidate set.`,
      );
    }
  }
}

export function productUsageUnitsForQuote(
  quote: ProductQuoteSnapshot,
  legacyResource?: ProductUsageUnit['resource'],
) {
  if (quote.creditCost !== undefined) return [];
  if (quote.debitUnits) {
    assertProductUsageUnits(quote.debitUnits);
    return structuredClone(quote.debitUnits);
  }
  const quantity =
    quote.billingMode === 'per_output_second'
      ? (quote.quotedSeconds ?? quote.targetSeconds)
      : (quote.outputCount ?? 1);
  assertProductUsageUnitQuantity(quantity, 'quote product usage quantity');
  return [
    {
      resource:
        legacyResource ??
        (quote.billingMode === 'per_output_second'
          ? ('video' as const)
          : ('copy' as const)),
      quantity: quantity as number,
    },
  ];
}

function assertProductUsageUnits(units: ProductUsageUnit[]) {
  if (units.length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Product usage reserve requires at least one product resource.',
    );
  }
  const resources = new Set<ProductUsageUnit['resource']>();
  for (const unit of units) {
    assertProductUsageUnitQuantity(unit.quantity, `${unit.resource} quantity`);
    if (resources.has(unit.resource)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Product usage reserve requires one quantity per product resource.',
      );
    }
    resources.add(unit.resource);
  }
}

function reconcileTrustedProductUsageUnits(
  reservedUnits: ProductUsageUnit[],
  trustedUnits: ProductUsageUnit[],
) {
  const trustedByResource = new Map(
    trustedUnits.map((unit) => [unit.resource, unit.quantity]),
  );
  if (
    trustedUnits.some(
      (unit) =>
        !reservedUnits.some(
          (reserved) => reserved.resource === unit.resource,
        ),
    )
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Trusted product usage contains an unreserved resource.',
    );
  }
  return reservedUnits.map((reserved) => ({
    resource: reserved.resource,
    quantity: Math.min(
      reserved.quantity,
      trustedByResource.get(reserved.resource) ?? reserved.quantity,
    ),
  }));
}

function sameProductUsageUnits(
  left: ProductUsageUnit[],
  right: ProductUsageUnit[],
) {
  if (left.length !== right.length) return false;
  const byResource = new Map(
    right.map((unit) => [unit.resource, unit.quantity]),
  );
  return left.every(
    (unit) => byResource.get(unit.resource) === unit.quantity,
  );
}

function assertProductUsageUnitQuantity(
  quantity: number | undefined,
  field: string,
) {
  if (!Number.isSafeInteger(quantity) || (quantity ?? 0) < 1) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${field} must be a positive integer product usage quantity.`,
    );
  }
}
