import { OperationsTaskPage } from '@/product/operations-task-page';
import type { ResultReturnFocusKey } from '@/product/results/result-return-navigation';
import { createFileRoute } from '@tanstack/react-router';

export type TaskInboxRouteSearch = {
  date: 'all' | 'week';
  mode: 'inbox' | 'week';
  relatedKind: string;
  risk: string;
  source: string;
  status: string;
  restoreScrollY?: number;
  restoreFocusKey?: ResultReturnFocusKey;
};

function optionalRestoreScrollY(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed)
    : undefined;
}

function optionalRestoreFocusKey(
  value: unknown
): ResultReturnFocusKey | undefined {
  return value === 'mobile-progress-entry' ? value : undefined;
}

export function validateTaskInboxSearch(
  search: Record<string, unknown>
): TaskInboxRouteSearch {
  const restoreScrollY = optionalRestoreScrollY(search.restoreScrollY);
  const restoreFocusKey = optionalRestoreFocusKey(search.restoreFocusKey);
  return {
    date: search.date === 'week' ? 'week' : 'all',
    mode: search.mode === 'week' ? 'week' : 'inbox',
    relatedKind:
      typeof search.relatedKind === 'string' ? search.relatedKind : 'all',
    risk: typeof search.risk === 'string' ? search.risk : 'all',
    source: typeof search.source === 'string' ? search.source : 'all',
    status: typeof search.status === 'string' ? search.status : 'all',
    ...(restoreScrollY !== undefined ? { restoreScrollY } : {}),
    ...(restoreFocusKey ? { restoreFocusKey } : {}),
  };
}

export const Route = createFileRoute('/dashboard/tasks')({
  component: TaskInboxPage,
  validateSearch: validateTaskInboxSearch,
});

function TaskInboxPage() {
  return <OperationsTaskPage search={Route.useSearch()} />;
}
