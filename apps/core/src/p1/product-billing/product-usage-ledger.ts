/**
 * ProductUsage ledger for task-level product charge (#92 / D-088).
 *
 * One task → one idempotent reserve/settle. Quantity may be fractional
 * (per_output_second); legacy 0|1 remains valid for per_request.
 *
 * Independent of GrantLot (allowance source/FIFO) and ProviderCost
 * (supply-side append-only). Does not merge chains.
 */

import type {
  ProductBillingMode,
  ProductSettlementStatus,
  ProductUsageRecord,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';

export type ReserveProductUsageInput = {
  id: string;
  taskId: string;
  workspaceId: string;
  quoteId: string;
  quantity: number;
  billingMode: ProductBillingMode;
  resource?: ProductUsageRecord['resource'];
  createdAt: string;
};

export type SettleProductUsageInput = {
  taskId: string;
  settledQuantity: number;
  settlementStatus: ProductSettlementStatus;
  updatedAt: string;
};

export type RefundProductUsageInput = {
  taskId: string;
  /** Absolute quantity to leave charged after refund; defaults to full release. */
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
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${field} must be a finite non-negative number.`,
    );
  }
}

/**
 * In-memory ProductUsage ledger.
 * Supports fractional product units for per_output_second settlement.
 */
export class MemoryProductUsageLedger implements ProductUsageLedger {
  private readonly byTask = new Map<string, ProductUsageRecord>();
  private readonly byId = new Map<string, ProductUsageRecord>();

  reserve(input: ReserveProductUsageInput): ProductUsageRecord {
    assertNonNegativeQuantity(input.quantity, 'quantity');
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
        existing.reservedQuantity !== input.quantity ||
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
      reservedQuantity: input.quantity,
      settledQuantity: 0,
      refundedQuantity: 0,
      billingMode: input.billingMode,
      settlementStatus: 'estimated',
      ...(input.resource ? { resource: input.resource } : {}),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.byTask.set(input.taskId, record);
    this.byId.set(input.id, record);
    return structuredClone(record);
  }

  settle(input: SettleProductUsageInput): ProductUsageRecord {
    assertNonNegativeQuantity(input.settledQuantity, 'settledQuantity');
    const existing = this.byTask.get(input.taskId);
    if (!existing) {
      throw new P1DomainError(
        'NOT_FOUND',
        `No product usage reservation for task ${input.taskId}.`,
      );
    }

    // Idempotent settle: same settled quantity + status returns existing.
    if (
      existing.status === 'committed' ||
      existing.status === 'partially_refunded' ||
      existing.status === 'refunded'
    ) {
      if (
        existing.settledQuantity === input.settledQuantity &&
        existing.settlementStatus === input.settlementStatus
      ) {
        return structuredClone(existing);
      }
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Product usage for task ${input.taskId} is already settled.`,
      );
    }

    if (input.settledQuantity > existing.reservedQuantity) {
      // Product side never silent-surcharges past the reserved ceiling.
      throw new P1DomainError(
        'INVALID_STATE',
        'Settled product quantity cannot exceed reserved authorized ceiling.',
      );
    }

    const refundedQuantity = existing.reservedQuantity - input.settledQuantity;
    const status: ProductUsageRecord['status'] =
      refundedQuantity === 0
        ? 'committed'
        : input.settledQuantity === 0
          ? 'refunded'
          : 'partially_refunded';

    const next: ProductUsageRecord = {
      ...existing,
      status,
      settledQuantity: input.settledQuantity,
      refundedQuantity,
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

    const remaining =
      input.remainingQuantity === undefined ? 0 : input.remainingQuantity;
    assertNonNegativeQuantity(remaining, 'remainingQuantity');
    if (remaining > existing.reservedQuantity) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Refund remaining quantity cannot exceed reserved quantity.',
      );
    }

    // Idempotent full/partial refund when already at target.
    if (
      existing.settledQuantity === remaining &&
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
      if (remaining > existing.settledQuantity) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Cannot increase settled product quantity via refund.',
        );
      }
    }

    const refundedQuantity = existing.reservedQuantity - remaining;
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
      refundedQuantity,
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
