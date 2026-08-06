/**
 * Five association views panel (J4 / D-058) — forward + reverse.
 */
import { Badge, type BadgeProps } from '@/components/reui/badge';
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import {
  ASSOCIATION_VIEW_IDS,
  ASSOCIATION_VIEW_PATHS,
  type AssociationProjection,
  type AssociationViewId,
  type AssociationViewPanelModel,
  listAssociationViewReachability,
} from '@/p1/admin-supply-association-views-model';

/**
 * Traversal direction is a navigation word, not a health word, so both
 * directions stay neutral; anything unmapped falls through to `outline`
 * rather than borrowing a colour it has not earned.
 */
const DIRECTION_VARIANT: Record<string, BadgeProps['variant']> = {
  forward: 'secondary',
  reverse: 'secondary',
};

function directionVariant(direction: string): BadgeProps['variant'] {
  return DIRECTION_VARIANT[direction] ?? 'outline';
}

function ProjectionBlock({
  projection,
}: {
  projection: AssociationProjection;
}) {
  return (
    <Frame
      dense
      data-testid="supply-association-projection"
      data-view={projection.view}
      data-direction={projection.direction}
      className="h-full min-w-0"
    >
      <FramePanel className="text-xs">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant={directionVariant(projection.direction)}>
            {projection.direction}
          </Badge>
          <span className="font-medium">{projection.view}</span>
        </div>
        <pre
          data-testid="supply-association-json"
          className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground"
        >
          {JSON.stringify(projection, null, 2)}
        </pre>
      </FramePanel>
    </Frame>
  );
}

export function SupplyAssociationViewsNav({
  activeViewId,
}: {
  activeViewId?: AssociationViewId;
}) {
  const rows = listAssociationViewReachability();
  return (
    <nav
      data-testid="supply-association-nav"
      className="flex flex-wrap gap-2 text-xs"
    >
      {rows.map((row) => (
        <a
          key={row.viewId}
          href={row.path}
          data-testid="supply-association-nav-link"
          data-view-id={row.viewId}
          data-active={String(row.viewId === activeViewId)}
          className="rounded-md border px-2 py-1 hover:bg-muted"
        >
          {row.title}
        </a>
      ))}
    </nav>
  );
}

export function SupplyAssociationViewsPanel({
  panel,
}: {
  panel: AssociationViewPanelModel;
}) {
  return (
    <div
      data-testid="supply-association-views-panel"
      data-view-id={panel.viewId}
      data-path={panel.path}
      className="space-y-4"
    >
      {/* Page header already carries the view title; panel only hosts nav. */}
      <Frame>
        <FramePanel>
          <SupplyAssociationViewsNav activeViewId={panel.viewId} />
        </FramePanel>
      </Frame>
      <div className="grid gap-3 lg:grid-cols-2">
        <ProjectionBlock projection={panel.forward} />
        <ProjectionBlock projection={panel.reverse} />
      </div>
    </div>
  );
}

export function SupplyAssociationViewsIndex() {
  return (
    <Frame data-testid="supply-association-index">
      <FrameHeader className="gap-1">
        <FrameTitle className="text-base">五关联视图入口</FrameTitle>
      </FrameHeader>
      <FramePanel>
        <SupplyAssociationViewsNav />
      </FramePanel>
      <FramePanel className="flex flex-col gap-0 p-0!">
        {ASSOCIATION_VIEW_IDS.map((id) => (
          <a
            key={id}
            href={ASSOCIATION_VIEW_PATHS[id]}
            data-testid="supply-association-index-row"
            data-view-id={id}
            className="border-b px-4 py-2 font-mono text-primary text-xs last:border-b-0 hover:bg-muted/40"
          >
            {ASSOCIATION_VIEW_PATHS[id]}
          </a>
        ))}
      </FramePanel>
    </Frame>
  );
}
