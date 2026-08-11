/**
 * Product quote / billing cross-lane contract (S1 / #87 skeleton → #92 WT-B).
 *
 * WT-B exclusive owner — no second quote object elsewhere.
 * Consumers (WT-C confirm UI, initial generation settlement, AP/MP H2) import only.
 */

import { z } from 'zod';

/** Product-level billing basis frozen into ProductQuoteSnapshot. */
export const productBillingModes = [
  'per_request',
  'per_output_second',
] as const;
export type ProductBillingMode = (typeof productBillingModes)[number];

/** Lifecycle for task-level product quote (D-088). */
export const productQuoteLifecycleStatuses = [
  'quoted',
  'confirmed',
  'reserved',
  'dispatched',
  'settled',
  'refunded',
  'failed',
] as const;
export type ProductQuoteLifecycleStatus =
  (typeof productQuoteLifecycleStatuses)[number];

/**
 * Settlement honesty for product charge after settle.
 * missing trusted usage → estimated | unknown (never fake reconciled).
 */
export const productSettlementStatuses = [
  'estimated',
  'reconciled',
  'unknown',
] as const;
export type ProductSettlementStatus = (typeof productSettlementStatuses)[number];

/** Evidence class that may produce trusted billedSeconds. */
export const trustedUsageEvidenceKinds = [
  'provider_usage',
  'provider_bill',
  'media_duration',
] as const;
export type TrustedUsageEvidenceKind =
  (typeof trustedUsageEvidenceKinds)[number];

/** Frozen product unit formula (product side — not supplier price). */
export interface ProductQuoteFormula {
  /** Product units per request (per_request) or per billable second. */
  unitRate: number;
  currency?: string;
  /** Human-readable formula id / description for confirm UI. */
  expression: string;
}

/** Execution carrier covered by a multi-carrier package quote. */
export const productQuoteCarrierKinds = ['note', 'copy', 'media'] as const;
export type ProductQuoteCarrier = (typeof productQuoteCarrierKinds)[number];

/**
 * A server-frozen, independently settleable part of a package quote.
 *
 * `creditCost` deliberately lives on the allocation rather than being inferred
 * from the package total. That keeps a failed copy deliverable from receiving
 * an image-page refund rate (and vice versa).
 */
export interface ProductQuotePackageAllocation {
  allocationId: string;
  carrier: ProductQuoteCarrier;
  deliveryUnits: number;
  creditCost: number;
  failureRefundsCredits: boolean;
  operation: string;
  catalogModel: {
    id: string;
    revision: string;
  };
  /** Server-only execution route reference for this carrier. */
  routeSnapshotRef: string;
  /** Server-only rights revisions that authorize this carrier. */
  rightsRevisionRefs: string[];
}

/**
 * Authoritative server contract for a heterogeneous package quote.
 *
 * The hash is computed by the package quote authority, after server-side
 * operation/model/route/rights resolution. Browser callers never supply or
 * receive this object.
 */
export interface ProductQuotePackageContract {
  contractHash: string;
  allocations: ProductQuotePackageAllocation[];
}

export const productQuotePackageAllocationSchema = z
  .object({
    allocationId: z.string().min(1),
    carrier: z.enum(productQuoteCarrierKinds),
    deliveryUnits: z.number().int().positive(),
    creditCost: z.number().int().nonnegative(),
    failureRefundsCredits: z.boolean(),
    operation: z.string().min(1),
    catalogModel: z
      .object({
        id: z.string().min(1),
        revision: z.string().min(1),
      })
      .strict(),
    routeSnapshotRef: z.string().min(1),
    rightsRevisionRefs: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const productQuotePackageContractSchema = z
  .object({
    contractHash: z.string().min(1),
    allocations: z.array(productQuotePackageAllocationSchema).min(1),
  })
  .strict()
  .superRefine((contract, context) => {
    const allocationIds = new Set<string>();
    for (const allocation of contract.allocations) {
      if (allocationIds.has(allocation.allocationId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate package allocation ${allocation.allocationId}.`,
          path: ['allocations'],
        });
      }
      allocationIds.add(allocation.allocationId);
    }
  });

/**
 * Task-level product quote snapshot (D-088 / #92).
 * One user-confirmed generation task freezes exactly one snapshot.
 */
export interface ProductQuoteSnapshot {
  quoteId: string;
  /** Snapshot content revision (hash or monotonic). */
  revision: string;
  /** Task / GenerationJob id this quote binds to (set at confirm/reserve). */
  taskId?: string;
  workspaceId?: string;
  catalogModelId: string;
  /** Merchant operation frozen by the server quote authority. */
  operation?: string;
  /** CatalogModel revision ref frozen at quote time. */
  catalogModelRevision?: string;
  /** Product QuotePolicy revision (not SupplierPriceRevision). */
  quotePolicyRevision: string;
  /** Hash of the user-confirmed Composer fields covered by this preview. */
  submissionContractHash?: string;
  /** Server-signed provider-input hashes; never expose them to browser callers. */
  submissionPromptHash?: string;
  submissionReferenceAssetsHash?: string;
  submissionInputAssetsHash?: string;
  /** Server-resolved extra-confirm threshold frozen from quotePolicyRevision. */
  extraConfirmThreshold?: number;
  billingMode: ProductBillingMode;
  /** Merchant-facing credits frozen from CatalogModel × operation pricing. */
  creditCost?: number;
  /** The model-operation failure policy shown with the quote before submission. */
  failureRefundsCredits?: boolean;
  /**
   * Server-frozen merchant entitlement debit preview.
   *
   * This vector is the product contract (copy/image/video buckets). Supplier
   * metering such as video seconds remains in ProviderCostSnapshot and must
   * never replace these units during settlement.
   */
  debitUnits?: ProductUsageUnit[];
  /** Server-priced deliverable count frozen into this quote revision. */
  outputCount?: number;
  /**
   * Server-only multi-carrier pricing and execution contract. When present,
   * `outputCount` and `creditCost` equal the sums of its allocations.
   */
  packageContract?: ProductQuotePackageContract;
  /** Server-owned merchant-facing deliverable label bound to outputCount. */
  outputLabel?: string;
  formula: ProductQuoteFormula;
  /**
   * Target / requested duration seconds when billingMode is per_output_second.
   * Single-shot uses shot target; full compose uses full clip target.
   */
  targetSeconds?: number;
  /**
   * Estimated billable seconds after min-charge / rounding on target.
   * Shown as “按生成成片 N 秒计费”.
   */
  quotedSeconds?: number;
  /** Minimum billable seconds from QuotePolicy. */
  minChargeSeconds?: number;
  /** Rounding step (ceil to N seconds). */
  roundingStepSeconds?: number;
  /** Confirmed monetary/product-price amount at user accept. */
  confirmedAmount?: number;
  /** Max authorized monetary/product-price amount at confirm. */
  authorizedCeiling?: number;
  /** Reference to frozen RouteSnapshot id (not embedded route truth). */
  routeSnapshotRef?: string;
  /** Deployment ids frozen for in-task fallback (subset of RouteSnapshot). */
  frozenCandidateDeploymentIds?: string[];
  /**
   * Trusted actual billable seconds at settle.
   * Only from provider/media evidence — never from client estimates.
   */
  billedSeconds?: number;
  settlementStatus?: ProductSettlementStatus;
  lifecycleStatus: ProductQuoteLifecycleStatus;
  /** Monetary/product-price amount finally charged (≤ authorizedCeiling). */
  settledAmount?: number;
  /** Monetary/product-price amount refunded below the authorized ceiling. */
  refundedAmount?: number;
  /**
   * Platform-absorbed monetary amount when trusted actual would exceed ceiling.
   * Never silently surcharged to the workspace.
   */
  platformAbsorbedAmount?: number;
  createdAt?: string;
  /** Server quote-authority validity window; consumers must not invent it. */
  expiresAt?: string;
  confirmedAt?: string;
  reservedAt?: string;
  settledAt?: string;
}

/**
 * Browser / merchant-facing product quote projection.
 *
 * Durable routing fields (`frozenCandidateDeploymentIds`, `routeSnapshotRef`)
 * are server-only and must never cross the browser boundary.
 */
export type PublicProductQuoteSnapshot = Omit<
  ProductQuoteSnapshot,
  | 'frozenCandidateDeploymentIds'
  | 'routeSnapshotRef'
  | 'packageContract'
  | 'submissionPromptHash'
  | 'submissionReferenceAssetsHash'
  | 'submissionInputAssetsHash'
>;

export const publicProductQuoteSnapshotSchema: z.ZodType<PublicProductQuoteSnapshot> =
  z
    .object({
      quoteId: z.string(),
      revision: z.string(),
      taskId: z.string().optional(),
      workspaceId: z.string().optional(),
      catalogModelId: z.string(),
      operation: z.string().optional(),
      catalogModelRevision: z.string().optional(),
      quotePolicyRevision: z.string(),
      submissionContractHash: z.string().optional(),
      extraConfirmThreshold: z.number().optional(),
      billingMode: z.enum(productBillingModes),
      creditCost: z.number().optional(),
      failureRefundsCredits: z.boolean().optional(),
      debitUnits: z
        .array(
          z
            .object({
              resource: z.enum(['copy', 'image', 'video', 'audio']),
              quantity: z.number(),
            })
            .strict(),
        )
        .optional(),
      outputCount: z.number().optional(),
      outputLabel: z.string().optional(),
      formula: z
        .object({
          unitRate: z.number(),
          currency: z.string().optional(),
          expression: z.string(),
        })
        .strict(),
      targetSeconds: z.number().optional(),
      quotedSeconds: z.number().optional(),
      minChargeSeconds: z.number().optional(),
      roundingStepSeconds: z.number().optional(),
      confirmedAmount: z.number().optional(),
      authorizedCeiling: z.number().optional(),
      billedSeconds: z.number().optional(),
      settlementStatus: z.enum(productSettlementStatuses).optional(),
      lifecycleStatus: z.enum(productQuoteLifecycleStatuses),
      settledAmount: z.number().optional(),
      refundedAmount: z.number().optional(),
      platformAbsorbedAmount: z.number().optional(),
      createdAt: z.string().optional(),
      expiresAt: z.string().optional(),
      confirmedAt: z.string().optional(),
      reservedAt: z.string().optional(),
      settledAt: z.string().optional(),
    })
    .strict();

/**
 * Strip server-only routing fields from a durable ProductQuoteSnapshot.
 * The sole serializer for merchant/browser quote responses.
 */
export function toPublicProductQuoteSnapshot(
  quote: ProductQuoteSnapshot,
): PublicProductQuoteSnapshot {
  const {
    frozenCandidateDeploymentIds: _frozenCandidateDeploymentIds,
    routeSnapshotRef: _routeSnapshotRef,
    packageContract: _packageContract,
    submissionPromptHash: _submissionPromptHash,
    submissionReferenceAssetsHash: _submissionReferenceAssetsHash,
    submissionInputAssetsHash: _submissionInputAssetsHash,
    ...publicQuote
  } = quote;
  return publicQuote;
}

/**
 * Attempt-level provider cost freeze (separate from product quote).
 * One ProviderAttempt → one ProviderCostSnapshot + cost event stream.
 *
 * Supply / internal only — never serialize to the browser. Product quote
 * public responses must not embed this type or any provider routing fields.
 */
export interface ProviderCostSnapshot {
  attemptId: string;
  taskId: string;
  deploymentId: string;
  supplierPriceRevision: string;
  billingMode: ProductBillingMode;
  unitPriceMicros: number;
  currency: string;
  unit: string;
  estimatedCostMicros: number | null;
  observedCostMicros?: number | null;
  /** Trusted usage quantity (seconds / tokens / media units). */
  usageQuantity?: number;
  usageUnit?: string;
  evidence?: string;
  evidenceKind?: TrustedUsageEvidenceKind | 'estimated' | 'unknown';
  /**
   * Cost delta attributed to fallback / overproduction that product did not charge.
   * Written to supply cost ledger only.
   */
  supplyCostDeltaMicros?: number;
  /** Explicit supply-side failover event; never creates a second product charge. */
  failover?: ProviderFailoverBillingEvent;
  payer: 'platform' | 'workspace_byok';
  billingStatus: 'known' | 'externally_billed' | 'unknown' | 'estimated';
}

export type ProviderFailoverKind =
  | 'same_model_channel'
  | 'model_substitution';

export interface ProviderFailoverBillingEvent {
  kind: ProviderFailoverKind;
  fromCatalogModelId: string;
  toCatalogModelId: string;
  fromDeploymentId: string;
  toDeploymentId: string;
  fromExecutionChannelId: string | null;
  toExecutionChannelId: string | null;
  fromPriceRevision: string;
  toPriceRevision: string;
  degradationSurfaces: string[];
}

/** Supply availability telemetry emitted when execution moves to a fallback. */
export interface ProviderFailoverAvailabilityEvent
  extends ProviderFailoverBillingEvent {
  eventType: 'provider_failover';
}

/**
 * ProductUsage ledger entry — one task, one idempotent reserve/settle.
 * Quantities are integer merchant entitlement units: copy items, image points,
 * or video tickets. Supplier seconds remain on ProviderCostSnapshot.
 */
export interface ProductUsageRecord {
  id: string;
  taskId: string;
  workspaceId: string;
  quoteId: string;
  status: 'reserved' | 'committed' | 'refunded' | 'partially_refunded';
  /** Product entitlement units reserved before execution. */
  reservedQuantity: number;
  /** Merchant credits reserved before execution; required for credit-billing writes. */
  reservedCredits?: number;
  /** Canonical per-bucket reservation; required on new writes. */
  reservedUnits?: ProductUsageUnit[];
  /** Product entitlement units finally committed after settlement. */
  settledQuantity: number;
  /** Merchant credits finally retained after settlement. */
  settledCredits?: number;
  /** Canonical per-bucket committed units; required on new writes. */
  settledUnits?: ProductUsageUnit[];
  /** Units refunded (reserved − settled, when positive). */
  refundedQuantity: number;
  /** Merchant credits returned to the original grant lot, when still active. */
  refundedCredits?: number;
  /** Canonical per-bucket released units; required on new writes. */
  refundedUnits?: ProductUsageUnit[];
  billingMode: ProductBillingMode;
  settlementStatus: ProductSettlementStatus;
  /** Legacy single-bucket projection retained for pre-upgrade rows. */
  resource?: ProductUsageResource;
  createdAt: string;
  updatedAt: string;
}

export type ProductUsageResource = 'copy' | 'image' | 'video' | 'audio';

export interface ProductUsageUnit {
  resource: ProductUsageResource;
  quantity: number;
}

/** Input shape shared by quote builders (adapters map existing sources here). */
export interface BuildProductQuoteInput {
  quoteId: string;
  catalogModelId: string;
  /** Merchant operation frozen by the server quote authority. */
  operation?: string;
  catalogModelRevision?: string;
  quotePolicyRevision: string;
  submissionContractHash?: string;
  submissionPromptHash?: string;
  submissionReferenceAssetsHash?: string;
  submissionInputAssetsHash?: string;
  billingMode: ProductBillingMode;
  /** Server-authoritative price in merchant credits, never supplier currency. */
  creditCost?: number;
  failureRefundsCredits?: boolean;
  /** Server-authoritative per-bucket entitlement units frozen at quote time. */
  debitUnits?: ProductUsageUnit[];
  outputCount?: number;
  /**
   * Server-only authoritative allocation table for a heterogeneous package.
   * Builders require its totals to exactly match outputCount and creditCost.
   */
  packageContract?: ProductQuotePackageContract;
  outputLabel?: string;
  unitRate: number;
  currency?: string;
  formulaExpression?: string;
  targetSeconds?: number;
  minChargeSeconds?: number;
  roundingStepSeconds?: number;
  routeSnapshotRef?: string;
  frozenCandidateDeploymentIds?: string[];
  workspaceId?: string;
  taskId?: string;
  /** Optional explicit ceiling override (defaults to computed confirmed amount). */
  authorizedCeiling?: number;
  /** Absolute validity from ProductQuote authority. */
  expiresAt?: string;
}
