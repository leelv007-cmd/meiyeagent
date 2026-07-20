/**
 * Admin entitlement / pool status control (J4 consuming H1).
 */
import { useMemo } from 'react';

import { EntitlementStatusPanel } from '@/components/admin/entitlements/entitlement-status-panel';
import {
  buildEntitlementStatusView,
  type EntitlementStatusInput,
  type EntitlementStatusView,
} from '@/p1/admin-entitlement-status-model';

export function AdminEntitlementStatus({
  input,
  view: viewProp,
}: {
  input?: EntitlementStatusInput;
  view?: EntitlementStatusView;
} = {}) {
  const view = useMemo(
    () => viewProp ?? buildEntitlementStatusView(input),
    [viewProp, input],
  );
  return <EntitlementStatusPanel view={view} />;
}
