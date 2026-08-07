import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { useRecordCrumb } from '@/components/admin/shell/page-crumb';
import {
  admin_supply_task_page_description,
  admin_supply_task_page_title,
} from '@/locale/paraglide/messages';
import { AdminSupplyTaskDrilldown } from '@/p1/admin-supply-control';
import { createFileRoute } from '@tanstack/react-router';

/** Supply task drilldown route (J4 / D-070). */
export const Route = createFileRoute('/admin/supply/tasks/$taskId')({
  component: RoutedSupplyTaskDrilldownPage,
});

function RoutedSupplyTaskDrilldownPage() {
  const { taskId } = Route.useParams();
  return <SupplyTaskDrilldownPage taskId={taskId} />;
}

function SupplyTaskDrilldownPage({
  taskId: taskIdProp,
}: {
  taskId?: string;
} = {}) {
  const taskId = taskIdProp ?? 'task-text-001';
  // The nav tree can only resolve this route to its section, so the trail stops
  // at 供给运行控制台 unless the page names the record it is showing.
  useRecordCrumb(taskId);
  return (
    <AdminRoutePage
      title={admin_supply_task_page_title({ taskId })}
      description={admin_supply_task_page_description()}
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <AdminSupplyTaskDrilldown taskId={taskId} />
      </div>
    </AdminRoutePage>
  );
}
