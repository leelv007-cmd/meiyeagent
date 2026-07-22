/**
 * P1-B3 / #152 acceptance locks for image set worksurface.
 * Builds on WT-D2 working-selection + whole-set-adopt contracts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultImageSetMode,
  projectImageLibraryActions,
} from './image-role-action-matrix';
import { projectImageWorksurface } from './image-worksurface-model';
import {
  WORKING_SELECTION_TTL_MS,
  applyWorkingSelectionDriftChoice,
  buildSaveWorkingSelectionDraftCommand,
  createEmptyWorkingSelection,
  isWorkingSelectionExpired,
  parseWorkingSelection,
  reduceWorkingSelection,
  serializeWorkingSelection,
} from './working-selection-reducer';
import {
  assertNoPartialAdopt,
  buildWholeSetAdoptWriteCommand,
  validateWholeSetAdopt,
} from './whole-set-adopt';

const now = '2026-07-22T12:00:00.000Z';

test('two or more images default to set mode; single image stays single', () => {
  assert.equal(
    defaultImageSetMode({
      outputType: 'ordered_image_set',
      expectedOrAvailableCount: 2,
    }),
    'set'
  );
  assert.equal(
    defaultImageSetMode({
      outputType: 'single_image',
      expectedOrAvailableCount: 1,
    }),
    'single'
  );
  assert.equal(
    defaultImageSetMode({
      outputType: 'single_image',
      expectedOrAvailableCount: 2,
    }),
    'set'
  );
});

test('working selection only stores asset identity, order, base revision, surface version', () => {
  let state = createEmptyWorkingSelection({
    workId: 'work-img',
    baseRevisionId: 'rev-1',
    now,
  });
  state = reduceWorkingSelection(state, {
    type: 'add',
    assetId: 'asset-a',
    now,
  }).state;
  state = reduceWorkingSelection(state, {
    type: 'add',
    assetId: 'asset-b',
    now,
  }).state;
  state = reduceWorkingSelection(state, {
    type: 'set_cover',
    assetId: 'asset-b',
    now,
  }).state;

  const serialized = serializeWorkingSelection(state);
  const parsed = parseWorkingSelection(serialized);
  assert.ok(parsed);
  assert.equal(parsed!.baseRevisionId, 'rev-1');
  assert.deepEqual(parsed!.orderedAssetIds, ['asset-b', 'asset-a']);
  assert.equal(parsed!.coverAssetId, 'asset-b');
  assert.ok(typeof parsed!.surfaceVersion === 'string');
  assert.ok(typeof parsed!.workId === 'string');
  // No preview URLs / temp provider blobs in selection.
  assert.equal('previewUrl' in parsed!, false);
  assert.equal('objectKey' in parsed!, false);
});

test('same-device restore TTL is seven days; cross-device save is explicit draft', () => {
  assert.equal(WORKING_SELECTION_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  const fresh = createEmptyWorkingSelection({
    workId: 'work-img',
    baseRevisionId: 'rev-1',
    now,
  });
  assert.equal(isWorkingSelectionExpired(fresh, now), false);
  const expiredAt = new Date(
    Date.parse(now) + WORKING_SELECTION_TTL_MS + 1
  ).toISOString();
  assert.equal(isWorkingSelectionExpired(fresh, expiredAt), true);

  const withItem = reduceWorkingSelection(fresh, {
    type: 'add',
    assetId: 'asset-a',
    now,
  }).state;
  const draft = buildSaveWorkingSelectionDraftCommand(withItem);
  assert.equal(draft.kind, 'save_work_draft_selection');
  assert.equal(draft.label, '保存草稿');
  assert.deepEqual(draft.orderedAssetIds, ['asset-a']);
});

test('base revision drift offers compare / discard / restore — no silent overwrite', () => {
  let state = createEmptyWorkingSelection({
    workId: 'work-img',
    baseRevisionId: 'rev-1',
    now,
  });
  state = reduceWorkingSelection(state, {
    type: 'add',
    assetId: 'asset-a',
    now,
  }).state;
  const hydrated = reduceWorkingSelection(state, {
    type: 'hydrate',
    snapshot: state,
    currentRevisionId: 'rev-2',
    now,
  });
  assert.equal(hydrated.drift?.kind, 'revision_drift');
  assert.ok(hydrated.drift?.choices.includes('compare'));
  assert.ok(hydrated.drift?.choices.includes('discard'));
  assert.ok(hydrated.drift?.choices.includes('restore'));

  const discarded = applyWorkingSelectionDriftChoice(
    state,
    hydrated.drift!,
    'discard',
    now
  );
  assert.equal(discarded.kind, 'discard');
  if (discarded.kind === 'discard') {
    assert.equal(discarded.state.baseRevisionId, 'rev-2');
    assert.equal(discarded.state.orderedAssetIds.length, 0);
  }
});

test('adopt this set is one atomic OCC write; partial generation cannot half-adopt', () => {
  const selection = reduceWorkingSelection(
    reduceWorkingSelection(
      createEmptyWorkingSelection({
        workId: 'work-img',
        baseRevisionId: 'rev-1',
        now,
      }),
      { type: 'add', assetId: 'asset-a', now }
    ).state,
    { type: 'add', assetId: 'asset-b', now }
  ).state;

  const partial = assertNoPartialAdopt({
    selection,
    succeededAssetIds: ['asset-a'],
    failedOrPendingAssetIds: ['asset-b'],
  });
  assert.equal(partial.kind, 'rejected');

  const ok = validateWholeSetAdopt({
    selection,
    candidates: [
      {
        assetId: 'asset-a',
        persisted: true,
        rightsOk: true,
        generationOk: true,
      },
      {
        assetId: 'asset-b',
        persisted: true,
        rightsOk: true,
        generationOk: true,
      },
    ],
  });
  assert.equal(ok.kind, 'ok');
  if (ok.kind === 'ok') {
    const write = buildWholeSetAdoptWriteCommand({
      orderedAssetIds: ok.orderedAssetIds,
      workId: 'work-img',
      idempotencyKey: 'idem-1',
    });
    assert.equal(write.family, 'first_adopt');
    assert.equal(write.roleAction, 'adopt_set');
    assert.equal(write.orderedVisualAssetIds.length, 2);
  }
});

test('save to library is independent of adopt; temp candidates stay off shelf', () => {
  const withoutMedia = projectImageLibraryActions({
    focusedAssetId: 'temp-provider-url',
    selectedAssetIds: ['temp-provider-url'],
    mediaVersionReady: false,
  });
  assert.equal(withoutMedia.length, 0);

  const withMedia = projectImageLibraryActions({
    focusedAssetId: 'asset-durable',
    selectedAssetIds: ['asset-durable', 'asset-b'],
    mediaVersionReady: true,
  });
  assert.ok(withMedia.some((a) => a.kind === 'save_one'));
  assert.ok(withMedia.some((a) => a.kind === 'save_selected'));

  const view = projectImageWorksurface({
    workId: 'work-img',
    baseRevisionId: 'rev-1',
    outputType: 'ordered_image_set',
    slot: 'gallery',
    lifecycle: 'candidate',
    candidates: [
      {
        assetId: 'asset-a',
        persisted: true,
        rightsOk: true,
        generationOk: true,
      },
      {
        assetId: 'asset-b',
        persisted: true,
        rightsOk: true,
        generationOk: true,
      },
    ],
    hasContentPackage: false,
    mediaVersionReady: true,
  });
  assert.equal(view.mode, 'set');
  // Primary set action is adopt_set or add_to_set — never auto library.
  assert.ok(
    view.primaryAction === null ||
      view.primaryAction.kind === 'adopt_set' ||
      view.primaryAction.kind === 'add_to_set'
  );
  assert.ok(view.libraryActions.every((a) => a.kind.startsWith('save')));
});
