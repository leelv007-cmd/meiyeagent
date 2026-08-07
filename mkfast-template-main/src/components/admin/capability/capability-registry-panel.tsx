import { useMemo, useState } from 'react';

import { CapabilityDetailCard } from '@/components/admin/capability/capability-detail-card';
import { CapabilityInventoryPanorama } from '@/components/admin/capability/capability-inventory-panorama';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  findInventoryItem,
  getProjection,
  getRegistryEntry,
  lookupDependencies,
  lookupDependents,
  type CapabilityRegistryView,
} from '@/p1/admin-capability-registry-model';
import {
  admin_capability_all_778fc8f9,
  admin_capability_capabilities_satisfy_the_six_question_re_ecdb66d8,
  admin_capability_capability_registry_skeleton_j1_5b56859d,
  admin_capability_no_capability_selected_742ec6ce,
  admin_capability_six_question_completeness_gaps_821f21a2,
  admin_capability_status_is_domain_self_report_versioned_i_a07368ec,
} from '@/locale/paraglide/messages';

export function CapabilityRegistryPanel({
  view,
  initialSelectedId,
}: {
  view: CapabilityRegistryView;
  initialSelectedId?: string;
}) {
  const defaultId =
    initialSelectedId &&
    view.entries.some((entry) => entry.id === initialSelectedId)
      ? initialSelectedId
      : (view.entries[0]?.id ?? '');

  const [selectedId, setSelectedId] = useState(defaultId);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    const entry = getRegistryEntry(view, selectedId);
    const item = findInventoryItem(selectedId, view.inventory);
    const projection = getProjection(view, selectedId);
    if (!entry || !item || !projection) return null;
    return {
      entry,
      item,
      projection,
      dependsOn: lookupDependencies(selectedId, view.dependencyEdges),
      dependents: lookupDependents(selectedId, view.dependencyEdges),
    };
  }, [selectedId, view]);

  const incomplete = view.projections.filter(
    (projection) => !projection.requiredComplete
  );

  return (
    <div className="space-y-6" data-testid="capability-registry-panel">
      <Alert>
        <AlertTitle>
          {admin_capability_capability_registry_skeleton_j1_5b56859d()}
        </AlertTitle>
        <AlertDescription>
          {admin_capability_status_is_domain_self_report_versioned_i_a07368ec()}
        </AlertDescription>
      </Alert>

      {incomplete.length > 0 ? (
        <Alert variant="destructive" data-testid="completeness-gap-alert">
          <AlertTitle>
            {admin_capability_six_question_completeness_gaps_821f21a2()}
          </AlertTitle>
          <AlertDescription>
            {incomplete
              .map((row) => `${row.name}(${row.capabilityId})`)
              .join('、')}
          </AlertDescription>
        </Alert>
      ) : (
        <p
          className="text-sm text-muted-foreground"
          data-testid="completeness-ok"
        >
          {admin_capability_all_778fc8f9()} {view.projections.length}{' '}
          {admin_capability_capabilities_satisfy_the_six_question_re_ecdb66d8()}
        </p>
      )}

      <CapabilityInventoryPanorama
        view={view}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {selected ? (
        <CapabilityDetailCard
          item={selected.item}
          entry={selected.entry}
          projection={selected.projection}
          dependsOn={selected.dependsOn}
          dependents={selected.dependents}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {admin_capability_no_capability_selected_742ec6ce()}
        </p>
      )}
    </div>
  );
}
