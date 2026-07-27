/**
 * ProductUsage ledger for task-level product charge (#92 / D-088).
 *
 * One task → one idempotent reserve/settle. Quantities are integer merchant
 * entitlement units and never reuse monetary quote amounts.
 *
 * Independent of GrantLot (allowance source/FIFO) and ProviderCost
 * (supply-side append-only). Does not merge chains.
 */

import type {
  ProductBillingMode,
  ProductSettlementStatus,
  ProductUsageRecord,
  ProductUsageUnit,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';

export type ReserveProductUsageInput = {
  id: string;
  taskId: string;
  workspaceId: string;
  quoteId: string;
  units?: ProductUsageUnit[];
  /** Legacy internal adapter input; quote lifecycle callers use units. */
  quantity?: number;
  billingMode: ProductBillingMode;
  resource?: ProductUsageRecord['resource'];
  createdAt: string;
};

export type SettleProductUsageInput = {
  taskId: string;
  settledUnits?: ProductUsageUnit[];
  /** Legacy internal adapter input; quote lifecycle callers use settledUnits. */
  settledQuantity?: number;
  settlementStatus: ProductSettlementStatus;
  updatedAt: string;
};

export type RefundProductUsageInput = {
  taskId: string;
  /** Absolute per-bucket units to leave charged; defaults to full release. */
  remainingUnits?: ProductUsageUnit[];
  /** Legacy internal adapter input. */
  remainingQuantity?: number;
  updatedAt: string;
};

export interface ProductUsageLedger {
  reserve(input: ReserveProductUsageInput): ProductUsageRecord;
  settle(input: SettleProductUsageInput): ProductUsageRecord;
  refund(input: RefundProductUsageInput): ProductUsageRecord;
  getByTask(taskId: string): ProductUsageRecord | null;
  listByWorkspace(workspaceId: string): ProductUsageRecord[];
  /** Repository adapters may hydrate one transaction-local memory ledger. */
  restore?(record: ProductUsageRecord): void;
}

function assertNonNegativeQuantity(quantity: number, field: string) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${field} must be a non-negative integer product usage quantity.`,
    );
  }
}

/**
 * In-memory ProductUsage ledger.
 * Stores whole merchant entitlement units (copy, image, or video tickets).
 */
export class MemoryProductUsageLedger implements ProductUsageLedger {
  private readonly byTask = new Map<string, ProductUsageRecord>();
  private readonly byId = new Map<string, ProductUsageRecord>();

  reserve(input: ReserveProductUsageInput): ProductUsageRecord {
    const reservedUnits = normalizeUnits(
      input.units ??
        legacyUnits(input.resource, input.quantity ?? 0),
      'units',
    );
    const reservedQuantity = totalUnits(reservedUnits);
    if (!input.taskId.trim() || !input.quoteId.trim() || !input.workspaceId.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Product usage reserve requires taskId, quoteId, and workspaceId.',
      );
    }

    const existing = this.byTask.get(input.taskId);
    if (existing) {
      // One task one reserve — idempotent when same identity/quantity.
      if (
        existing.quoteId !== input.quoteId ||
        !sameUnits(reservedProductUsageUnits(existing), reservedUnits) ||
        existing.workspaceId !== input.workspaceId
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          `Product usage for task ${input.taskId} is already reserved with different facts.`,
        );
      }
      return structuredClone(existing);
    }

    const record: ProductUsageRecord = {
      id: input.id,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      quoteId: input.quoteId,
      status: 'reserved',
      reservedQuantity,
      reservedUnits,
      settledQuantity: 0,
      settledUnits: [],
      refundedQuantity: 0,
      refundedUnits: [],
      billingMode: input.billingMode,
      settlementStatus: 'estimated',
      ...(reservedUnits.length === 1
        ? { resource: reservedUnits[0]!.resource }
        : {}),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.byTask.set(input.taskId, record);
    this.byId.set(input.id, record);
    return structuredClone(record);
  }

  settle(input: SettleProductUsageInput): ProductUsageRecord {
    const existing = this.byTask.get(input.taskId);
    if (!existing) {
      throw new P1DomainError(
        'NOT_FOUND',
        `No product usage reservation for task ${input.taskId}.`,
      );
    }
    const settledUnits = normalizeUnits(
      input.settledUnits ??
        legacyUnits(existing.resource, input.settledQuantity ?? 0),
      'settledUnits',
    );
    const settledQuantity = totalUnits(settledUnits);

    // Idempotent settle: same settled quantity + status returns existing.
    if (
      existing.status === 'committed' ||
      existing.status === 'partially_refunded' ||
      existing.status === 'refunded'
    ) {
      if (
        sameUnits(settledProductUsageUnits(existing), settledUnits) &&
        existing.settlementStatus === input.settlementStatus
      ) {
        return structuredClone(existing);
      }
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Product usage for task ${input.taskId} is already settled.`,
      );
    }

    assertUnitsWithin(
      settledUnits,
      reservedProductUsageUnits(existing),
      'Settled product quantity cannot exceed reserved product units.',
    );
    if (settledQuantity > existing.reservedQuantity) {
      // Product side never silent-surcharges past the reserved ceiling.
      throw new P1DomainError(
        'INVALID_STATE',
        'Settled product quantity cannot exceed reserved authorized ceiling.',
      );
    }

    const refundedUnits = subtractUnits(
      reservedProductUsageUnits(existing),
      settledUnits,
    );
    const refundedQuantity = totalUnits(refundedUnits);
    const status: ProductUsageRecord['status'] =
      refundedQuantity === 0
        ? 'committed'
        : settledQuantity === 0
          ? 'refunded'
          : 'partially_refunded';

    const next: ProductUsageRecord = {
      ...existing,
      status,
      settledQuantity,
      settledUnits,
      refundedQuantity,
      refundedUnits,
      settlementStatus: input.settlementStatus,
      updatedAt: input.updatedAt,
    };
    this.byTask.set(input.taskId, next);
    this.byId.set(next.id, next);
    return structuredClone(next);
  }

  refund(input: RefundProductUsageInput): ProductUsageRecord {
    const existing = this.byTask.get(input.taskId);
    if (!existing) {
      throw new P1DomainError(
        'NOT_FOUND',
        `No product usage reservation for task ${input.taskId}.`,
      );
    }

    const remainingUnits = normalizeUnits(
      input.remainingUnits ??
        legacyUnits(existing.resource, input.remainingQuantity ?? 0),
      'remainingUnits',
    );
    const remaining = totalUnits(remainingUnits);
    assertUnitsWithin(
      remainingUnits,
      reservedProductUsageUnits(existing),
      'Refund remaining quantity cannot exceed reserved product units.',
    );
    if (remaining > existing.reservedQuantity) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Refund remaining quantity cannot exceed reserved quantity.',
      );
    }

    // Idempotent full/partial refund when already at target.
    if (
      sameUnits(settledProductUsageUnits(existing), remainingUnits) &&
      (existing.status === 'refunded' ||
        existing.status === 'partially_refunded' ||
        (existing.status === 'committed' && remaining === existing.reservedQuantity))
    ) {
      return structuredClone(existing);
    }

    if (
      existing.status === 'committed' ||
      existing.status === 'partially_refunded' ||
      existing.status === 'refunded'
    ) {
      // Already settled path: only allow lowering settled quantity once more via settle rules.
      assertUnitsWithin(
        remainingUnits,
        settledProductUsageUnits(existing),
        'Cannot increase settled product units via refund.',
      );
      if (remaining > existing.settledQuantity) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Cannot increase settled product quantity via refund.',
        );
      }
    }

    const refundedUnits = subtractUnits(
      reservedProductUsageUnits(existing),
      remainingUnits,
    );
    const refundedQuantity = totalUnits(refundedUnits);
    const status: ProductUsageRecord['status'] =
      remaining === 0
        ? 'refunded'
        : remaining === existing.reservedQuantity
          ? 'committed'
          : 'partially_refunded';

    const next: ProductUsageRecord = {
      ...existing,
      status,
      settledQuantity: remaining,
      settledUnits: remainingUnits,
      refundedQuantity,
      refundedUnits,
      settlementStatus:
        remaining === 0 ? 'reconciled' : existing.settlementStatus,
      updatedAt: input.updatedAt,
    };
    this.byTask.set(input.taskId, next);
    this.byId.set(next.id, next);
    return structuredClone(next);
  }

  getByTask(taskId: string): ProductUsageRecord | null {
    const record = this.byTask.get(taskId);
    return record ? structuredClone(record) : null;
  }

  listByWorkspace(workspaceId: string): ProductUsageRecord[] {
    return [...this.byTask.values()]
      .filter((record) => record.workspaceId === workspaceId)
      .map((record) => structuredClone(record));
  }

  restore(record: ProductUsageRecord) {
    this.byTask.set(record.taskId, structuredClone(record));
    this.byId.set(record.id, structuredClone(record));
  }
}

export function reservedProductUsageUnits(
  record: ProductUsageRecord,
): ProductUsageUnit[] {
  return record.reservedUnits
    ? normalizeUnits(record.reservedUnits, 'reservedUnits')
    : legacyUnits(record.resource, record.reservedQuantity);
}

export function settledProductUsageUnits(
  record: ProductUsageRecord,
): ProductUsageUnit[] {
  return record.settledUnits
    ? normalizeUnits(record.settledUnits, 'settledUnits')
    : legacyUnits(record.resource, record.settledQuantity);
}

export function refundedProductUsageUnits(
  record: ProductUsageRecord,
): ProductUsageUnit[] {
  return record.refundedUnits
    ? normalizeUnits(record.refundedUnits, 'refundedUnits')
    : legacyUnits(record.resource, record.refundedQuantity);
}

export function grantLotUsageOperationId(
  taskId: string,
  resource: ProductUsageUnit['resource'],
  resourceCount: number,
) {
  return resourceCount === 1
    ? `product-usage:${taskId}`
    : `product-usage:${taskId}:${resource}`;
}

function normalizeUnits(units: ProductUsageUnit[], field: string) {
  const normalized = [...units]
    .map((unit) => {
      assertNonNegativeQuantity(unit.quantity, `${field}.${unit.resource}`);
      return { resource: unit.resource, quantity: unit.quantity };
    })
    .filter((unit) => unit.quantity > 0)
    .sort((left, right) => left.resource.localeCompare(right.resource));
  if (
    normalized.some(
      (unit, index) => normalized[index - 1]?.resource === unit.resource,
    )
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${field} must contain at most one quantity per product resource.`,
    );
  }
  return normalized;
}

function legacyUnits(
  resource: ProductUsageRecord['resource'],
  quantity: number,
) {
  return resource && quantity > 0 ? [{ resource, quantity }] : [];
}

function totalUnits(units: ProductUsageUnit[]) {
  return units.reduce((total, unit) => total + unit.quantity, 0);
}

function sameUnits(left: ProductUsageUnit[], right: ProductUsageUnit[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertUnitsWithin(
  candidate: ProductUsageUnit[],
  ceiling: ProductUsageUnit[],
  message: string,
) {
  const ceilingByResource = new Map(
    ceiling.map((unit) => [unit.resource, unit.quantity]),
  );
  if (
    candidate.some(
      (unit) => unit.quantity > (ceilingByResource.get(unit.resource) ?? 0),
    )
  ) {
    throw new P1DomainError('INVALID_STATE', message);
  }
}

function subtractUnits(
  minuend: ProductUsageUnit[],
  subtrahend: ProductUsageUnit[],
) {
  const subtrahendByResource = new Map(
    subtrahend.map((unit) => [unit.resource, unit.quantity]),
  );
  return minuend
    .map((unit) => ({
      resource: unit.resource,
      quantity:
        unit.quantity - (subtrahendByResource.get(unit.resource) ?? 0),
    }))
    .filter((unit) => unit.quantity > 0);
}
