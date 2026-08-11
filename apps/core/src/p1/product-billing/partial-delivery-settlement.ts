/**
 * Partial delivery credit settlement (V31-16 / V3.1 §24.2).
 *
 * A 6-page note where 5 pages landed must charge 5 pages, keep the 5, redo only
 * the failed one, and return the failed page's credits when the model's failure
 * policy says so. This module owns that single piece of arithmetic so the
 * merchant sentence in the steering impact and the number written to the credit
 * ledger cannot drift apart.
 *
 * Credits only — never provider currency, tokens, or USD (D-061).
 */

import { P1DomainError } from '../foundation/domain.js';

/** Physical delivery facts observed by the executor, never client input. */
export type PartialDeliveryBasis = {
  /** Billable units the quote was frozen against (note pages, images, …). */
  totalUnits: number;
  /** Units that actually reached a delivered result. */
  deliveredUnits: number;
};

export type PartialCreditSettlement = {
  totalUnits: number;
  deliveredUnits: number;
  failedUnits: number;
  reservedCredits: number;
  /** Credits that stay charged for what was delivered. */
  settledCredits: number;
  /** Credits returned to the workspace balance for failed units. */
  refundCredits: number;
  /** The model-operation failure policy frozen with the quote. */
  failureRefundsCredits: boolean;
  /** Merchant-facing refund rule (积分口径). */
  refundRule: string;
};

/** Delivery evidence keyed to the immutable package allocation id. */
export type PackagePartialDeliveryBasis = {
  allocations: Array<{
    allocationId: string;
    deliveredUnits: number;
  }>;
};

/** Result of settling every independently priced package allocation. */
export type PackagePartialCreditSettlement = {
  allocations: Array<PartialCreditSettlement & { allocationId: string }>;
  reservedCredits: number;
  settledCredits: number;
  refundCredits: number;
};

type PackageCreditAllocation = {
  allocationId: string;
  deliveryUnits: number;
  creditCost: number;
  failureRefundsCredits: boolean;
};

export function isPartialDeliveryBasis(
  value: unknown,
): value is PartialDeliveryBasis {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(candidate.totalUnits) &&
    Number.isSafeInteger(candidate.deliveredUnits) &&
    (candidate.totalUnits as number) > 0 &&
    (candidate.deliveredUnits as number) >= 0 &&
    (candidate.deliveredUnits as number) <= (candidate.totalUnits as number)
  );
}

export function isPackagePartialDeliveryBasis(
  value: unknown,
): value is PackagePartialDeliveryBasis {
  if (!value || typeof value !== 'object') return false;
  const allocations = (value as Record<string, unknown>).allocations;
  return (
    Array.isArray(allocations) &&
    allocations.length > 0 &&
    allocations.every((allocation) => {
      if (!allocation || typeof allocation !== 'object') return false;
      const candidate = allocation as Record<string, unknown>;
      return (
        typeof candidate.allocationId === 'string' &&
        candidate.allocationId.trim().length > 0 &&
        Number.isSafeInteger(candidate.deliveredUnits) &&
        (candidate.deliveredUnits as number) >= 0
      );
    })
  );
}

/**
 * Pro-rate a frozen credit reservation across delivered / failed units.
 *
 * `failureRefundsCredits === false` keeps every credit charged: the merchant was
 * shown that policy with the quote, so silently refunding would contradict the
 * price she accepted. The failed unit is still redoable either way.
 */
export function computePartialCreditSettlement(input: {
  reservedCredits: number;
  failureRefundsCredits: boolean;
} & PartialDeliveryBasis): PartialCreditSettlement {
  if (!isPartialDeliveryBasis(input)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Partial delivery settlement requires 0 <= deliveredUnits <= totalUnits with a positive totalUnits.',
    );
  }
  if (!Number.isSafeInteger(input.reservedCredits) || input.reservedCredits < 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Partial delivery settlement requires non-negative integer reserved credits.',
    );
  }
  const failedUnits = input.totalUnits - input.deliveredUnits;
  const refundCredits =
    failedUnits > 0 && input.failureRefundsCredits
      ? input.reservedCredits -
        Math.round((input.reservedCredits * input.deliveredUnits) / input.totalUnits)
      : 0;
  const settledCredits = input.reservedCredits - refundCredits;
  return {
    totalUnits: input.totalUnits,
    deliveredUnits: input.deliveredUnits,
    failedUnits,
    reservedCredits: input.reservedCredits,
    settledCredits,
    refundCredits,
    failureRefundsCredits: input.failureRefundsCredits,
    refundRule: partialDeliveryRefundRule({
      failedUnits,
      refundCredits,
      failureRefundsCredits: input.failureRefundsCredits,
    }),
  };
}

/**
 * Settle a package allocation-by-allocation. A package intentionally never
 * uses a global delivered/total ratio: heterogeneous carrier prices make that
 * arithmetic financially wrong.
 */
export function computePackagePartialCreditSettlement(input: {
  allocations: readonly PackageCreditAllocation[];
  partialDelivery: PackagePartialDeliveryBasis;
}): PackagePartialCreditSettlement {
  if (!isPackagePartialDeliveryBasis(input.partialDelivery)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Package partial delivery settlement requires allocation delivery evidence.',
    );
  }
  if (input.allocations.length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Package partial delivery settlement requires at least one allocation.',
    );
  }

  const frozenById = new Map<string, PackageCreditAllocation>();
  for (const allocation of input.allocations) {
    if (
      !allocation.allocationId.trim() ||
      !Number.isSafeInteger(allocation.deliveryUnits) ||
      allocation.deliveryUnits < 1 ||
      !Number.isSafeInteger(allocation.creditCost) ||
      allocation.creditCost < 0
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Package quote contains an invalid credit allocation.',
      );
    }
    if (frozenById.has(allocation.allocationId)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Package quote contains duplicate allocation ${allocation.allocationId}.`,
      );
    }
    frozenById.set(allocation.allocationId, allocation);
  }

  const deliveredById = new Map<string, number>();
  for (const delivered of input.partialDelivery.allocations) {
    if (deliveredById.has(delivered.allocationId)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Package partial delivery contains duplicate allocation ${delivered.allocationId}.`,
      );
    }
    const frozen = frozenById.get(delivered.allocationId);
    if (!frozen) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Package partial delivery contains unknown allocation ${delivered.allocationId}.`,
      );
    }
    if (delivered.deliveredUnits > frozen.deliveryUnits) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Package allocation ${delivered.allocationId} delivered more than its frozen units.`,
      );
    }
    deliveredById.set(delivered.allocationId, delivered.deliveredUnits);
  }
  if (deliveredById.size !== frozenById.size) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Package partial delivery must include every frozen allocation exactly once.',
    );
  }

  const allocations = input.allocations.map((allocation) => ({
    allocationId: allocation.allocationId,
    ...computePartialCreditSettlement({
      totalUnits: allocation.deliveryUnits,
      deliveredUnits: deliveredById.get(allocation.allocationId)!,
      reservedCredits: allocation.creditCost,
      failureRefundsCredits: allocation.failureRefundsCredits,
    }),
  }));
  return allocations.reduce<PackagePartialCreditSettlement>(
    (total, allocation) => ({
      allocations: [...total.allocations, allocation],
      reservedCredits: total.reservedCredits + allocation.reservedCredits,
      settledCredits: total.settledCredits + allocation.settledCredits,
      refundCredits: total.refundCredits + allocation.refundCredits,
    }),
    {
      allocations: [],
      reservedCredits: 0,
      settledCredits: 0,
      refundCredits: 0,
    },
  );
}

/** Merchant-facing refund sentence shared by steering impact and delivery report. */
export function partialDeliveryRefundRule(input: {
  failedUnits: number;
  refundCredits: number;
  failureRefundsCredits: boolean;
}): string {
  if (input.failedUnits === 0) return '无失败页，不退费。';
  if (input.refundCredits > 0) {
    return `失败页按模型失败退还开关退回 ${input.refundCredits} 积分；成功页保留且不重做。`;
  }
  if (!input.failureRefundsCredits) {
    return '失败页可重做，但当前模型关闭失败退还，已扣积分不退；成功页保留。';
  }
  return '失败页可重做；无已扣积分需退还。成功页保留。';
}
