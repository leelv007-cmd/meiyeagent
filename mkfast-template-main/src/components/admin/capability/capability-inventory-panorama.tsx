import type { CapabilityInventoryItem } from '@meiye/contracts';

import { InventoryStatusBadge } from '@/components/admin/capability/capability-status-badge';
import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Separator } from '@/components/ui/separator';
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
    <Frame data-testid="capability-inventory-panorama">
      <FrameHeader className="gap-1">
        <FrameTitle className="text-base">能力清单全景</FrameTitle>
        <FrameDescription>
          revision {view.inventory.revision} · 捕获 {view.inventory.capturedAt}{' '}
          · 共 {view.inventory.items.length} 项（已插桩 {instrumentedCount} /
          存根及其他 {stubCount}）
        </FrameDescription>
      </FrameHeader>
      {sections.map((section) => (
        <FramePanel
          key={section.group}
          className="flex flex-col gap-0 p-0!"
          data-group={section.group}
        >
          <h3 className="text-muted-foreground px-4 py-2 text-sm font-medium">
            {section.label}
          </h3>
          <Separator />
          <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {section.items.map((item) => (
              <InventoryItemButton
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </FramePanel>
      ))}
    </Frame>
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
      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
        {item.purpose}
      </p>
      <p className="text-muted-foreground mt-1 font-mono text-[11px]">
        {item.id}
      </p>
      {item.notes ? (
        <p className="text-muted-foreground mt-1 text-[11px]">{item.notes}</p>
      ) : null}
      {item.criticalDependencies.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.criticalDependencies.map((dep) => (
            <Badge
              key={dep}
              variant="outline"
              size="sm"
              className="font-mono text-[10px]"
            >
              {dep}
            </Badge>
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
