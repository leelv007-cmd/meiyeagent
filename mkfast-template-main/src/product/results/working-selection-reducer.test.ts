/**
 * Working selection reducer unit tests (WT-D2 / #100, D-095).
 * Covers: sort / cover / remove / restore / drift.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyWorkingSelectionDriftChoice,
  buildSaveWorkingSelectionDraftCommand,
  createEmptyWorkingSelection,
  isWorkingSelectionExpired,
  parseWorkingSelection,
  reduceWorkingSelection,
  serializeWorkingSelection,
  workingSelectionAdoptPayload,
  WORKING_SELECTION_TTL_MS,
  type WorkingSelectionState,
} from './working-selection-reducer';

const NOW = '2026-07-20T12:00:00.000Z';

function empty(overrides: Partial<WorkingSelectionState> = {}) {
  return {
    ...createEmptyWorkingSelection({
      workId: 'work-1',
      baseRevisionId: 'rev-1',
      now: NOW,
    }),
    ...overrides,
  };
}

function addMany(
  state: WorkingSelectionState,
  ids: string[]
): WorkingSelectionState {
  let current = state;
  for (const assetId of ids) {
    current = reduceWorkingSelection(current, {
      type: 'add',
      assetId,
      now: NOW,
    }).state;
  }
  return current;
}

// ---------------------------------------------------------------------------
// add / remove / restore
// ---------------------------------------------------------------------------

test('add joins selection and reports exact feedback with position', () => {
  const state = empty();
  const r1 = reduceWorkingSelection(state, {
    type: 'add',
    assetId: 'img-a',
    now: NOW,
  });
  assert.deepEqual(r1.state.orderedAssetIds, ['img-a']);
  assert.equal(r1.state.coverAssetId, 'img-a');
  assert.equal(r1.feedback, '已加入套图，第 1 张');

  const r2 = reduceWorkingSelection(r1.state, {
    type: 'add',
    assetId: 'img-b',
    now: NOW,
  });
  assert.deepEqual(r2.state.orderedAssetIds, ['img-a', 'img-b']);
  assert.equal(r2.feedback, '已加入套图，第 2 张');
});

test('add is idempotent for the same asset', () => {
  const state = addMany(empty(), ['img-a']);
  const again = reduceWorkingSelection(state, {
    type: 'add',
    assetId: 'img-a',
    now: NOW,
  });
  assert.deepEqual(again.state.orderedAssetIds, ['img-a']);
  assert.equal(again.feedback, '已加入套图，第 1 张');
});

test('remove soft-deletes and restore_removed brings it back', () => {
  const state = addMany(empty(), ['img-a', 'img-b', 'img-c']);
  const removed = reduceWorkingSelection(state, {
    type: 'remove',
    assetId: 'img-b',
    now: NOW,
  });
  assert.deepEqual(removed.state.orderedAssetIds, ['img-a', 'img-c']);
  assert.ok(removed.state.removedAssetIds.includes('img-b'));
  assert.match(removed.feedback ?? '', /已移除/);

  const restored = reduceWorkingSelection(removed.state, {
    type: 'restore_removed',
    assetId: 'img-b',
    now: NOW,
  });
  assert.ok(restored.state.orderedAssetIds.includes('img-b'));
  assert.equal(restored.state.removedAssetIds.includes('img-b'), false);
  assert.equal(restored.feedback, '已加入套图，第 3 张');
});

// ---------------------------------------------------------------------------
// sort (move_up / move_down / reorder)
// ---------------------------------------------------------------------------

test('move_up and move_down reorder with keyboard-friendly feedback', () => {
  const state = addMany(empty(), ['img-a', 'img-b', 'img-c']);
  // cover is img-a; move img-c up
  const up = reduceWorkingSelection(state, {
    type: 'move_up',
    assetId: 'img-c',
    now: NOW,
  });
  assert.deepEqual(up.state.orderedAssetIds, ['img-a', 'img-c', 'img-b']);
  assert.equal(up.feedback, '已前移到第 2 张');

  const down = reduceWorkingSelection(up.state, {
    type: 'move_down',
    assetId: 'img-a',
    now: NOW,
  });
  // cover consistency keeps cover at index 0 if coverAssetId is still img-a
  assert.equal(down.state.coverAssetId, 'img-a');
  assert.equal(down.state.orderedAssetIds[0], 'img-a');
});

test('reorder accepts a full ordered list', () => {
  const state = addMany(empty(), ['img-a', 'img-b', 'img-c']);
  const reordered = reduceWorkingSelection(state, {
    type: 'reorder',
    orderedAssetIds: ['img-c', 'img-a', 'img-b'],
    now: NOW,
  });
  // coverAssetId still img-a → forced to index 0
  assert.equal(reordered.state.coverAssetId, 'img-a');
  assert.equal(reordered.state.orderedAssetIds[0], 'img-a');
  assert.ok(reordered.state.orderedAssetIds.includes('img-c'));
});

// ---------------------------------------------------------------------------
// set cover (working selection — not canonical)
// ---------------------------------------------------------------------------

test('set_cover moves asset to index 0 with working-cover feedback', () => {
  const state = addMany(empty(), ['img-a', 'img-b', 'img-c']);
  const covered = reduceWorkingSelection(state, {
    type: 'set_cover',
    assetId: 'img-c',
    now: NOW,
  });
  assert.equal(covered.state.coverAssetId, 'img-c');
  assert.equal(covered.state.orderedAssetIds[0], 'img-c');
  assert.equal(covered.feedback, '已设为本组封面，采用这组后生效');
});

// ---------------------------------------------------------------------------
// adopt payload
// ---------------------------------------------------------------------------

test('workingSelectionAdoptPayload returns ordered ids for atomic adopt', () => {
  const state = addMany(empty(), ['img-a', 'img-b']);
  const payload = workingSelectionAdoptPayload(state);
  assert.deepEqual(payload?.assetIds, ['img-a', 'img-b']);
  assert.equal(payload?.coverAssetId, 'img-a');
  assert.equal(workingSelectionAdoptPayload(empty()), null);
});

// ---------------------------------------------------------------------------
// 7-day expiry + serialize
// ---------------------------------------------------------------------------

test('same-device restore expires after 7 days', () => {
  const state = empty({ updatedAt: '2026-07-01T00:00:00.000Z' });
  assert.equal(
    isWorkingSelectionExpired(state, '2026-07-01T01:00:00.000Z'),
    false
  );
  const afterTtl = new Date(
    Date.parse('2026-07-01T00:00:00.000Z') + WORKING_SELECTION_TTL_MS + 1
  ).toISOString();
  assert.equal(isWorkingSelectionExpired(state, afterTtl), true);
});

test('serialize / parse round-trips', () => {
  const state = addMany(empty(), ['img-a', 'img-b']);
  const raw = serializeWorkingSelection(state);
  const parsed = parseWorkingSelection(raw);
  assert.deepEqual(parsed?.orderedAssetIds, ['img-a', 'img-b']);
  assert.equal(parseWorkingSelection('not-json'), null);
});

test('hydrate restores same-device selection; expired clears', () => {
  const base = empty();
  const saved = addMany(empty(), ['img-a', 'img-b']);
  const hydrated = reduceWorkingSelection(base, {
    type: 'hydrate',
    snapshot: saved,
    currentRevisionId: 'rev-1',
    now: NOW,
  });
  assert.deepEqual(hydrated.state.orderedAssetIds, ['img-a', 'img-b']);
  assert.equal(hydrated.drift, null);

  const expired = reduceWorkingSelection(base, {
    type: 'hydrate',
    snapshot: {
      ...saved,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    currentRevisionId: 'rev-1',
    now: NOW,
  });
  assert.deepEqual(expired.state.orderedAssetIds, []);
});

// ---------------------------------------------------------------------------
// base revision drift three-way
// ---------------------------------------------------------------------------

test('hydrate detects base revision drift with three choices', () => {
  const base = empty();
  const saved = addMany(empty({ baseRevisionId: 'rev-old' }), ['img-a']);
  const result = reduceWorkingSelection(base, {
    type: 'hydrate',
    snapshot: saved,
    currentRevisionId: 'rev-new',
    now: NOW,
  });
  assert.ok(result.drift);
  assert.equal(result.drift?.kind, 'revision_drift');
  assert.deepEqual(result.drift?.choices, ['restore', 'compare', 'discard']);
  assert.deepEqual(result.state.orderedAssetIds, ['img-a']);
});

test('drift discard clears selection onto current revision', () => {
  const state = addMany(empty({ baseRevisionId: 'rev-old' }), [
    'img-a',
    'img-b',
  ]);
  const drift = {
    kind: 'revision_drift' as const,
    baseRevisionId: 'rev-old',
    currentRevisionId: 'rev-new',
    choices: ['restore', 'compare', 'discard'] as const,
  };
  const discarded = applyWorkingSelectionDriftChoice(
    state,
    drift,
    'discard',
    NOW
  );
  assert.equal(discarded.kind, 'discard');
  assert.deepEqual(discarded.state.orderedAssetIds, []);
  assert.equal(discarded.state.baseRevisionId, 'rev-new');
});

test('drift restore keeps local selection; compare exposes both revisions', () => {
  const state = addMany(empty({ baseRevisionId: 'rev-old' }), ['img-a']);
  const drift = {
    kind: 'revision_drift' as const,
    baseRevisionId: 'rev-old',
    currentRevisionId: 'rev-new',
    choices: ['restore', 'compare', 'discard'] as const,
  };
  const restored = applyWorkingSelectionDriftChoice(
    state,
    drift,
    'restore',
    NOW
  );
  assert.equal(restored.kind, 'restore');
  assert.deepEqual(restored.state.orderedAssetIds, ['img-a']);

  const compared = applyWorkingSelectionDriftChoice(
    state,
    drift,
    'compare',
    NOW
  );
  assert.equal(compared.kind, 'compare');
  if (compared.kind === 'compare') {
    assert.equal(compared.baseRevisionId, 'rev-old');
    assert.equal(compared.currentRevisionId, 'rev-new');
  }
});

// ---------------------------------------------------------------------------
// explicit save draft → Work draft command (not ContentPackage)
// ---------------------------------------------------------------------------

test('保存草稿 builds Work draft command without ContentPackage write', () => {
  const state = addMany(empty(), ['img-a', 'img-b']);
  const command = buildSaveWorkingSelectionDraftCommand(state);
  assert.equal(command.kind, 'save_work_draft_selection');
  assert.equal(command.label, '保存草稿');
  assert.deepEqual(command.orderedAssetIds, ['img-a', 'img-b']);
  assert.equal(command.workId, 'work-1');
  assert.equal(command.baseRevisionId, 'rev-1');
});
