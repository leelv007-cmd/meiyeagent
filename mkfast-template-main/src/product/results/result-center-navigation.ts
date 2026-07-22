/**
 * Result Center navigation helpers (D-089 / D-090 / #99).
 *
 * Submit success → direct navigation via ResultCenterNavigation.
 * Consumers (Composer / WT-C) import this instead of ad-hoc `?workId=` bridges.
 */

import type {
  ResultCenterNavigation,
  ResultPanel,
  ResultTarget,
} from '@meiye/contracts';
import { resultCenterPath, resultCenterSearchParams } from '@meiye/contracts';

import {
  resultReturnSearch,
  type ResultReturnState,
} from './result-return-navigation';

export type ResultCenterLocation = {
  pathname: string;
  search: Record<string, string | number | undefined>;
  /** Optional history.state payload for return restore. */
  state?: {
    returnToDraftKey?: string;
    focusKey?: string;
    /** Legacy dashboard-only handoff kept for existing draft restoration. */
    sourceRoute?: '/dashboard';
  };
};

/**
 * Build a typed ResultCenterNavigation after durable workId is known.
 */
export function buildResultCenterNavigation(input: {
  workId: string;
  returnToDraftKey?: string;
  focusKey?: string;
}): ResultCenterNavigation {
  if (!input.workId || input.workId.trim() === '') {
    throw new Error('ResultCenterNavigation requires a non-empty workId');
  }
  return {
    workId: input.workId,
    ...(input.returnToDraftKey
      ? { returnToDraftKey: input.returnToDraftKey }
      : {}),
    ...(input.focusKey ? { focusKey: input.focusKey } : {}),
  };
}

/**
 * Map navigation contract → concrete location for router.navigate.
 * Does not expand the legacy `?workId=` dashboard bridge.
 */
export function resultCenterLocationFromNavigation(
  nav: ResultCenterNavigation,
  options?: {
    contentId?: string;
    versionId?: string;
    panel?: ResultPanel;
    returnState?: ResultReturnState;
    sourceRoute?: '/dashboard';
  }
): ResultCenterLocation {
  const search = {
    ...resultCenterSearchParams({
      ...(options?.contentId ? { contentId: options.contentId } : {}),
      ...(options?.versionId ? { versionId: options.versionId } : {}),
      ...(options?.panel ? { panel: options.panel } : {}),
      ...(nav.focusKey ? { focusKey: nav.focusKey } : {}),
    }),
    ...resultReturnSearch(
      options?.returnState ??
        (options?.sourceRoute ? { kind: 'dashboard' } : undefined)
    ),
  };

  return {
    pathname: resultCenterPath(nav.workId),
    search,
    state: {
      ...(nav.returnToDraftKey
        ? { returnToDraftKey: nav.returnToDraftKey }
        : {}),
      ...(nav.focusKey ? { focusKey: nav.focusKey } : {}),
      ...(options?.sourceRoute ? { sourceRoute: options.sourceRoute } : {}),
    },
  };
}

/**
 * Submit-success handoff: composer obtained durable workId → Result Center.
 */
export function navigateAfterSubmitSuccess(input: {
  workId: string;
  returnToDraftKey?: string;
  focusKey?: string;
  panel?: ResultPanel;
  returnState?: ResultReturnState;
  sourceRoute?: '/dashboard';
}): ResultCenterLocation {
  const nav = buildResultCenterNavigation({
    workId: input.workId,
    ...(input.returnToDraftKey
      ? { returnToDraftKey: input.returnToDraftKey }
      : {}),
    ...(input.focusKey ? { focusKey: input.focusKey } : {}),
  });
  return resultCenterLocationFromNavigation(nav, {
    ...(input.panel ? { panel: input.panel } : {}),
    ...(input.returnState ? { returnState: input.returnState } : {}),
    ...(input.sourceRoute ? { sourceRoute: input.sourceRoute } : {}),
  });
}

/**
 * Build ResultTarget from route params + search (page entry).
 */
export function resultTargetFromRoute(input: {
  workId: string;
  contentId?: string;
  versionId?: string;
  panel?: ResultPanel;
  focusKey?: string;
}): ResultTarget {
  return {
    workId: input.workId,
    ...(input.contentId ? { contentId: input.contentId } : {}),
    ...(input.versionId ? { versionId: input.versionId } : {}),
    ...(input.panel ? { panel: input.panel } : {}),
    ...(input.focusKey ? { focusKey: input.focusKey } : {}),
  };
}

/** TanStack path id used by createFileRoute (underscore layout style). */
export const RESULT_CENTER_ROUTE_ID = '/dashboard/results_/$workId' as const;

/** Public URL path pattern. */
export const RESULT_CENTER_PATH_PATTERN = '/dashboard/results/$workId' as const;
