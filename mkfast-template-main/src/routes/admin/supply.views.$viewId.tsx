import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  ASSOCIATION_VIEW_PATHS,
  isAssociationViewId,
} from '@/p1/admin-supply-association-views-model';
import { AdminSupplyAssociationView } from '@/p1/admin-supply-control';
import { createFileRoute } from '@tanstack/react-router';

/**
 * Five association view routes (J4 / D-058).
 * Shared wiring deferred — see supply/WIRING-DIFF.md.
 */
export const Route = createFileRoute('/admin/supply/views/$viewId')({
  component: SupplyAssociationViewRoute,
});

function SupplyAssociationViewRoute() {
  const { viewId } = Route.useParams();
  return <SupplyAssociationViewPage viewId={viewId} />;
}

export function SupplyAssociationViewPage({
  viewId: viewIdProp,
}: {
  viewId?: string;
} = {}) {
  // When mounted by router, params come from Route; for SSR tests we accept prop.
  const viewId = viewIdProp ?? 'model';
  const resolved = isAssociationViewId(viewId) ? viewId : 'model';
  const path = ASSOCIATION_VIEW_PATHS[resolved];

  return (
    <AdminRoutePage
      title={`五关联视图 · ${resolved}`}
      description={`正查 + 反查 · ${path}`}
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <AdminSupplyAssociationView viewId={resolved} />
      </div>
    </AdminRoutePage>
  );
}
