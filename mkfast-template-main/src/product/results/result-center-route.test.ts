/**
 * Result Center route helpers (WT-D1 / #99).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseResultCenterSearch,
  resolveRouteResultTarget,
} from './result-target-wiring';

/** Mirrors routes/dashboard/results_/$workId validateSearch (pure). */
function validateResultCenterSearch(search: Record<string, unknown>) {
  const contentId =
    typeof search.contentId === 'string' && search.contentId.length > 0
      ? search.contentId
      : undefined;
  const versionId =
    typeof search.versionId === 'string' && search.versionId.length > 0
      ? search.versionId
      : undefined;
  const panel =
    search.panel === 'result' ||
    search.panel === 'adjust' ||
    search.panel === 'delivery' ||
    search.panel === 'history' ||
    search.panel === 'run'
      ? search.panel
      : undefined;
  const focusKey =
    typeof search.focusKey === 'string' && search.focusKey.length > 0
      ? search.focusKey
      : undefined;
  return {
    ...(contentId ? { contentId } : {}),
    ...(versionId ? { versionId } : {}),
    ...(panel ? { panel } : {}),
    ...(focusKey ? { focusKey } : {}),
  };
}

test('validateResultCenterSearch drops stage and unknown panel', () => {
  const search = validateResultCenterSearch({
    contentId: 'pkg-1',
    panel: 'delivery',
    stage: 'action',
    focusKey: 'cta',
    junk: true,
  });
  assert.deepEqual(search, {
    contentId: 'pkg-1',
    panel: 'delivery',
    focusKey: 'cta',
  });
});

test('loaded empty catalog reports not_found for the exact route workId', () => {
  const target = parseResultCenterSearch('work-route-only', {
    panel: 'run',
  });
  const outcome = resolveRouteResultTarget({ target, works: [] });
  assert.equal(outcome.kind, 'not_found');
  if (outcome.kind !== 'not_found') return;
  assert.equal(outcome.requested.workId, 'work-route-only');
  assert.equal(outcome.requested.panel, 'run');
});

test('loaded catalog not_found for unknown workId never returns another work', () => {
  const target = parseResultCenterSearch('missing', {});
  const outcome = resolveRouteResultTarget({
    target,
    works: [
      {
        workId: 'work-latest',
        workspaceId: 'ws-1',
        contentIds: [],
        versionIdsByContentId: {},
      },
    ],
    workspaceId: 'ws-1',
  });
  assert.equal(outcome.kind, 'not_found');
  if (outcome.kind !== 'not_found') return;
  assert.equal(outcome.requested.workId, 'missing');
  assert.notEqual(outcome.requested.workId, 'work-latest');
});
