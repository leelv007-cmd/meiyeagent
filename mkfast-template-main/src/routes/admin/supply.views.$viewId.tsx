import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { useRecordCrumb } from '@/components/admin/shell/page-crumb';
import {
  admin_supply_association_view_description,
  admin_supply_association_view_title,
} from '@/locale/paraglide/messages';
import {
  ASSOCIATION_VIEW_PATHS,
  isAssociationViewId,
} from '@/p1/admin-supply-association-views-model';
import { AdminSupplyAssociationView } from '@/p1/admin-supply-control';
import { createFileRoute } from '@tanstack/react-router';

/** Five association view routes (J4 / D-058). */
export const Route = createFileRoute('/admin/supply/views/$viewId')({
  component: RoutedSupplyAssociationViewPage,
});

function RoutedSupplyAssociationViewPage() {
  const { viewId } = Route.useParams();
  return <SupplyAssociationViewPage viewId={viewId} />;
}

function SupplyAssociationViewPage({
  viewId: viewIdProp,
}: {
  viewId?: string;
} = {}) {
  // When mounted by router, params come from Route; for SSR tests we accept prop.
  const viewId = viewIdProp ?? 'model';
  const resolved = isAssociationViewId(viewId) ? viewId : 'model';
  const path = ASSOCIATION_VIEW_PATHS[resolved];
  // Nav tree only resolves this route to the supply section; publish the view
  // id so the trail names the record and demotes the section from current page.
  useRecordCrumb(resolved);

  return (
    <AdminRoutePage
      title={admin_supply_association_view_title({ viewId: resolved })}
      description={admin_supply_association_view_description({ path })}
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <AdminSupplyAssociationView viewId={resolved} />
      </div>
    </AdminRoutePage>
  );
}
