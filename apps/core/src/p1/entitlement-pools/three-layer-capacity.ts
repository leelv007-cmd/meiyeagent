/**
 * Three-layer capacity model (H2 / D-066 ④):
 *   1. supply-account  — upstream CredentialAccount concurrency / RPM / TPM
 *   2. product-account — product-side concurrency / queue priority
 *   3. system-total    — platform-wide concurrency ceiling
 *
 * Multiple product accounts sharing one supply account cannot bypass the
 * supply-account or system-total limits by stacking product-side caps.
 *
 * Product-side per-workspace concurrency gates already exist on PgBoss —
 * this module models supply-side admission only; it does not rebuild them.
 */

import type { SupplyCapacityLimits } from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';

export type CapacityLayer = 'supply_account' | 'product_account' | 'system_total';

export type ThreeLayerCapacityLimits = {
  /** Upstream shared CredentialAccount / supply-account capacity. */
  supplyAccount: { concurrency: number; rpm?: number; tpm?: number };
  /** Product account (login principal) concurrency / priority. */
  productAccount: { concurrency: number; queuePriority?: number };
  /** Platform-wide total concurrency. */
  systemTotal: { concurrency: number };
};

export type CapacityLease = {
  leaseId: string;
  supplyAccountId: string;
  productAccountId: string;
  workspaceId: string;
  acquiredAt: string;
};

export type CapacityAdmissionDecision =
  | { status: 'admitted'; lease: CapacityLease }
  | {
      status: 'rejected';
      layer: CapacityLayer;
      code: 'CAPACITY_EXHAUSTED';
      message: string;
      inUse: number;
      limit: number;
    };

export type CapacityUsageSnapshot = {
  supplyAccountId: string;
  supplyAccountInUse: number;
  supplyAccountLimit: number;
  productAccounts: Array<{
    productAccountId: string;
    inUse: number;
    limit: number;
  }>;
  systemTotalInUse: number;
  systemTotalLimit: number;
};

function assertPositiveInt(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${field} must be a positive integer.`
    );
  }
}

export function normalizeThreeLayerLimits(
  limits: SupplyCapacityLimits | ThreeLayerCapacityLimits
): ThreeLayerCapacityLimits {
  const supplyConcurrency =
    'supplyAccount' in limits && limits.supplyAccount
      ? (limits.supplyAccount as { concurrency?: number }).concurrency
      : undefined;
  const productConcurrency =
    'productAccount' in limits && limits.productAccount
      ? (limits.productAccount as { concurrency?: number }).concurrency
      : undefined;
  const systemConcurrency =
    'systemTotal' in limits && limits.systemTotal
      ? (limits.systemTotal as { concurrency?: number }).concurrency
      : undefined;

  if (
    supplyConcurrency === undefined ||
    productConcurrency === undefined ||
    systemConcurrency === undefined
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Three-layer capacity requires supplyAccount, productAccount, and systemTotal concurrency.'
    );
  }

  assertPositiveInt(supplyConcurrency, 'supplyAccount.concurrency');
  assertPositiveInt(productConcurrency, 'productAccount.concurrency');
  assertPositiveInt(systemConcurrency, 'systemTotal.concurrency');

  const supply = limits.supplyAccount as ThreeLayerCapacityLimits['supplyAccount'];
  const product = limits.productAccount as ThreeLayerCapacityLimits['productAccount'];

  return {
    supplyAccount: {
      concurrency: supplyConcurrency,
      ...(typeof supply.rpm === 'number' ? { rpm: supply.rpm } : {}),
      ...(typeof supply.tpm === 'number' ? { tpm: supply.tpm } : {}),
    },
    productAccount: {
      concurrency: productConcurrency,
      ...(typeof product.queuePriority === 'number'
        ? { queuePriority: product.queuePriority }
        : {}),
    },
    systemTotal: { concurrency: systemConcurrency },
  };
}

/**
 * In-memory three-layer capacity gate for a single supply account scope.
 * Negative invariant: sum(product-account in-use) ≤ supply-account limit
 * and ≤ system-total limit, regardless of how many product accounts stack.
 */
export class ThreeLayerCapacityGate {
  private readonly leases = new Map<string, CapacityLease>();
  private seq = 0;
  private readonly limits: ThreeLayerCapacityLimits;
  private readonly productLimits = new Map<string, number>();

  constructor(
    private readonly supplyAccountId: string,
    limits: SupplyCapacityLimits | ThreeLayerCapacityLimits,
    private readonly clock: () => Date = () => new Date()
  ) {
    this.limits = normalizeThreeLayerLimits(limits);
  }

  /** Override product-account concurrency for a specific account (plan/allocation). */
  setProductAccountLimit(productAccountId: string, concurrency: number) {
    assertPositiveInt(concurrency, 'productAccount.concurrency');
    this.productLimits.set(productAccountId, concurrency);
  }

  getLimits(): ThreeLayerCapacityLimits {
    return structuredClone(this.limits);
  }

  tryAcquire(input: {
    productAccountId: string;
    workspaceId: string;
    leaseId?: string;
  }): CapacityAdmissionDecision {
    if (!input.productAccountId.trim() || !input.workspaceId.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Capacity acquire requires productAccountId and workspaceId.'
      );
    }

    const supplyInUse = this.countSupplyInUse();
    if (supplyInUse >= this.limits.supplyAccount.concurrency) {
      return {
        status: 'rejected',
        layer: 'supply_account',
        code: 'CAPACITY_EXHAUSTED',
        message:
          `Supply-account ${this.supplyAccountId} concurrency exhausted ` +
          `(${supplyInUse}/${this.limits.supplyAccount.concurrency}).`,
        inUse: supplyInUse,
        limit: this.limits.supplyAccount.concurrency,
      };
    }

    const systemInUse = this.leases.size;
    if (systemInUse >= this.limits.systemTotal.concurrency) {
      return {
        status: 'rejected',
        layer: 'system_total',
        code: 'CAPACITY_EXHAUSTED',
        message:
          `System-total concurrency exhausted ` +
          `(${systemInUse}/${this.limits.systemTotal.concurrency}).`,
        inUse: systemInUse,
        limit: this.limits.systemTotal.concurrency,
      };
    }

    const productLimit =
      this.productLimits.get(input.productAccountId) ??
      this.limits.productAccount.concurrency;
    const productInUse = this.countProductInUse(input.productAccountId);
    if (productInUse >= productLimit) {
      return {
        status: 'rejected',
        layer: 'product_account',
        code: 'CAPACITY_EXHAUSTED',
        message:
          `Product-account ${input.productAccountId} concurrency exhausted ` +
          `(${productInUse}/${productLimit}).`,
        inUse: productInUse,
        limit: productLimit,
      };
    }

    const lease: CapacityLease = {
      leaseId: input.leaseId ?? `lease:${++this.seq}`,
      supplyAccountId: this.supplyAccountId,
      productAccountId: input.productAccountId,
      workspaceId: input.workspaceId,
      acquiredAt: this.clock().toISOString(),
    };
    if (this.leases.has(lease.leaseId)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Capacity lease ${lease.leaseId} already exists.`
      );
    }
    this.leases.set(lease.leaseId, lease);
    return { status: 'admitted', lease: structuredClone(lease) };
  }

  release(leaseId: string): boolean {
    return this.leases.delete(leaseId);
  }

  snapshot(): CapacityUsageSnapshot {
    const byProduct = new Map<string, number>();
    for (const lease of this.leases.values()) {
      byProduct.set(
        lease.productAccountId,
        (byProduct.get(lease.productAccountId) ?? 0) + 1
      );
    }
    return {
      supplyAccountId: this.supplyAccountId,
      supplyAccountInUse: this.countSupplyInUse(),
      supplyAccountLimit: this.limits.supplyAccount.concurrency,
      productAccounts: [...byProduct.entries()].map(
        ([productAccountId, inUse]) => ({
          productAccountId,
          inUse,
          limit:
            this.productLimits.get(productAccountId) ??
            this.limits.productAccount.concurrency,
        })
      ),
      systemTotalInUse: this.leases.size,
      systemTotalLimit: this.limits.systemTotal.concurrency,
    };
  }

  /**
   * Negative invariant helper: many product accounts cannot push total
   * in-use above the tighter of supply-account / system-total limits.
   */
  effectiveUpstreamCeiling(): number {
    return Math.min(
      this.limits.supplyAccount.concurrency,
      this.limits.systemTotal.concurrency
    );
  }

  private countSupplyInUse(): number {
    return this.leases.size;
  }

  private countProductInUse(productAccountId: string): number {
    let count = 0;
    for (const lease of this.leases.values()) {
      if (lease.productAccountId === productAccountId) count += 1;
    }
    return count;
  }
}
