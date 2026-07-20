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
        <AlertTitle>能力注册表骨架（J1）</AlertTitle>
        <AlertDescription>
          状态由各域自报 + 版本化 inventory
          投影；缺数据显示未插桩/未核验，禁止零值或静态绿伪装健康。依赖为正反查静态表，无严重度传播引擎。
        </AlertDescription>
      </Alert>

      {incomplete.length > 0 ? (
        <Alert variant="destructive" data-testid="completeness-gap-alert">
          <AlertTitle>六问完整性缺口</AlertTitle>
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
          全部 {view.projections.length} 项能力满足六问必填投影（Q4 允许
          not_instrumented）。
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
        <p className="text-sm text-muted-foreground">未选择能力。</p>
      )}
    </div>
  );
}
