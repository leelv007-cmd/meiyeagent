/**
 * 旧任务收件箱路由壳 — T34 / #228.
 *
 * 待办与审批 have exactly one home now: the pending-actions inbox (D-032 权威
 * pending-actions 投影, 批准请求恰一次消费), which lives in the workbench's task
 * drawer rather than on a route of its own. This path forwards there and mounts
 * nothing, which is what takes the old task IA (content-task-inbox /
 * weekly-operations / retrieval-facets / compact-week-strip /
 * operations-route-model / operations-task-page) to 零路由引用 for T38's delete
 * batch.
 *
 * The old filter query has no successor — the inbox reads a different
 * projection — so it is dropped on the way out rather than translated. The
 * validator remains only to normalize old links before this compatibility
 * route redirects them; no retired page consumes its search contract.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { resolveLegacyRedirect } from '@/lib/uiux/navigation';
import type { ResultReturnFocusKey } from '@/product/results/result-return-navigation';

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
  beforeLoad: () => {
    throw redirect({ href: resolveLegacyRedirect('/dashboard/tasks')! });
  },
  validateSearch: validateTaskInboxSearch,
});
