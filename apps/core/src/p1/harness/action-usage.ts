import {
  actionUsageSchema,
  type ActionUsage,
  type ProductUsageRecord,
} from '@meiye/contracts';

/**
 * Whether the ProductUsage ledger already shows merchant value returned.
 *
 * Credit-era full refunds keep `refundedQuantity` at 0 (empty reserved units)
 * while setting `status='refunded'` and `refundedCredits`. Unit-era refunds
 * populate `refundedQuantity`. Either signal means the merchant card may say
 * 积分已退回 instead of 处理中.
 */
export function productUsageRefundLanded(
  usage: ProductUsageRecord | null | undefined,
): boolean {
  if (!usage) return false;
  if (usage.status === 'refunded') return true;
  if ((usage.refundedCredits ?? 0) > 0) return true;
  if (usage.refundedQuantity > 0) return true;
  return false;
}

export function projectActionUsage(
  usage: ProductUsageRecord,
  status: ActionUsage['status'],
): ActionUsage | null {
  if (usage.status === 'reserved') {
    return null;
  }
  if (status === 'rejected' && usage.settledQuantity !== 0) {
    throw new Error('Rejected actions must settle zero merchant units.');
  }
  return actionUsageSchema.parse({
    actionId: usage.id,
    taskId: usage.taskId,
    status,
    settlementStatus: usage.settlementStatus,
    settledUnits: usage.settledQuantity,
    refundedUnits: usage.refundedQuantity,
  });
}
