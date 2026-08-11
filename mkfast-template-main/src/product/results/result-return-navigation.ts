import { Routes } from '@/lib/routes';
import type { TaskInboxFiltersValue } from '@/p1/types';

const taskInboxPanels = ['inbox', 'week'] as const;
const resultReturnFocusKeys = ['mobile-progress-entry'] as const;

export type TaskInboxReturnPanel = (typeof taskInboxPanels)[number];
export type ResultReturnFocusKey = (typeof resultReturnFocusKeys)[number];
export type TaskInboxReturnFilters = Omit<TaskInboxFiltersValue, 'date'> & {
  date: 'all' | 'week';
};

export type ResultReturnState =
  | { kind: 'dashboard' }
  | {
      kind: 'task-inbox';
      filters: TaskInboxReturnFilters;
      focusKey?: ResultReturnFocusKey;
      panel: TaskInboxReturnPanel;
      scrollY: number;
    };

export type ResultReturnSearch = {
  returnTo?: 'dashboard' | 'task-inbox';
  returnDate?: string;
  returnRelatedKind?: string;
  returnRisk?: string;
  returnSource?: string;
  returnStatus?: string;
  returnPanel?: TaskInboxReturnPanel;
  returnScrollY?: number;
  returnFocusKey?: ResultReturnFocusKey;
};

export type TaskInboxRestoreSearch = TaskInboxReturnFilters & {
  mode: TaskInboxReturnPanel;
  restoreScrollY?: number;
  restoreFocusKey?: ResultReturnFocusKey;
};

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : fallback;
}

function taskInboxPanel(value: unknown): TaskInboxReturnPanel {
  return value === 'week' ? 'week' : 'inbox';
}

function resultReturnFocusKey(
  value: unknown
): ResultReturnFocusKey | undefined {
  return typeof value === 'string' &&
    (resultReturnFocusKeys as readonly string[]).includes(value)
    ? (value as ResultReturnFocusKey)
    : undefined;
}

function returnScrollY(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
}

function taskInboxFilters(
  search: Record<string, unknown>
): TaskInboxReturnFilters {
  return {
    date: search.returnDate === 'week' ? 'week' : 'all',
    relatedKind: nonEmptyString(search.returnRelatedKind, 'all'),
    risk: nonEmptyString(search.returnRisk, 'all'),
    source: nonEmptyString(search.returnSource, 'all'),
    status: nonEmptyString(search.returnStatus, 'all'),
  };
}

export function resultReturnSearch(
  state: ResultReturnState | undefined
): ResultReturnSearch {
  if (!state) return {};
  if (state.kind === 'dashboard') return { returnTo: 'dashboard' };

  return {
    returnTo: 'task-inbox',
    returnDate: state.filters.date,
    returnRelatedKind: state.filters.relatedKind,
    returnRisk: state.filters.risk,
    returnSource: state.filters.source,
    returnStatus: state.filters.status,
    returnPanel: state.panel,
    returnScrollY: returnScrollY(state.scrollY),
    ...(state.focusKey ? { returnFocusKey: state.focusKey } : {}),
  };
}

/**
 * Parse only trusted internal destinations. Result URLs deliberately never
 * accept a free-form return URL or a selector supplied by the query string.
 */
export function parseResultReturnState(
  search: Record<string, unknown>
): ResultReturnState | undefined {
  if (search.returnTo === 'dashboard') return { kind: 'dashboard' };
  if (search.returnTo !== 'task-inbox') return undefined;
  if (
    search.returnFocusKey !== undefined &&
    !resultReturnFocusKey(search.returnFocusKey)
  ) {
    return undefined;
  }

  return {
    kind: 'task-inbox',
    filters: taskInboxFilters(search),
    ...(resultReturnFocusKey(search.returnFocusKey)
      ? { focusKey: resultReturnFocusKey(search.returnFocusKey) }
      : {}),
    panel: taskInboxPanel(search.returnPanel),
    scrollY: returnScrollY(search.returnScrollY),
  };
}

/**
 * Where 返回 lands. Every return goes to the workbench since T34 / #228: the
 * 旧任务收件箱 route retired, so a `task-inbox` state no longer has a page to
 * restore. The state itself is still parsed and serialised — old links carrying
 * `returnTo=task-inbox` must resolve to something rather than throw — it simply
 * has one destination now. The filter/scroll payload it carries goes with the
 * old page in T38's delete batch.
 */
export function resultReturnDestination(_state: ResultReturnState): {
  to: typeof Routes.Dashboard;
  search: Record<string, never>;
} {
  return { to: Routes.Dashboard, search: {} };
}
