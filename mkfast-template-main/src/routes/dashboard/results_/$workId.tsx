/**
 * Result Center route — `/dashboard/results/$workId` (D-089 / WT-D1 / #99).
 *
 * New path-style object route. Does NOT expand the legacy `?workId=` bridge
 * on dashboard/index (C owner). Shareable search: contentId / versionId /
 * panel / focusKey only.
 */

import { ResultCenterPage } from '@/product/results/result-center-page';
import {
  parseResultCenterSearch,
  resolveRouteResultTarget,
  type ClientResolverWorkRecord,
} from '@/product/results/result-target-wiring';
import type { ResultPanel, ResultWorkspaceKind } from '@meiye/contracts';
import { resultPanels } from '@meiye/contracts';
import { createFileRoute } from '@tanstack/react-router';

export type ResultCenterSearch = {
  contentId?: string;
  versionId?: string;
  panel?: ResultPanel;
  focusKey?: string;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalPanel(value: unknown): ResultPanel | undefined {
  return typeof value === 'string' &&
    (resultPanels as readonly string[]).includes(value)
    ? (value as ResultPanel)
    : undefined;
}

/** Exported for unit tests — same search validation as the route. */
export function validateResultCenterSearch(
  search: Record<string, unknown>,
): ResultCenterSearch {
  const contentId = optionalString(search.contentId);
  const versionId = optionalString(search.versionId);
  const panel = optionalPanel(search.panel);
  const focusKey = optionalString(search.focusKey);
  return {
    ...(contentId ? { contentId } : {}),
    ...(versionId ? { versionId } : {}),
    ...(panel ? { panel } : {}),
    ...(focusKey ? { focusKey } : {}),
  };
}

export const Route = createFileRoute('/dashboard/results_/$workId')({
  validateSearch: (search: Record<string, unknown>): ResultCenterSearch =>
    validateResultCenterSearch(search),
  component: ResultCenterRoutePage,
});

function ResultCenterRoutePage() {
  const { workId } = Route.useParams();
  const search = Route.useSearch();
  const target = parseResultCenterSearch(workId, search);

  // Live catalog wiring lands with operations query; empty = provisional shell.
  const works: readonly ClientResolverWorkRecord[] = [];
  const outcome = resolveRouteResultTarget({ target, works });

  const workspaceKind: ResultWorkspaceKind = 'copy';

  return (
    <ResultCenterPage
      workId={workId}
      resolveOutcome={outcome}
      facts={{
        target,
        workspaceKind,
        requestedPanel: search.panel,
        progressState: search.panel === 'run' ? 'running' : 'success',
      }}
    />
  );
}
