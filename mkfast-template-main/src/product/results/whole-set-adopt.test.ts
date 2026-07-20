/**
 * Whole-set adopt atomicity (WT-D2 / #100). Consumes B1 visual-adoption shape.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEmptyWorkingSelection,
  reduceWorkingSelection,
} from './working-selection-reducer';
import {
  assertNoPartialAdopt,
  buildWholeSetAdoptWriteCommand,
  validateWholeSetAdopt,
} from './whole-set-adopt';

const NOW = '2026-07-20T12:00:00.000Z';

function selectionWith(ids: string[]) {
  let state = createEmptyWorkingSelection({
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    now: NOW,
  });
  for (const assetId of ids) {
    state = reduceWorkingSelection(state, {
      type: 'add',
      assetId,
      now: NOW,
    }).state;
  }
  return state;
}

test('validateWholeSetAdopt accepts a complete valid set', () => {
  const selection = selectionWith(['img-1', 'img-2', 'img-3']);
  const result = validateWholeSetAdopt({
    selection,
    candidates: [
      { assetId: 'img-1', persisted: true, rightsOk: true },
      { assetId: 'img-2', persisted: true, rightsOk: true },
      { assetId: 'img-3', persisted: true, rightsOk: true },
    ],
  });
  assert.equal(result.kind, 'ok');
  if (result.kind === 'ok') {
    assert.deepEqual(result.orderedAssetIds, ['img-1', 'img-2', 'img-3']);
    assert.equal(result.roleAction.kind, 'adopt_set');
    assert.deepEqual(result.roleAction.assetIds, ['img-1', 'img-2', 'img-3']);
  }
});

test('empty selection is rejected', () => {
  const result = validateWholeSetAdopt({
    selection: createEmptyWorkingSelection({
      workId: 'work-1',
      baseRevisionId: 'rev-1',
      now: NOW,
    }),
    candidates: [],
  });
  assert.equal(result.kind, 'rejected');
  if (result.kind === 'rejected') {
    assert.equal(result.code, 'EMPTY_SELECTION');
  }
});

test('missing / rights / not-persisted rejects whole set (no partial adopt)', () => {
  const selection = selectionWith(['img-1', 'img-2']);
  const missing = validateWholeSetAdopt({
    selection,
    candidates: [{ assetId: 'img-1', persisted: true, rightsOk: true }],
  });
  assert.equal(missing.kind, 'rejected');
  if (missing.kind === 'rejected') {
    assert.equal(missing.code, 'MISSING_ASSET');
    assert.ok(missing.failedAssetIds.includes('img-2'));
  }

  const rights = validateWholeSetAdopt({
    selection,
    candidates: [
      { assetId: 'img-1', persisted: true, rightsOk: true },
      { assetId: 'img-2', persisted: true, rightsOk: false },
    ],
  });
  assert.equal(rights.kind, 'rejected');
  if (rights.kind === 'rejected') {
    assert.equal(rights.code, 'RIGHTS_REVOKED');
  }

  const notPersisted = validateWholeSetAdopt({
    selection,
    candidates: [
      { assetId: 'img-1', persisted: true, rightsOk: true },
      { assetId: 'img-2', persisted: false, rightsOk: true },
    ],
  });
  assert.equal(notPersisted.kind, 'rejected');
  if (notPersisted.kind === 'rejected') {
    assert.equal(notPersisted.code, 'NOT_PERSISTED');
  }
});

test('partial generation success cannot be partially adopted', () => {
  const selection = selectionWith(['img-ok', 'img-fail']);
  const result = assertNoPartialAdopt({
    selection,
    succeededAssetIds: ['img-ok'],
    failedOrPendingAssetIds: ['img-fail'],
  });
  assert.equal(result.kind, 'rejected');
  if (result.kind === 'rejected') {
    assert.equal(result.code, 'PARTIAL_SET_FORBIDDEN');
    assert.ok(result.failedAssetIds.includes('img-fail'));
    assert.match(result.message, /不得部分采用/);
  }
});

test('stale base revision rejects adopt when package exists', () => {
  const selection = selectionWith(['img-1', 'img-2']);
  const result = validateWholeSetAdopt({
    selection,
    candidates: [
      { assetId: 'img-1', persisted: true, rightsOk: true },
      { assetId: 'img-2', persisted: true, rightsOk: true },
    ],
    currentRevisionId: 'rev-other',
    requireRevisionMatch: true,
  });
  assert.equal(result.kind, 'rejected');
  if (result.kind === 'rejected') {
    assert.equal(result.code, 'REVISION_STALE');
  }
});

test('buildWholeSetAdoptWriteCommand is atomic single-family write', () => {
  const first = buildWholeSetAdoptWriteCommand({
    orderedAssetIds: ['img-1', 'img-2'],
    workId: 'work-1',
    idempotencyKey: 'idem-1',
  });
  assert.equal(first.family, 'first_adopt');
  assert.equal(first.roleAction, 'adopt_set');
  assert.deepEqual(first.orderedVisualAssetIds, ['img-1', 'img-2']);

  const revise = buildWholeSetAdoptWriteCommand({
    orderedAssetIds: ['img-3', 'img-1'],
    workId: 'work-1',
    idempotencyKey: 'idem-2',
    package: {
      packageId: 'pkg-1',
      baseVersionId: 'ver-1',
      expectedRevision: 3,
    },
  });
  assert.equal(revise.family, 'revise_content_package_visuals');
  if (revise.family === 'revise_content_package_visuals') {
    assert.equal(revise.expectedRevision, 3);
    assert.equal(revise.packageId, 'pkg-1');
    assert.deepEqual(revise.orderedVisualAssetIds, ['img-3', 'img-1']);
  }
});
