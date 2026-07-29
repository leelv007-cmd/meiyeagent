/**
 * Supply-side ledger freeze fields (H2 / D-066 story 29).
 *
 * Per-request freeze: workspace / RouteSnapshot ref / CredentialAccountVersion /
 * supplier request-task ID / usage / SupplierPriceRevision+PricingEvidence
 * (never QuotePolicy — that name belongs to product quote domain #92).
 *
 * Ledger chain ownership:
 * - GrantLot: narrow extend only (pool source + independent idempotency keys)
 * - ProductUsage: consume #92 contract only (attach supply freeze refs)
 * - ProviderCost: evolve appendProviderCost event facts (not foundation-ledger.ts)
 *
 * Supplier-level variance is retained on the supply account and is never
 * projected onto user/product-facing cost surfaces.
 */

import type {
  PricingEvidence,
  ProductUsageRecord,
  SupplierPriceRevision,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import type { ProviderCostEvent } from '../foundation/domain.js';
import {
  GRANT_IDEMPOTENCY_KEY_PREFIX,
  assertIndependentGrantConsumeIdempotencyKeys,
} from '../foundation/grant-lot.js';

/** Per-request supply-side freeze (immutable once written). */
export interface SupplyRequestFreeze {
  id: string;
  workspaceId: string;
  /** Canonical RouteSnapshot id / durable ref (S2b). */
  routeSnapshotRef: string;
  /** CredentialAccount.version at freeze time. */
  credentialAccountVersion: string;
  /** Upstream supplier request / task identifier. */
  supplierRequestTaskId: string;
  usage: {
    resource: 'copy' | 'image' | 'video' | 'audio';
    quantity: number;
    unit: string;
  };
  /** Supply-side price revision — not product QuotePolicy. */
  supplierPriceRevision: SupplierPriceRevision;
  supplyPoolId: string;
  /** Optional link to #92 ProductUsage task. */
  productUsageTaskId?: string;
  /** Optional link to ProviderCost attempt chain. */
  providerCostAttemptId?: string;
  frozenAt: string;
}

export type BuildSupplyRequestFreezeInput = {
  id: string;
  workspaceId: string;
  routeSnapshotRef: string;
  credentialAccountVersion: string;
  supplierRequestTaskId: string;
  usage: SupplyRequestFreeze['usage'];
  supplierPriceRevision: SupplierPriceRevision;
  supplyPoolId: string;
  productUsageTaskId?: string;
  providerCostAttemptId?: string;
  frozenAt: string;
};

/**
 * Supplier-level unattributable variance retained on the supply account.
 * Must never be allocated to workspace/user product projections.
 */
export interface SupplierLevelVariance {
  id: string;
  supplyAccountId: string;
  credentialAccountId: string;
  amountMicros: number;
  currency: 'CNY' | 'USD';
  reason: string;
  /** Always supplier-scope — never workspace-allocated. */
  allocation: 'supplier_unallocated';
  observedAt: string;
  evidence?: string;
}

/** Product / user facing cost projection (dual-truth safe). */
export interface UserFacingCostProjection {
  workspaceId: string;
  productUsage?: Pick<
    ProductUsageRecord,
    'taskId' | 'settledQuantity' | 'reservedQuantity' | 'status'
  >;
  /** Product-charged amount only — never includes supplier variance. */
  chargedAmount: number;
  currency: string;
  supplierVarianceAllocated: false;
}

export function buildSupplyRequestFreeze(
  input: BuildSupplyRequestFreezeInput
): SupplyRequestFreeze {
  if (
    !input.id.trim() ||
    !input.workspaceId.trim() ||
    !input.routeSnapshotRef.trim() ||
    !input.credentialAccountVersion.trim() ||
    !input.supplierRequestTaskId.trim() ||
    !input.supplyPoolId.trim()
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'SupplyRequestFreeze requires workspace, RouteSnapshot ref, CredentialAccountVersion, supplier task id, and supplyPoolId.'
    );
  }
  if (
    typeof input.usage.quantity !== 'number' ||
    !Number.isFinite(input.usage.quantity) ||
    input.usage.quantity < 0
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'SupplyRequestFreeze usage.quantity must be a finite non-negative number.'
    );
  }
  assertSupplierPriceRevision(input.supplierPriceRevision);

  return {
    id: input.id,
    workspaceId: input.workspaceId,
    routeSnapshotRef: input.routeSnapshotRef,
    credentialAccountVersion: input.credentialAccountVersion,
    supplierRequestTaskId: input.supplierRequestTaskId,
    usage: structuredClone(input.usage),
    supplierPriceRevision: structuredClone(input.supplierPriceRevision),
    supplyPoolId: input.supplyPoolId,
    ...(input.productUsageTaskId
      ? { productUsageTaskId: input.productUsageTaskId }
      : {}),
    ...(input.providerCostAttemptId
      ? { providerCostAttemptId: input.providerCostAttemptId }
      : {}),
    frozenAt: input.frozenAt,
  };
}

function assertSupplierPriceRevision(revision: SupplierPriceRevision) {
  if (
    !revision.id.trim() ||
    !revision.deploymentId.trim() ||
    !revision.executionChannelId?.trim()
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'SupplierPriceRevision requires id, deploymentId, and executionChannelId.'
    );
  }
  if (!Number.isFinite(revision.amountMicros) || revision.amountMicros < 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'SupplierPriceRevision.amountMicros must be a non-negative finite number.'
    );
  }
  if (
    ![
      'standard',
      'cache_hit',
      'batch',
      'long_context',
      'package_volume',
    ].includes(revision.pricingTier ?? '')
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'SupplierPriceRevision.pricingTier is invalid.'
    );
  }
  assertPricingEvidence(revision.evidence);
}

function assertPricingEvidence(evidence: PricingEvidence) {
  if (
    evidence.source !== 'invoice' &&
    evidence.source !== 'observed_usage' &&
    evidence.source !== 'gateway_estimate'
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'PricingEvidence.source must be invoice | observed_usage | gateway_estimate.'
    );
  }
}

/**
 * Build a ProviderCostEvent fact for the appendProviderCost chain, carrying
 * supply freeze references in evidence (foundation-ledger bridge is Z2-WIRING).
 */
export function buildProviderCostEventFromFreeze(input: {
  freeze: SupplyRequestFreeze;
  attemptId: string;
  stage: ProviderCostEvent['stage'];
  amountMicros: number | null;
  actorId: string;
  correlationId: string;
  createdAt: string;
  payer?: ProviderCostEvent['payer'];
  billingStatus?: ProviderCostEvent['billingStatus'];
}): Omit<ProviderCostEvent, 'workspaceId'> & { workspaceId: string } {
  const { freeze } = input;
  return {
    id: `provider-cost:${input.attemptId}:${input.stage}`,
    workspaceId: freeze.workspaceId,
    attemptId: input.attemptId,
    stage: input.stage,
    amountMicros: input.amountMicros,
    currency: freeze.supplierPriceRevision.currency,
    unit: freeze.supplierPriceRevision.unit,
    evidence: [
      `supplierPriceRevision=${freeze.supplierPriceRevision.id}`,
      `routeSnapshotRef=${freeze.routeSnapshotRef}`,
      `credentialAccountVersion=${freeze.credentialAccountVersion}`,
      `supplierRequestTaskId=${freeze.supplierRequestTaskId}`,
      `pricingEvidence=${freeze.supplierPriceRevision.evidence.source}`,
      `supplyPoolId=${freeze.supplyPoolId}`,
    ].join(';'),
    payer: input.payer ?? 'platform',
    ...(input.billingStatus ? { billingStatus: input.billingStatus } : {}),
    actorId: input.actorId,
    correlationId: input.correlationId,
    createdAt: input.createdAt,
  };
}

/**
 * Durable ProductUsage lookup shared by HTTP and Worker assemblies.
 */
export interface SupplySideProductUsageLookup {
  getUsage(
    taskId: string,
    workspaceId: string,
  ): ProductUsageRecord | null | Promise<ProductUsageRecord | null>;
}

/**
 * Validate and link a supply freeze to an already-reserved ProductUsage (#92).
 * Persistence belongs to the injected SupplyRequestFreeze store so the link is
 * visible across processes; this bridge deliberately owns no process-local map.
 */
export class SupplySideProductUsageBridge {
  constructor(private readonly productUsage: SupplySideProductUsageLookup) {}

  async attachFreeze(
    taskId: string,
    freeze: SupplyRequestFreeze,
  ): Promise<SupplyRequestFreeze> {
    const usage = await this.productUsage.getUsage(taskId, freeze.workspaceId);
    if (!usage) {
      throw new P1DomainError(
        'NOT_FOUND',
        `ProductUsage for task ${taskId} not found; reserve via #92 first.`
      );
    }
    if (usage.workspaceId !== freeze.workspaceId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Supply freeze workspace must match ProductUsage workspace.'
      );
    }
    if (usage.status !== 'reserved') {
      throw new P1DomainError(
        'INVALID_STATE',
        `ProductUsage for task ${taskId} must be reserved before supplier dispatch.`,
      );
    }
    return buildSupplyRequestFreeze({
      ...freeze,
      productUsageTaskId: taskId,
    });
  }

  getProductUsage(taskId: string, workspaceId: string) {
    return this.productUsage.getUsage(taskId, workspaceId);
  }
}

export class SupplierVarianceLedger {
  private readonly rows: SupplierLevelVariance[] = [];

  record(input: Omit<SupplierLevelVariance, 'allocation'>): SupplierLevelVariance {
    if (!Number.isFinite(input.amountMicros) || input.amountMicros < 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Supplier variance amountMicros must be a non-negative finite number.'
      );
    }
    const existing = this.rows.find((row) => row.id === input.id);
    if (existing) {
      if (
        existing.supplyAccountId !== input.supplyAccountId ||
        existing.amountMicros !== input.amountMicros
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          `Supplier variance ${input.id} already exists with different facts.`
        );
      }
      return structuredClone(existing);
    }
    const row: SupplierLevelVariance = {
      ...input,
      allocation: 'supplier_unallocated',
    };
    this.rows.push(row);
    return structuredClone(row);
  }

  listForSupplyAccount(supplyAccountId: string): SupplierLevelVariance[] {
    return this.rows
      .filter((row) => row.supplyAccountId === supplyAccountId)
      .map((row) => structuredClone(row));
  }

  totalMicros(supplyAccountId: string): number {
    return this.listForSupplyAccount(supplyAccountId).reduce(
      (sum, row) => sum + row.amountMicros,
      0
    );
  }
}

/**
 * Project user-facing cost. Supplier variance is explicitly excluded.
 */
export function projectUserFacingCost(input: {
  workspaceId: string;
  productUsage?: ProductUsageRecord | null;
  chargedAmount: number;
  currency: string;
  /** Present only to assert it is NOT allocated. */
  supplierVariance?: SupplierLevelVariance[];
}): UserFacingCostProjection {
  if (input.supplierVariance?.some((row) => row.allocation !== 'supplier_unallocated')) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Supplier-level variance must remain supplier_unallocated; cannot project onto users.'
    );
  }
  return {
    workspaceId: input.workspaceId,
    ...(input.productUsage
      ? {
          productUsage: {
            taskId: input.productUsage.taskId,
            settledQuantity: input.productUsage.settledQuantity,
            reservedQuantity: input.productUsage.reservedQuantity,
            status: input.productUsage.status,
          },
        }
      : {}),
    chargedAmount: input.chargedAmount,
    currency: input.currency,
    supplierVarianceAllocated: false,
  };
}

/**
 * Assert grant/consume idempotency keys stay independent (MkImage lesson).
 * Re-exported convenience for H2 acceptance tests.
 */
export function assertGrantConsumeIdempotencySeparation(
  grantKey: string,
  consumeKey: string
): void {
  assertIndependentGrantConsumeIdempotencyKeys(grantKey, consumeKey);
  // Preferred H2 form uses explicit namespaces; bare consume keys still pass
  // independence as long as they do not equal / prefix-collide with grant.
  if (!grantKey.startsWith(GRANT_IDEMPOTENCY_KEY_PREFIX)) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Grant key should start with ${GRANT_IDEMPOTENCY_KEY_PREFIX}.`
    );
  }
  if (consumeKey.startsWith(GRANT_IDEMPOTENCY_KEY_PREFIX)) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Consume key must not start with ${GRANT_IDEMPOTENCY_KEY_PREFIX}.`
    );
  }
}
