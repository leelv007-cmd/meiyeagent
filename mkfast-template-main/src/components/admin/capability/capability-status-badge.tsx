import type {
  CapabilityAvailabilityStatus,
  CapabilityInstrumentStatus,
  CapabilityInventoryItemStatus,
} from '@meiye/contracts';

import { AdminStatusChip } from '@/components/admin/shell/admin-panel';
import {
  availabilityLabel,
  inventoryStatusLabel,
} from '@/p1/admin-capability-registry-model';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

function inventoryVariant(status: CapabilityInventoryItemStatus): BadgeVariant {
  switch (status) {
    case 'instrumented':
      return 'secondary';
    case 'stub':
      return 'outline';
    case 'not_instrumented':
    case 'not_in_scope_for_supply_v1':
      return 'outline';
    default:
      return 'outline';
  }
}

function availabilityVariant(
  status: CapabilityAvailabilityStatus
): BadgeVariant {
  switch (status) {
    case 'available':
      return 'secondary';
    case 'degraded':
    case 'attention':
    case 'stale':
      return 'outline';
    case 'blocked':
      return 'destructive';
    case 'not_verified':
    case 'not_instrumented':
      return 'outline';
    default:
      return 'outline';
  }
}

/** Inventory panorama status (instrumented | stub | …). No fake green. */
export function InventoryStatusBadge({
  status,
}: {
  status: CapabilityInventoryItemStatus;
}) {
  return (
    <AdminStatusChip
      variant={inventoryVariant(status)}
      data-testid="inventory-status-badge"
      data-status={status}
    >
      {inventoryStatusLabel(status)}
    </AdminStatusChip>
  );
}

/** Operator availability badge (honest; not_instrumented / not_verified visible). */
export function AvailabilityStatusBadge({
  status,
}: {
  status: CapabilityAvailabilityStatus;
}) {
  return (
    <AdminStatusChip
      variant={availabilityVariant(status)}
      data-testid="availability-status-badge"
      data-status={status}
    >
      {availabilityLabel(status)}
    </AdminStatusChip>
  );
}

export function InstrumentStatusBadge({
  status,
}: {
  status: CapabilityInstrumentStatus;
}) {
  const label =
    status === 'instrumented'
      ? '已插桩'
      : status === 'stub'
        ? '存根'
        : status === 'not_instrumented'
          ? '未插桩'
          : status === 'not_verified'
            ? '未核验'
            : status === 'not_in_scope_for_supply_v1'
              ? '供应 v1 范围外'
              : status;

  return (
    <AdminStatusChip
      variant={status === 'instrumented' ? 'secondary' : 'outline'}
      data-testid="instrument-status-badge"
      data-status={status}
    >
      {label}
    </AdminStatusChip>
  );
}
