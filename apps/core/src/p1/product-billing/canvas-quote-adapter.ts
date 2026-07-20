/**
 * Adapters that project existing quote fact sources into ProductQuoteSnapshot
 * fields without inventing a fourth quote object (#92 / D-088).
 *
 * Sources:
 * 1. Frontend quoteFor / CreativeExecutionContract quote fields
 * 2. Canvas persisted generation quote (PersistedCanvasGenerationQuote shape)
 *
 * Adapters only map — they do not own or copy truth into a parallel store.
 */

import {
  applyBillableSecondsRules,
  computeProductAmount,
  type BuildProductQuoteInput,
  type ProductBillingMode,
  type ProductQuoteSnapshot,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';

/** Subset of CreativeExecutionContract quote-related fields. */
export type CreativeExecutionQuoteSource = {
  catalogModelId: string;
  catalogRevision: string;
  quoteRevision: string;
  estimatedAmount: number;
  currency: string;
  durationSeconds?: number;
  outputCount?: number;
};

/**
 * Canvas persisted quote shape (read-only projection of model-supply
 * PersistedCanvasGenerationQuote — fields we need, not a second store).
 */
export type CanvasPersistedQuoteSource = {
  quoteId: string;
  catalogRevisionId: string;
  deploymentId: string;
  operation: string;
  priceRevision: string;
  routeSnapshot: {
    id: string;
    actualCatalogModelId?: string;
    catalogModelId?: string;
    allowedCandidates?: Array<{ deploymentId: string }>;
  };
  estimatedProviderCost?: {
    amountMicros: number;
    currency: 'CNY' | 'USD';
    unit: string;
  } | null;
  workspaceId?: string;
  createdAt?: string;
};

/** Frontend quoteFor-style estimate (client-side preview only). */
export type ClientQuoteForSource = {
  catalogModelId: string;
  catalogRevision?: string;
  quoteRevision?: string;
  billingMode?: ProductBillingMode;
  unitRate?: number;
  currency?: string;
  durationSeconds?: number;
  estimatedAmount?: number;
};

function inferBillingMode(unit: string | undefined): ProductBillingMode {
  if (!unit) return 'per_request';
  const normalized = unit.toLowerCase();
  if (
    normalized.includes('second') ||
    normalized === 's' ||
    normalized === 'sec' ||
    normalized === 'output_second'
  ) {
    return 'per_output_second';
  }
  return 'per_request';
}

function unitRateFromMicros(amountMicros: number): number {
  return amountMicros / 1_000_000;
}

/**
 * Map CreativeExecutionContract quote fields → BuildProductQuoteInput.
 * Does not freeze a new truth — callers pass result to quote-service.build.
 */
export function adaptCreativeExecutionQuote(
  source: CreativeExecutionQuoteSource,
  options: {
    quoteId: string;
    billingMode?: ProductBillingMode;
    minChargeSeconds?: number;
    roundingStepSeconds?: number;
    routeSnapshotRef?: string;
    frozenCandidateDeploymentIds?: string[];
    taskId?: string;
    workspaceId?: string;
  },
): BuildProductQuoteInput {
  if (!source.catalogModelId.trim() || !source.quoteRevision.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'CreativeExecutionContract quote requires catalogModelId and quoteRevision.',
    );
  }

  const billingMode =
    options.billingMode ??
    (source.durationSeconds !== undefined
      ? 'per_output_second'
      : 'per_request');

  const outputCount = source.outputCount ?? 1;
  const unitRate =
    billingMode === 'per_request'
      ? source.estimatedAmount / outputCount
      : source.durationSeconds && source.durationSeconds > 0
        ? source.estimatedAmount / source.durationSeconds
        : source.estimatedAmount;

  return {
    quoteId: options.quoteId,
    catalogModelId: source.catalogModelId,
    catalogModelRevision: source.catalogRevision,
    quotePolicyRevision: source.quoteRevision,
    billingMode,
    unitRate,
    currency: source.currency,
    formulaExpression:
      billingMode === 'per_request'
        ? `per_request × ${unitRate}`
        : `per_output_second × ${unitRate} × billableSeconds`,
    ...(source.durationSeconds !== undefined
      ? { targetSeconds: source.durationSeconds }
      : {}),
    ...(options.minChargeSeconds !== undefined
      ? { minChargeSeconds: options.minChargeSeconds }
      : {}),
    ...(options.roundingStepSeconds !== undefined
      ? { roundingStepSeconds: options.roundingStepSeconds }
      : {}),
    ...(options.routeSnapshotRef
      ? { routeSnapshotRef: options.routeSnapshotRef }
      : {}),
    ...(options.frozenCandidateDeploymentIds
      ? { frozenCandidateDeploymentIds: options.frozenCandidateDeploymentIds }
      : {}),
    ...(options.taskId ? { taskId: options.taskId } : {}),
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
  };
}

/**
 * Map canvas persisted quote → BuildProductQuoteInput.
 * Reads existing canvas quote fields; does not duplicate them into a new object store.
 */
export function adaptCanvasPersistedQuote(
  source: CanvasPersistedQuoteSource,
  options: {
    targetSeconds?: number;
    minChargeSeconds?: number;
    roundingStepSeconds?: number;
    billingMode?: ProductBillingMode;
    unitRate?: number;
    taskId?: string;
  } = {},
): BuildProductQuoteInput {
  if (!source.quoteId.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Canvas quote requires quoteId.',
    );
  }

  const unit = source.estimatedProviderCost?.unit;
  const billingMode =
    options.billingMode ?? inferBillingMode(unit);
  const unitRate =
    options.unitRate ??
    (source.estimatedProviderCost
      ? unitRateFromMicros(source.estimatedProviderCost.amountMicros)
      : 1);

  const catalogModelId =
    source.routeSnapshot.actualCatalogModelId ??
    source.routeSnapshot.catalogModelId ??
    source.deploymentId;

  const frozenCandidateDeploymentIds = source.routeSnapshot.allowedCandidates
    ?.map((candidate) => candidate.deploymentId)
    .filter(Boolean);

  return {
    quoteId: source.quoteId,
    catalogModelId,
    catalogModelRevision: source.catalogRevisionId,
    quotePolicyRevision: source.priceRevision,
    billingMode,
    unitRate,
    currency: source.estimatedProviderCost?.currency,
    formulaExpression:
      billingMode === 'per_request'
        ? `per_request × ${unitRate}`
        : `per_output_second × ${unitRate} × billableSeconds`,
    ...(options.targetSeconds !== undefined
      ? { targetSeconds: options.targetSeconds }
      : {}),
    ...(options.minChargeSeconds !== undefined
      ? { minChargeSeconds: options.minChargeSeconds }
      : {}),
    ...(options.roundingStepSeconds !== undefined
      ? { roundingStepSeconds: options.roundingStepSeconds }
      : {}),
    routeSnapshotRef: source.routeSnapshot.id,
    ...(frozenCandidateDeploymentIds && frozenCandidateDeploymentIds.length > 0
      ? { frozenCandidateDeploymentIds }
      : { frozenCandidateDeploymentIds: [source.deploymentId] }),
    ...(source.workspaceId ? { workspaceId: source.workspaceId } : {}),
    ...(options.taskId ? { taskId: options.taskId } : {}),
  };
}

/**
 * Map frontend quoteFor preview → BuildProductQuoteInput.
 * Client estimates are not trusted for settle; only for building the quote snapshot.
 */
export function adaptClientQuoteFor(
  source: ClientQuoteForSource,
  options: {
    quoteId: string;
    minChargeSeconds?: number;
    roundingStepSeconds?: number;
    routeSnapshotRef?: string;
    frozenCandidateDeploymentIds?: string[];
    workspaceId?: string;
  },
): BuildProductQuoteInput {
  if (!source.catalogModelId.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Client quoteFor requires catalogModelId.',
    );
  }

  const billingMode =
    source.billingMode ??
    (source.durationSeconds !== undefined
      ? 'per_output_second'
      : 'per_request');
  const unitRate =
    source.unitRate ??
    (billingMode === 'per_output_second' &&
    source.durationSeconds &&
    source.estimatedAmount !== undefined
      ? source.estimatedAmount / source.durationSeconds
      : (source.estimatedAmount ?? 1));

  return {
    quoteId: options.quoteId,
    catalogModelId: source.catalogModelId,
    ...(source.catalogRevision
      ? { catalogModelRevision: source.catalogRevision }
      : {}),
    quotePolicyRevision:
      source.quoteRevision ?? `client-preview:${source.catalogModelId}`,
    billingMode,
    unitRate,
    currency: source.currency,
    formulaExpression:
      billingMode === 'per_request'
        ? `per_request × ${unitRate}`
        : `per_output_second × ${unitRate} × billableSeconds`,
    ...(source.durationSeconds !== undefined
      ? { targetSeconds: source.durationSeconds }
      : {}),
    ...(options.minChargeSeconds !== undefined
      ? { minChargeSeconds: options.minChargeSeconds }
      : {}),
    ...(options.roundingStepSeconds !== undefined
      ? { roundingStepSeconds: options.roundingStepSeconds }
      : {}),
    ...(options.routeSnapshotRef
      ? { routeSnapshotRef: options.routeSnapshotRef }
      : {}),
    ...(options.frozenCandidateDeploymentIds
      ? { frozenCandidateDeploymentIds: options.frozenCandidateDeploymentIds }
      : {}),
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
  };
}

/**
 * Project a ProductQuoteSnapshot view from adapter input without re-storing
 * canvas/contract fields as a parallel truth. Used by adapter tests to prove
 * field mapping only (no field duplication into a fourth quote object).
 */
export function projectAdapterQuoteView(
  input: BuildProductQuoteInput,
  now: string,
): Pick<
  ProductQuoteSnapshot,
  | 'quoteId'
  | 'catalogModelId'
  | 'catalogModelRevision'
  | 'quotePolicyRevision'
  | 'billingMode'
  | 'formula'
  | 'targetSeconds'
  | 'quotedSeconds'
  | 'confirmedAmount'
  | 'authorizedCeiling'
  | 'routeSnapshotRef'
  | 'frozenCandidateDeploymentIds'
  | 'lifecycleStatus'
  | 'createdAt'
> {
  const quotedSeconds =
    input.billingMode === 'per_output_second' && input.targetSeconds !== undefined
      ? applyBillableSecondsRules({
          rawSeconds: input.targetSeconds,
          minChargeSeconds: input.minChargeSeconds,
          roundingStepSeconds: input.roundingStepSeconds,
        })
      : undefined;

  const confirmedAmount = computeProductAmount({
    billingMode: input.billingMode,
    unitRate: input.unitRate,
    billableSeconds: quotedSeconds,
  });

  return {
    quoteId: input.quoteId,
    catalogModelId: input.catalogModelId,
    ...(input.catalogModelRevision
      ? { catalogModelRevision: input.catalogModelRevision }
      : {}),
    quotePolicyRevision: input.quotePolicyRevision,
    billingMode: input.billingMode,
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
    confirmedAmount,
    authorizedCeiling: input.authorizedCeiling ?? confirmedAmount,
    ...(input.routeSnapshotRef
      ? { routeSnapshotRef: input.routeSnapshotRef }
      : {}),
    ...(input.frozenCandidateDeploymentIds
      ? { frozenCandidateDeploymentIds: input.frozenCandidateDeploymentIds }
      : {}),
    lifecycleStatus: 'quoted',
    createdAt: now,
  };
}
