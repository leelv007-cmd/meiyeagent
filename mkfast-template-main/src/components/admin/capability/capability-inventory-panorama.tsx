import type { CapabilityInventoryItem } from '@meiye/contracts';

import { InventoryStatusBadge } from '@/components/admin/capability/capability-status-badge';
import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
  AdminStatusChip,
} from '@/components/admin/shell/admin-panel';
import {
  groupInventoryByDomain,
  type CapabilityRegistryView,
} from '@/p1/admin-capability-registry-model';
import { cn } from '@/lib/utils';

export function CapabilityInventoryPanorama({
  view,
  selectedId,
  onSelect,
}: {
  view: CapabilityRegistryView;
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const sections = groupInventoryByDomain(view.inventory);
  const instrumentedCount = view.inventory.items.filter(
    (item) => item.status === 'instrumented'
  ).length;
  const stubCount = view.inventory.items.length - instrumentedCount;

  return (
    <AdminPanel data-testid="capability-inventory-panorama">
      <AdminPanelHeader>
        <AdminPanelTitle className="text-base">能力清单全景</AdminPanelTitle>
        <AdminPanelDescription>
          revision {view.inventory.revision} · 捕获 {view.inventory.capturedAt}{' '}
          · 共 {view.inventory.items.length} 项（已插桩 {instrumentedCount} /
          存根及其他 {stubCount}）
        </AdminPanelDescription>
      </AdminPanelHeader>
      <AdminPanelContent className="space-y-6">
        {sections.map((section) => (
          <section
            key={section.group}
            className="space-y-2"
            data-group={section.group}
          >
            <h3 className="text-sm font-semibold">{section.label}</h3>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {section.items.map((item) => (
                <InventoryItemButton
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </section>
        ))}
      </AdminPanelContent>
    </AdminPanel>
  );
}

function InventoryItemButton({
  item,
  selected,
  onSelect,
}: {
  item: CapabilityInventoryItem;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const interactive = typeof onSelect === 'function';
  const className = cn(
    'w-full rounded-lg border p-3 text-left transition-colors',
    selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/40',
    interactive ? 'cursor-pointer' : 'cursor-default'
  );

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{item.name}</span>
        <InventoryStatusBadge status={item.status} />
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
        {item.purpose}
      </p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        {item.id}
      </p>
      {item.notes ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{item.notes}</p>
      ) : null}
      {item.criticalDependencies.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.criticalDependencies.map((dep) => (
            <AdminStatusChip
              key={dep}
              variant="outline"
              className="font-mono text-[10px]"
            >
              {dep}
            </AdminStatusChip>
          ))}
        </div>
      ) : null}
    </>
  );

  if (!interactive) {
    return (
      <li>
        <div
          className={className}
          data-testid="inventory-item"
          data-capability-id={item.id}
          data-inventory-status={item.status}
        >
          {body}
        </div>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className={className}
        data-testid="inventory-item"
        data-capability-id={item.id}
        data-inventory-status={item.status}
        aria-pressed={selected}
        onClick={() => onSelect(item.id)}
      >
        {body}
      </button>
    </li>
  );
}
