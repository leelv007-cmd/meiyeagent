import { OperationsTaskPage } from '@/product/operations-task-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/tasks')({
  component: TaskInboxPage,
  validateSearch: (search: Record<string, unknown>) => ({
    date: search.date === 'week' ? 'week' : 'all',
    mode: search.mode === 'week' ? 'week' : 'inbox',
    relatedKind:
      typeof search.relatedKind === 'string' ? search.relatedKind : 'all',
    risk: typeof search.risk === 'string' ? search.risk : 'all',
    source: typeof search.source === 'string' ? search.source : 'all',
    status: typeof search.status === 'string' ? search.status : 'all',
  }),
});

function TaskInboxPage() {
  return <OperationsTaskPage search={Route.useSearch()} />;
}
