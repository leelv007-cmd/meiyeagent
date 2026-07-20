import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDefaultSupplyControlSnapshot } from './admin-supply-fixture';
import {
  DEFAULT_RUN_TABLE_URL_STATE,
  buildSupplyRunTablePage,
  filterSupplyRuns,
  parseRunTableUrlState,
  querySupplyRunTable,
  runTableStateToSearchString,
  serializeRunTableUrlState,
  updateRunTableUrlState,
} from './admin-supply-run-table-model';

test('parseRunTableUrlState reads facets, sort, pagination from URLSearchParams', () => {
  const params = new URLSearchParams(
    'page=2&pageSize=10&sort=latencyMs&dir=asc&operation=image.generate&status=failed&modality=image&channelKind=upstream_reseller&q=503',
  );
  const state = parseRunTableUrlState(params);
  assert.equal(state.page, 2);
  assert.equal(state.pageSize, 10);
  assert.equal(state.sort, 'latencyMs');
  assert.equal(state.dir, 'asc');
  assert.equal(state.operation, 'image.generate');
  assert.equal(state.status, 'failed');
  assert.equal(state.modality, 'image');
  assert.equal(state.channelKind, 'upstream_reseller');
  assert.equal(state.q, '503');
});

test('parseRunTableUrlState falls back to defaults on garbage input', () => {
  const state = parseRunTableUrlState({
    page: 'nope',
    pageSize: '0',
    sort: 'not-a-field',
    dir: 'sideways',
  });
  assert.equal(state.page, DEFAULT_RUN_TABLE_URL_STATE.page);
  assert.equal(state.pageSize, DEFAULT_RUN_TABLE_URL_STATE.pageSize);
  assert.equal(state.sort, DEFAULT_RUN_TABLE_URL_STATE.sort);
  assert.equal(state.dir, 'desc');
});

test('serialize ↔ parse round-trips non-default URL state', () => {
  const original = {
    page: 3,
    pageSize: 5,
    sort: 'costMicros' as const,
    dir: 'asc' as const,
    operation: 'video.generate' as const,
    status: 'acceptance_unknown' as const,
    modality: 'video' as const,
    catalogModelId: 'model-video-seedance',
    dataClass: 'public' as const,
    taskId: 'task-video-003',
  };
  const params = serializeRunTableUrlState(original);
  const restored = parseRunTableUrlState(params);
  assert.deepEqual(restored, original);

  const search = runTableStateToSearchString(original);
  assert.ok(search.startsWith('?'));
  assert.match(search, /sort=costMicros/);
  assert.match(search, /taskId=task-video-003/);
});

test('serialize omits default page/sort/dir for clean share URLs', () => {
  const params = serializeRunTableUrlState(DEFAULT_RUN_TABLE_URL_STATE);
  assert.equal(params.toString(), '');
  assert.equal(runTableStateToSearchString(DEFAULT_RUN_TABLE_URL_STATE), '');
});

test('faceted filter + sort + server pagination contract', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const page = querySupplyRunTable(snapshot.runs, {
    page: 1,
    pageSize: 2,
    sort: 'startedAt',
    dir: 'desc',
    modality: 'llm',
  });
  assert.ok(page.total >= 2);
  assert.equal(page.rows.length, 2);
  assert.ok(page.rows.every((r) => r.modality === 'llm'));
  assert.ok(page.totalPages >= 1);
  // Facets still reflect full corpus (for UI facet chips).
  assert.ok(page.facets.modalities.includes('image'));
  assert.ok(page.facets.operations.includes('copy.generate'));
});

test('status filter isolates failed runs', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const failed = filterSupplyRuns(snapshot.runs, {
    ...DEFAULT_RUN_TABLE_URL_STATE,
    status: 'failed',
  });
  assert.ok(failed.length >= 1);
  assert.ok(failed.every((r) => r.status === 'failed'));
});

test('updateRunTableUrlState resets page when filters change', () => {
  const next = updateRunTableUrlState(
    { ...DEFAULT_RUN_TABLE_URL_STATE, page: 4 },
    { status: 'failed' },
  );
  assert.equal(next.page, 1);
  assert.equal(next.status, 'failed');

  const pageOnly = updateRunTableUrlState(
    { ...DEFAULT_RUN_TABLE_URL_STATE, page: 2 },
    { page: 3 },
  );
  assert.equal(pageOnly.page, 3);
});

test('buildSupplyRunTablePage uses fixture by default', () => {
  const page = buildSupplyRunTablePage();
  assert.ok(page.total >= 1);
  assert.ok(page.rows.length >= 1);
});
