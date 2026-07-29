import {
  actionUsageSchema,
  type ActionUsage,
  type ProductUsageRecord,
} from '@meiye/contracts';

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
