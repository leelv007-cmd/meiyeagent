import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileVisualAdoptionRoleAction,
  VISUAL_ADOPTION_WRITE_FAMILIES,
} from './role-action-compiler.js';

const reviseTarget = {
  mode: 'revise' as const,
  packageId: 'pkg-1',
  baseVersionId: 'ver-1',
  expectedRevision: 2,
  currentOrderedVisualAssetIds: ['img-a', 'img-b', 'img-c'],
};

test('role actions compile into the same write command family', () => {
  const adoptOne = compileVisualAdoptionRoleAction(
    { kind: 'adopt_one', assetId: 'img-x' },
    { mode: 'first_adopt' },
  );
  const adoptSet = compileVisualAdoptionRoleAction(
    { kind: 'adopt_set', assetIds: ['img-1', 'img-2'] },
    { mode: 'first_adopt' },
  );
  const setPrimary = compileVisualAdoptionRoleAction(
    { kind: 'set_primary', assetId: 'img-c' },
    reviseTarget,
  );
  const setCover = compileVisualAdoptionRoleAction(
    { kind: 'set_cover', assetId: 'img-b' },
    reviseTarget,
  );
  const replaceSet = compileVisualAdoptionRoleAction(
    { kind: 'replace_set', assetIds: ['img-z', 'img-y'] },
    reviseTarget,
  );

  assert.equal(adoptOne.family, 'first_adopt');
  assert.equal(adoptSet.family, 'first_adopt');
  assert.equal(setPrimary.family, 'revise_content_package_visuals');
  assert.equal(setCover.family, 'revise_content_package_visuals');
  assert.equal(replaceSet.family, 'revise_content_package_visuals');

  for (const compiled of [
    adoptOne,
    adoptSet,
    setPrimary,
    setCover,
    replaceSet,
  ]) {
    assert.ok(
      (VISUAL_ADOPTION_WRITE_FAMILIES as readonly string[]).includes(
        compiled.family,
      ),
      `${compiled.family} must be in the write family`,
    );
  }

  assert.deepEqual(
    adoptOne.family === 'first_adopt' ? adoptOne.orderedVisualAssetIds : null,
    ['img-x'],
  );
  assert.deepEqual(
    adoptSet.family === 'first_adopt' ? adoptSet.orderedVisualAssetIds : null,
    ['img-1', 'img-2'],
  );
  // set_primary / set_cover → index 0 is cover/primary
  assert.deepEqual(
    setPrimary.family === 'revise_content_package_visuals'
      ? setPrimary.orderedVisualAssetIds
      : null,
    ['img-c', 'img-a', 'img-b'],
  );
  assert.deepEqual(
    setCover.family === 'revise_content_package_visuals'
      ? setCover.orderedVisualAssetIds
      : null,
    ['img-b', 'img-a', 'img-c'],
  );
  assert.deepEqual(
    replaceSet.family === 'revise_content_package_visuals'
      ? replaceSet.orderedVisualAssetIds
      : null,
    ['img-z', 'img-y'],
  );

  // All revise compiles share packageId + baseVersionId + expectedRevision
  for (const compiled of [setPrimary, setCover, replaceSet]) {
    assert.equal(compiled.family, 'revise_content_package_visuals');
    if (compiled.family === 'revise_content_package_visuals') {
      assert.equal(compiled.packageId, 'pkg-1');
      assert.equal(compiled.baseVersionId, 'ver-1');
      assert.equal(compiled.expectedRevision, 2);
    }
  }
});

test('add_to_set stays local working-selection and never becomes a write command', () => {
  const local = compileVisualAdoptionRoleAction(
    { kind: 'add_to_set', assetId: 'img-new' },
    reviseTarget,
  );
  assert.equal(local.family, 'local_working_selection');
  assert.equal(local.roleAction, 'add_to_set');
  assert.equal(
    (VISUAL_ADOPTION_WRITE_FAMILIES as readonly string[]).includes(local.family),
    false,
  );
});

test('adopt_set on existing package revises rather than first-adopting', () => {
  const compiled = compileVisualAdoptionRoleAction(
    { kind: 'adopt_set', assetIds: ['img-1', 'img-2', 'img-3'] },
    reviseTarget,
  );
  assert.equal(compiled.family, 'revise_content_package_visuals');
  if (compiled.family === 'revise_content_package_visuals') {
    assert.deepEqual(compiled.orderedVisualAssetIds, [
      'img-1',
      'img-2',
      'img-3',
    ]);
    assert.equal(compiled.roleAction, 'adopt_set');
  }
});

test('set_cover after first adopt on empty current list uses the single asset', () => {
  const compiled = compileVisualAdoptionRoleAction(
    { kind: 'set_cover', assetId: 'img-cover' },
    { mode: 'first_adopt' },
  );
  assert.equal(compiled.family, 'first_adopt');
  if (compiled.family === 'first_adopt') {
    assert.deepEqual(compiled.orderedVisualAssetIds, ['img-cover']);
  }
});
