/**
 * Product quote / billing cross-lane contract (S1 / #87 skeleton → #92 WT-B).
 *
 * WT-B exclusive owner — no second quote object elsewhere.
 * Consumers (WT-C confirm UI, WT-E regeneration settle, AP/MP H2) import only.
 */

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
  /** CatalogModel revision ref frozen at quote time. */
  catalogModelRevision?: string;
  /** Product QuotePolicy revision (not SupplierPriceRevision). */
  quotePolicyRevision: string;
  billingMode: ProductBillingMode;
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
  /** Confirmed product amount / credit units at user accept. */
  confirmedAmount?: number;
  /** Max authorized product amount/units at confirm (pre-auth ceiling). */
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
  /** Product units finally charged after settle (≤ authorizedCeiling). */
  settledAmount?: number;
  /** Units refunded when trusted actual < reserved ceiling. */
  refundedAmount?: number;
  /**
   * Platform-absorbed product units when trusted actual would exceed ceiling.
   * Never silently surcharged to the workspace.
   */
  platformAbsorbedAmount?: number;
  createdAt?: string;
  confirmedAt?: string;
  reservedAt?: string;
  settledAt?: string;
}

/**
 * Attempt-level provider cost freeze (separate from product quote).
 * One ProviderAttempt → one ProviderCostSnapshot + cost event stream.
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
  payer: 'platform' | 'workspace_byok';
  billingStatus: 'known' | 'externally_billed' | 'unknown' | 'estimated';
}

/**
 * ProductUsage ledger entry — one task, one idempotent reserve/settle.
 * quantity may be fractional for per_output_second (not limited to 0|1).
 */
export interface ProductUsageRecord {
  id: string;
  taskId: string;
  workspaceId: string;
  quoteId: string;
  status: 'reserved' | 'committed' | 'refunded' | 'partially_refunded';
  /** Units reserved at pre-auth (authorized ceiling). */
  reservedQuantity: number;
  /** Units finally charged after settle. */
  settledQuantity: number;
  /** Units refunded (reserved − settled, when positive). */
  refundedQuantity: number;
  billingMode: ProductBillingMode;
  settlementStatus: ProductSettlementStatus;
  resource?: 'copy' | 'image' | 'video' | 'audio';
  createdAt: string;
  updatedAt: string;
}

/** Input shape shared by quote builders (adapters map existing sources here). */
export interface BuildProductQuoteInput {
  quoteId: string;
  catalogModelId: string;
  catalogModelRevision?: string;
  quotePolicyRevision: string;
  billingMode: ProductBillingMode;
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
}

/**
 * Apply min-charge + ceil-to-step on raw seconds for per_output_second.
 * Pure helper shared by quote build and settle.
 */
export function applyBillableSecondsRules(input: {
  rawSeconds: number;
  minChargeSeconds?: number;
  roundingStepSeconds?: number;
}): number {
  const min = input.minChargeSeconds ?? 0;
  const step = input.roundingStepSeconds ?? 1;
  const floored = Math.max(input.rawSeconds, min);
  if (step <= 1) return floored;
  return Math.ceil(floored / step) * step;
}

/**
 * Compute product amount for a billing mode from frozen formula + seconds.
 */
export function computeProductAmount(input: {
  billingMode: ProductBillingMode;
  unitRate: number;
  billableSeconds?: number;
}): number {
  if (input.billingMode === 'per_request') {
    return input.unitRate;
  }
  const seconds = input.billableSeconds ?? 0;
  return input.unitRate * seconds;
}
