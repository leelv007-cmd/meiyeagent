import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminSupplyTaskDrilldown } from '@/p1/admin-supply-control';
import { createFileRoute } from '@tanstack/react-router';

/**
 * Supply task drilldown route (J4 / D-070).
 * Shared wiring deferred — see supply/WIRING-DIFF.md.
 */
export const Route = createFileRoute('/admin/supply/tasks/$taskId')({
  component: SupplyTaskDrilldownRoute,
});

function SupplyTaskDrilldownRoute() {
  const { taskId } = Route.useParams();
  return <SupplyTaskDrilldownPage taskId={taskId} />;
}

export function SupplyTaskDrilldownPage({
  taskId: taskIdProp,
}: {
  taskId?: string;
} = {}) {
  const taskId = taskIdProp ?? 'task-text-001';
  return (
    <AdminRoutePage
      title={`供应任务 · ${taskId}`}
      description="摘要卡 / 延迟分段 / 持久化时间线 / 错误折叠 / 产物预览"
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <AdminSupplyTaskDrilldown taskId={taskId} />
      </div>
    </AdminRoutePage>
  );
}
