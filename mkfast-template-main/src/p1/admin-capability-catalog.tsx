import { useMemo } from 'react';

import { CapabilityCatalogPanel } from '@/components/admin/capability/capability-catalog-panel';
import {
  buildCapabilityCatalog,
  type CapabilityCatalogView,
} from '@/p1/admin-capability-catalog-model';

/**
 * Admin capability catalog control (J3 two-level IA).
 * Pure projection — live reporters remain later tickets.
 */
export function AdminCapabilityCatalog({
  view: viewProp,
}: {
  view?: CapabilityCatalogView;
} = {}) {
  const view = useMemo(
    () => viewProp ?? buildCapabilityCatalog(),
    [viewProp]
  );

  return <CapabilityCatalogPanel view={view} />;
}
