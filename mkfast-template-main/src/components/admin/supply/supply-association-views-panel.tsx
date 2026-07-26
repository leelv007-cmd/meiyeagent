/**
 * Five association views panel (J4 / D-058) — forward + reverse.
 */
import { AdminStatusChip } from '@/components/admin/shell/admin-panel';
import {
  ASSOCIATION_VIEW_IDS,
  ASSOCIATION_VIEW_PATHS,
  type AssociationProjection,
  type AssociationViewId,
  type AssociationViewPanelModel,
  listAssociationViewReachability,
} from '@/p1/admin-supply-association-views-model';

function ProjectionBlock({
  projection,
}: {
  projection: AssociationProjection;
}) {
  return (
    <div
      data-testid="supply-association-projection"
      data-view={projection.view}
      data-direction={projection.direction}
      className="rounded-md border p-3 text-xs"
    >
      <div className="mb-2 flex items-center gap-2">
        <AdminStatusChip variant="outline">
          {projection.direction}
        </AdminStatusChip>
        <span className="font-medium">{projection.view}</span>
      </div>
      <pre
        data-testid="supply-association-json"
        className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground"
      >
        {JSON.stringify(projection, null, 2)}
      </pre>
    </div>
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
    <section
      data-testid="supply-association-views-panel"
      data-view-id={panel.viewId}
      data-path={panel.path}
      className="space-y-4"
    >
      <header className="space-y-2">
        <h2 className="text-base font-semibold">五关联视图 · {panel.title}</h2>
        <p className="text-xs text-muted-foreground">
          正查 + 反查 · path {panel.path}
        </p>
        <SupplyAssociationViewsNav activeViewId={panel.viewId} />
      </header>
      <div className="grid gap-3 lg:grid-cols-2">
        <ProjectionBlock projection={panel.forward} />
        <ProjectionBlock projection={panel.reverse} />
      </div>
    </section>
  );
}

export function SupplyAssociationViewsIndex() {
  return (
    <section data-testid="supply-association-index" className="space-y-3">
      <h2 className="text-base font-semibold">五关联视图入口</h2>
      <SupplyAssociationViewsNav />
      <ul className="space-y-1 text-xs">
        {ASSOCIATION_VIEW_IDS.map((id) => (
          <li
            key={id}
            data-testid="supply-association-index-row"
            data-view-id={id}
          >
            <a
              href={ASSOCIATION_VIEW_PATHS[id]}
              className="font-mono text-primary underline-offset-2 hover:underline"
            >
              {ASSOCIATION_VIEW_PATHS[id]}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
