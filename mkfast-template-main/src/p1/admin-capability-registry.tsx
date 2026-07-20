import { useMemo } from 'react';

import { CapabilityRegistryPanel } from '@/components/admin/capability/capability-registry-panel';
import {
  buildCapabilityRegistry,
  type CapabilityRegistryView,
} from '@/p1/admin-capability-registry-model';

/**
 * Admin capability registry control (J1 skeleton).
 * Pure projection from CAPABILITY_INVENTORY + domain self-report fixtures.
 * Live domain reporters land in later tickets; no synthetic health fill-in.
 */
export function AdminCapabilityRegistry({
  view: viewProp,
  initialSelectedId,
}: {
  view?: CapabilityRegistryView;
  initialSelectedId?: string;
} = {}) {
  const view = useMemo(() => viewProp ?? buildCapabilityRegistry(), [viewProp]);

  return (
    <CapabilityRegistryPanel
      view={view}
      initialSelectedId={initialSelectedId}
    />
  );
}
