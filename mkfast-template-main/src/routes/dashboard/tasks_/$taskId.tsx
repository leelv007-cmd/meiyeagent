import { OperationsTaskDetailPage } from '@/product/operations-task-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/tasks_/$taskId')({
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const { taskId } = Route.useParams();
  return <OperationsTaskDetailPage taskId={taskId} />;
}
