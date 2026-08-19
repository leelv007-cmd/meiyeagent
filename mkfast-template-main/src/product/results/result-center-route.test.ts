/**
 * Result Center route helpers (WT-D1 / #99).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseResultCenterSearch as parseRouteSearch } from './result-center-search';
import {
  parseResultCenterSearch,
  resolveRouteResultTarget,
} from './result-target-wiring';

test('route search parser keeps stage and maps it when panel is absent', () => {
  const search = parseRouteSearch({
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
    stage: 'action',
  });
  assert.deepEqual(parseRouteSearch({ stage: 'handoff' }), {
    panel: 'delivery',
    stage: 'handoff',
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
