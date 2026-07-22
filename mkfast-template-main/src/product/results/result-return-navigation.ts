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

export function taskInboxReturnState(input: {
  search: Partial<TaskInboxFiltersValue> & { mode?: unknown };
  scrollY: number;
  focusKey?: ResultReturnFocusKey;
}): Extract<ResultReturnState, { kind: 'task-inbox' }> {
  return {
    kind: 'task-inbox',
    filters: {
      date: input.search.date === 'week' ? 'week' : 'all',
      relatedKind: nonEmptyString(input.search.relatedKind, 'all'),
      risk: nonEmptyString(input.search.risk, 'all'),
      source: nonEmptyString(input.search.source, 'all'),
      status: nonEmptyString(input.search.status, 'all'),
    },
    ...(input.focusKey ? { focusKey: input.focusKey } : {}),
    panel: taskInboxPanel(input.search.mode),
    scrollY: returnScrollY(input.scrollY),
  };
}

export function resultReturnDestination(
  state: Extract<ResultReturnState, { kind: 'dashboard' }>
): { to: typeof Routes.Dashboard; search: Record<string, never> };
export function resultReturnDestination(
  state: Extract<ResultReturnState, { kind: 'task-inbox' }>
): { to: typeof Routes.TaskInbox; search: TaskInboxRestoreSearch };
export function resultReturnDestination(
  state: ResultReturnState
):
  | { to: typeof Routes.Dashboard; search: Record<string, never> }
  | { to: typeof Routes.TaskInbox; search: TaskInboxRestoreSearch } {
  if (state.kind === 'dashboard') {
    return { to: Routes.Dashboard, search: {} };
  }

  return {
    to: Routes.TaskInbox,
    search: {
      ...state.filters,
      mode: state.panel,
      restoreScrollY: state.scrollY,
      ...(state.focusKey ? { restoreFocusKey: state.focusKey } : {}),
    },
  };
}
