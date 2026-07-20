/**
 * Attempt-level ProviderCostSnapshot builders (#92 / D-088).
 *
 * Product quote settles once per task; each ProviderAttempt freezes its own
 * supply-side cost facts. Fallback / overproduction deltas go here — never
 * as a second product charge.
 */

import type {
  ProductBillingMode,
  ProviderCostSnapshot,
  TrustedUsageEvidenceKind,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';

export type BuildProviderCostSnapshotInput = {
  attemptId: string;
  taskId: string;
  deploymentId: string;
  supplierPriceRevision: string;
  billingMode: ProductBillingMode;
  unitPriceMicros: number;
  currency: string;
  unit: string;
  estimatedCostMicros?: number | null;
  observedCostMicros?: number | null;
  usageQuantity?: number;
  usageUnit?: string;
  evidence?: string;
  evidenceKind?: TrustedUsageEvidenceKind | 'estimated' | 'unknown';
  supplyCostDeltaMicros?: number;
  payer?: 'platform' | 'workspace_byok';
};

const trustedKinds = new Set<string>([
  'provider_usage',
  'provider_bill',
  'media_duration',
]);

export function isTrustedUsageEvidence(
  kind: string | undefined,
): kind is TrustedUsageEvidenceKind {
  return kind !== undefined && trustedKinds.has(kind);
}

/**
 * Build a frozen attempt-level ProviderCostSnapshot.
 * Does not write ledgers — pure construction.
 */
export function buildProviderCostSnapshot(
  input: BuildProviderCostSnapshotInput,
): ProviderCostSnapshot {
  if (!input.attemptId.trim() || !input.taskId.trim() || !input.deploymentId.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'ProviderCostSnapshot requires attemptId, taskId, and deploymentId.',
    );
  }
  if (!input.supplierPriceRevision.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'ProviderCostSnapshot requires supplierPriceRevision.',
    );
  }

  const evidenceKind = input.evidenceKind ?? 'estimated';
  const billingStatus: ProviderCostSnapshot['billingStatus'] =
    evidenceKind === 'unknown'
      ? 'unknown'
      : isTrustedUsageEvidence(evidenceKind) &&
          input.observedCostMicros !== undefined &&
          input.observedCostMicros !== null
        ? 'known'
        : evidenceKind === 'estimated'
          ? 'estimated'
          : 'unknown';

  return {
    attemptId: input.attemptId,
    taskId: input.taskId,
    deploymentId: input.deploymentId,
    supplierPriceRevision: input.supplierPriceRevision,
    billingMode: input.billingMode,
    unitPriceMicros: input.unitPriceMicros,
    currency: input.currency,
    unit: input.unit,
    estimatedCostMicros:
      input.estimatedCostMicros === undefined ? null : input.estimatedCostMicros,
    ...(input.observedCostMicros !== undefined
      ? { observedCostMicros: input.observedCostMicros }
      : {}),
    ...(input.usageQuantity !== undefined
      ? { usageQuantity: input.usageQuantity }
      : {}),
    ...(input.usageUnit !== undefined ? { usageUnit: input.usageUnit } : {}),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    evidenceKind,
    ...(input.supplyCostDeltaMicros !== undefined
      ? { supplyCostDeltaMicros: input.supplyCostDeltaMicros }
      : {}),
    payer: input.payer ?? 'platform',
    billingStatus,
  };
}

/**
 * Record platform-absorbed supply cost when product ceiling caps the charge
 * but supplier usage exceeded the confirmed product amount.
 */
export function absorbOverproductionToSupplyCost(
  snapshot: ProviderCostSnapshot,
  overproductionCostMicros: number,
): ProviderCostSnapshot {
  if (
    typeof overproductionCostMicros !== 'number' ||
    !Number.isFinite(overproductionCostMicros) ||
    overproductionCostMicros < 0
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'overproductionCostMicros must be a finite non-negative number.',
    );
  }
  return {
    ...snapshot,
    supplyCostDeltaMicros:
      (snapshot.supplyCostDeltaMicros ?? 0) + overproductionCostMicros,
  };
}

/** In-memory store for attempt cost snapshots (tests / pure service). */
export class MemoryProviderCostSnapshotStore {
  private readonly byAttempt = new Map<string, ProviderCostSnapshot>();
  private readonly byTask = new Map<string, string[]>();

  save(snapshot: ProviderCostSnapshot): ProviderCostSnapshot {
    const existing = this.byAttempt.get(snapshot.attemptId);
    if (existing) {
      if (
        existing.taskId !== snapshot.taskId ||
        existing.deploymentId !== snapshot.deploymentId ||
        existing.supplierPriceRevision !== snapshot.supplierPriceRevision
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          `ProviderCostSnapshot ${snapshot.attemptId} already exists with different facts.`,
        );
      }
      // Allow supply-cost delta / observed cost updates on the same attempt.
      const merged: ProviderCostSnapshot = {
        ...existing,
        ...(snapshot.observedCostMicros !== undefined
          ? { observedCostMicros: snapshot.observedCostMicros }
          : {}),
        ...(snapshot.usageQuantity !== undefined
          ? { usageQuantity: snapshot.usageQuantity }
          : {}),
        ...(snapshot.supplyCostDeltaMicros !== undefined
          ? { supplyCostDeltaMicros: snapshot.supplyCostDeltaMicros }
          : {}),
        ...(snapshot.billingStatus
          ? { billingStatus: snapshot.billingStatus }
          : {}),
        ...(snapshot.evidenceKind
          ? { evidenceKind: snapshot.evidenceKind }
          : {}),
      };
      this.byAttempt.set(snapshot.attemptId, merged);
      return structuredClone(merged);
    }
    this.byAttempt.set(snapshot.attemptId, snapshot);
    const list = this.byTask.get(snapshot.taskId) ?? [];
    list.push(snapshot.attemptId);
    this.byTask.set(snapshot.taskId, list);
    return structuredClone(snapshot);
  }

  get(attemptId: string): ProviderCostSnapshot | null {
    const value = this.byAttempt.get(attemptId);
    return value ? structuredClone(value) : null;
  }

  listForTask(taskId: string): ProviderCostSnapshot[] {
    const ids = this.byTask.get(taskId) ?? [];
    return ids
      .map((id) => this.byAttempt.get(id))
      .filter((value): value is ProviderCostSnapshot => Boolean(value))
      .map((value) => structuredClone(value));
  }
}
