import { Routes } from '@/lib/routes';
import type { TaskInboxFiltersValue } from '@/p1/types';

const taskInboxPanels = ['inbox', 'week'] as const;
const resultReturnFocusKeys = [
  'mobile-progress-entry',
  'works-detail-actions',
] as const;

export type TaskInboxReturnPanel = (typeof taskInboxPanels)[number];
export type ResultReturnFocusKey = (typeof resultReturnFocusKeys)[number];
export type TaskInboxReturnFilters = Omit<TaskInboxFiltersValue, 'date'> & {
  date: 'all' | 'week';
};

export type ResultReturnState =
  | { kind: 'dashboard' }
  | {
      kind: 'works';
      archiveId?: string;
      focusKey?: ResultReturnFocusKey;
      scrollY: number;
    }
  | {
      kind: 'task-inbox';
      filters: TaskInboxReturnFilters;
      focusKey?: ResultReturnFocusKey;
      panel: TaskInboxReturnPanel;
      scrollY: number;
    };

export type ResultReturnSearch = {
  returnTo?: 'dashboard' | 'task-inbox' | 'works';
  returnArchiveId?: string;
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
  if (state.kind === 'works') {
    return {
      returnTo: 'works',
      ...(state.archiveId ? { returnArchiveId: state.archiveId } : {}),
      returnScrollY: returnScrollY(state.scrollY),
      ...(state.focusKey ? { returnFocusKey: state.focusKey } : {}),
    };
  }

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
  if (
    search.returnFocusKey !== undefined &&
    !resultReturnFocusKey(search.returnFocusKey)
  ) {
    return undefined;
  }
  if (search.returnTo === 'works') {
    const archiveId =
      typeof search.returnArchiveId === 'string' &&
      search.returnArchiveId.trim().length > 0
        ? search.returnArchiveId
        : undefined;
    return {
      kind: 'works',
      ...(archiveId ? { archiveId } : {}),
      ...(resultReturnFocusKey(search.returnFocusKey)
        ? { focusKey: resultReturnFocusKey(search.returnFocusKey) }
        : {}),
      scrollY: returnScrollY(search.returnScrollY),
    };
  }
  if (search.returnTo !== 'task-inbox') return undefined;

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

export type ResultReturnDestination =
  | { search: Record<string, never>; to: typeof Routes.Dashboard }
  | { search: Record<string, never>; to: '/dashboard/works' }
  | {
      params: { workId: string };
      search: {
        restoreFocusKey?: ResultReturnFocusKey;
        restoreScrollY?: number;
      };
      to: '/dashboard/works/$workId';
    };

/**
 * Where 返回 lands. Task-inbox states still parse (old links) but the page is
 * gone, so they come home to the workbench. Works archive returns go back to
 * the exact archive row, with scroll/focus restore on that page.
 */
export function resultReturnDestination(
  state: ResultReturnState
): ResultReturnDestination {
  if (state.kind === 'works') {
    if (state.archiveId) {
      return {
        params: { workId: state.archiveId },
        search: {
          ...(state.focusKey ? { restoreFocusKey: state.focusKey } : {}),
          ...(state.scrollY > 0 ? { restoreScrollY: state.scrollY } : {}),
        },
        to: '/dashboard/works/$workId',
      };
    }
    return { search: {}, to: '/dashboard/works' };
  }
  return { search: {}, to: Routes.Dashboard };
}
