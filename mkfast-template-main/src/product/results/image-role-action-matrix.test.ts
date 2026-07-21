/**
 * Image role-action matrix pure tests (WT-D2 / #100, D-087).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultImageSetMode,
  imageA11yName,
  imageRoleFeedback,
  IMAGE_ROLE_FEEDBACK,
  IMAGE_SET_MODE_THRESHOLD,
  libraryActionFeedback,
  projectImageLibraryActions,
  projectImageRolePrimaryAction,
  toVisualAdoptionRoleAction,
  type ImageRoleContext,
} from './image-role-action-matrix';

function ctx(overrides: Partial<ImageRoleContext> = {}): ImageRoleContext {
  return {
    outputType: 'single_image',
    slot: 'standalone',
    lifecycle: 'candidate',
    setMode: false,
    workingSelectionCount: 0,
    focusedInWorkingSelection: false,
    hasContentPackage: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Primary action matrix — one adopt primary per situation
// ---------------------------------------------------------------------------

test('standalone single image → 采用这张', () => {
  const action = projectImageRolePrimaryAction(ctx());
  assert.equal(action?.kind, 'adopt_one');
  assert.equal(action?.label, '采用这张');
  assert.equal(action?.writesCanonical, true);
});

test('primary slot → 选为主图', () => {
  const action = projectImageRolePrimaryAction(ctx({ slot: 'primary' }));
  assert.equal(action?.kind, 'set_primary');
  assert.equal(action?.label, '选为主图');
});

test('cover slot → 设为封面', () => {
  const action = projectImageRolePrimaryAction(ctx({ slot: 'cover' }));
  assert.equal(action?.kind, 'set_cover');
  assert.equal(action?.label, '设为封面');
});

test('set mode join → 加入套图 (local, not canonical)', () => {
  const action = projectImageRolePrimaryAction(
    ctx({
      setMode: true,
      workingSelectionCount: 1,
      focusedInWorkingSelection: false,
    })
  );
  assert.equal(action?.kind, 'add_to_set');
  assert.equal(action?.label, '加入套图');
  assert.equal(action?.writesCanonical, false);
});

test('set mode with ≥2 selected → 采用这组', () => {
  const action = projectImageRolePrimaryAction(
    ctx({
      outputType: 'ordered_image_set',
      setMode: true,
      workingSelectionCount: 3,
      focusedInWorkingSelection: true,
      slot: 'gallery',
    })
  );
  assert.equal(action?.kind, 'adopt_set');
  assert.equal(action?.label, '采用这组');
  assert.equal(action?.writesCanonical, true);
});

test('full candidate set ready with empty selection → 采用这组', () => {
  const action = projectImageRolePrimaryAction(
    ctx({
      outputType: 'ordered_image_set',
      setMode: true,
      workingSelectionCount: 0,
      fullCandidateSetReady: true,
      fullCandidateSetCount: 4,
    })
  );
  assert.equal(action?.kind, 'adopt_set');
  assert.equal(action?.label, '采用这组');
});

test('adopted + different candidate → 替换当前图片', () => {
  const action = projectImageRolePrimaryAction(
    ctx({
      lifecycle: 'adopted',
      hasContentPackage: true,
      focusedIsCurrentSlot: false,
    })
  );
  assert.equal(action?.kind, 'replace_item');
  assert.equal(action?.label, '替换当前图片');
});

test('delivered → no adopt primary', () => {
  assert.equal(
    projectImageRolePrimaryAction(ctx({ lifecycle: 'delivered' })),
    null
  );
});

test('same situation never returns two adopt primaries (matrix is single)', () => {
  const situations: ImageRoleContext[] = [
    ctx(),
    ctx({ slot: 'primary' }),
    ctx({ slot: 'cover' }),
    ctx({
      setMode: true,
      workingSelectionCount: 2,
      focusedInWorkingSelection: true,
    }),
    ctx({
      lifecycle: 'adopted',
      hasContentPackage: true,
      focusedIsCurrentSlot: false,
    }),
  ];
  for (const situation of situations) {
    const action = projectImageRolePrimaryAction(situation);
    // One call → one action (or null). No array of near-synonyms.
    assert.ok(action === null || typeof action.kind === 'string');
  }
});

// ---------------------------------------------------------------------------
// Exact feedback strings (character-for-character)
// ---------------------------------------------------------------------------

test('feedback strings are exact D-087 copy', () => {
  assert.equal(imageRoleFeedback('adopt_one'), '已采用这张图片');
  assert.equal(imageRoleFeedback('set_primary'), '已设为主图');
  assert.equal(imageRoleFeedback('set_cover'), '已设为封面');
  assert.equal(
    imageRoleFeedback('add_to_set', { position: 2 }),
    '已加入套图，第 2 张'
  );
  assert.equal(
    imageRoleFeedback('adopt_set', { count: 4 }),
    '已采用这组，共 4 张'
  );
  assert.equal(imageRoleFeedback('replace_item'), '已替换，原版本仍可恢复');
  assert.equal(
    imageRoleFeedback('set_working_cover'),
    '已设为本组封面，采用这组后生效'
  );
  assert.equal(IMAGE_ROLE_FEEDBACK.save_to_library, '已在素材库');
});

// ---------------------------------------------------------------------------
// a11y names
// ---------------------------------------------------------------------------

test('a11y name includes order, role, and adopted state', () => {
  assert.equal(
    imageA11yName({
      order: 2,
      slot: 'gallery',
      lifecycle: 'candidate',
      pendingActionLabel: '加入套图',
    }),
    '第 2 张，套图，候选，加入套图'
  );
  assert.equal(
    imageA11yName({
      order: 1,
      slot: 'cover',
      lifecycle: 'adopted',
    }),
    '第 1 张，封面，已采用'
  );
  assert.equal(
    imageA11yName({
      order: 1,
      slot: 'gallery',
      lifecycle: 'candidate',
      isWorkingCover: true,
    }),
    '第 1 张，本组封面，候选'
  );
});

// ---------------------------------------------------------------------------
// Set mode threshold
// ---------------------------------------------------------------------------

test('default set mode threshold is 2', () => {
  assert.equal(IMAGE_SET_MODE_THRESHOLD, 2);
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
  assert.equal(
    defaultImageSetMode({
      outputType: 'ordered_image_set',
      expectedOrAvailableCount: 1,
    }),
    'set'
  );
  assert.equal(
    defaultImageSetMode({
      outputType: 'single_image',
      expectedOrAvailableCount: 4,
      explicitMode: 'single',
    }),
    'single'
  );
});

// ---------------------------------------------------------------------------
// Library independence
// ---------------------------------------------------------------------------

test('library actions independent of adopt; gated on media version readiness', () => {
  assert.deepEqual(
    projectImageLibraryActions({
      focusedAssetId: 'img-1',
      selectedAssetIds: ['img-1', 'img-2'],
      mediaVersionReady: false,
    }),
    []
  );
  const ready = projectImageLibraryActions({
    focusedAssetId: 'img-1',
    selectedAssetIds: ['img-1', 'img-2'],
    mediaVersionReady: true,
  });
  assert.equal(ready.length, 2);
  assert.equal(ready[0]?.label, '保存到素材库');
  assert.equal(ready[1]?.label, '保存选中图片到素材库');
  assert.equal(libraryActionFeedback('save_one'), '已在素材库');
});

// ---------------------------------------------------------------------------
// B1 VisualAdoptionRoleAction mapping
// ---------------------------------------------------------------------------

test('writable role actions map to B1 VisualAdoptionRoleAction', () => {
  assert.deepEqual(toVisualAdoptionRoleAction('adopt_one', 'a1'), {
    kind: 'adopt_one',
    assetId: 'a1',
  });
  assert.deepEqual(
    toVisualAdoptionRoleAction('adopt_set', 'a1', ['a1', 'a2']),
    { kind: 'adopt_set', assetIds: ['a1', 'a2'] }
  );
  assert.equal(toVisualAdoptionRoleAction('set_working_cover', 'a1'), null);
  assert.deepEqual(toVisualAdoptionRoleAction('add_to_set', 'a1'), {
    kind: 'add_to_set',
    assetId: 'a1',
  });
});
