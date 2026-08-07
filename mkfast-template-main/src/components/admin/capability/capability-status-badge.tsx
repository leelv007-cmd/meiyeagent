import type {
  CapabilityAvailabilityStatus,
  CapabilityInstrumentStatus,
  CapabilityInventoryItemStatus,
} from '@meiye/contracts';

import { Badge, type BadgeProps } from '@/components/reui/badge';
import {
  admin_capability_instrument_instrumented,
  admin_capability_instrument_not_instrumented,
  admin_capability_instrument_not_verified,
  admin_capability_instrument_out_of_scope,
  admin_capability_instrument_stub,
} from '@/locale/paraglide/messages';
import {
  availabilityLabel,
  inventoryStatusLabel,
} from '@/p1/admin-capability-registry-model';

/**
 * 状态徽章走 ReUI Badge 的语义 variant，不再是四档通用色。
 *
 * 「诚实 unknown」在这里是配色纪律的一部分：未插桩 / 未核验一律走中性
 * `secondary`，绝不借 success 的绿色替没量到的东西背书。
 */
type StatusVariant = NonNullable<BadgeProps['variant']>;

function inventoryVariant(
  status: CapabilityInventoryItemStatus
): StatusVariant {
  return status === 'instrumented' ? 'success-outline' : 'secondary';
}

function availabilityVariant(
  status: CapabilityAvailabilityStatus
): StatusVariant {
  switch (status) {
    case 'available':
      return 'success-outline';
    case 'degraded':
    case 'attention':
    case 'stale':
      return 'warning-outline';
    case 'blocked':
      return 'destructive-outline';
    default:
      return 'secondary';
  }
}

/** Inventory panorama status (instrumented | stub | …). No fake green. */
export function InventoryStatusBadge({
  status,
}: {
  status: CapabilityInventoryItemStatus;
}) {
  return (
    <Badge
      variant={inventoryVariant(status)}
      data-testid="inventory-status-badge"
      data-status={status}
    >
      {inventoryStatusLabel(status)}
    </Badge>
  );
}

/** Operator availability badge (honest; not_instrumented / not_verified visible). */
export function AvailabilityStatusBadge({
  status,
}: {
  status: CapabilityAvailabilityStatus;
}) {
  return (
    <Badge
      variant={availabilityVariant(status)}
      data-testid="availability-status-badge"
      data-status={status}
    >
      {availabilityLabel(status)}
    </Badge>
  );
}

export function InstrumentStatusBadge({
  status,
}: {
  status: CapabilityInstrumentStatus;
}) {
  const label =
    status === 'instrumented'
      ? admin_capability_instrument_instrumented()
      : status === 'stub'
        ? admin_capability_instrument_stub()
        : status === 'not_instrumented'
          ? admin_capability_instrument_not_instrumented()
          : status === 'not_verified'
            ? admin_capability_instrument_not_verified()
            : status === 'not_in_scope_for_supply_v1'
              ? admin_capability_instrument_out_of_scope()
              : status;

  return (
    <Badge
      variant={status === 'instrumented' ? 'success-outline' : 'secondary'}
      data-testid="instrument-status-badge"
      data-status={status}
    >
      {label}
    </Badge>
  );
}
