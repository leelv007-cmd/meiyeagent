/**
 * Admin Cloudflare read-only control (J6).
 *
 * Pure presentation from inventory/probe fixtures until Z2 wires live REST.
 * No Cloudflare write controls. No GraphQL analytics.
 */

import { useMemo } from 'react';

import { CloudflareReadonlyPanel } from '@/components/admin/cloudflare/cloudflare-readonly-panel';
import { defaultAdminCfProbes } from '@/p1/admin-cloudflare-probe';
import {
  buildAdminCloudflarePresentation,
  type AdminCfInventoryInput,
  type AdminCfPresentationView,
} from '@/p1/admin-cloudflare-presentation';

export function AdminCloudflareControl({
  inventory,
  view: viewProp,
}: {
  inventory?: AdminCfInventoryInput | null;
  view?: AdminCfPresentationView;
} = {}) {
  const view = useMemo(
    () =>
      viewProp ??
      buildAdminCloudflarePresentation({
        inventory: inventory ?? null,
        probes: defaultAdminCfProbes(),
      }),
    [viewProp, inventory],
  );

  return <CloudflareReadonlyPanel view={view} />;
}
