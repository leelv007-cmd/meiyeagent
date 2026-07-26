/**
 * Single bottom-sheet mutex + restore (C3 / #97, D-084).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSingleSheetMutex,
  createComposerBottomSheetState,
  dismissComposerSheet,
  isComposerSheetOpen,
  openComposerSheet,
  sheetKindForApplyPhase,
  syncSheetWithApplyPhase,
} from './composer-bottom-sheet';

test('only one sheet can be open (mutex replace, never stack)', () => {
  let state = createComposerBottomSheetState();
  assert.equal(isComposerSheetOpen(state), false);

  state = openComposerSheet(state, {
    kind: 'conflict',
    scrollY: 120,
    focusKey: 'card-1',
    draftKey: 'draft-a',
  });
  assert.equal(state.open, 'conflict');
  assert.equal(state.restore?.scrollY, 120);
  assert.equal(state.restore?.focusKey, 'card-1');
  assertSingleSheetMutex(state);

  // Opening another kind replaces — does not nest.
  state = openComposerSheet(state, {
    kind: 'tool_confirm',
    scrollY: 200,
    focusKey: 'tool-btn',
  });
  assert.equal(state.open, 'tool_confirm');
  assert.equal(state.restore?.scrollY, 200);
  assert.notEqual(state.open, 'conflict');
  assertSingleSheetMutex(state);
});

test('dismiss restores scroll/focus snapshot and clears open', () => {
  const state = openComposerSheet(createComposerBottomSheetState(), {
    kind: 'tool_confirm',
    scrollY: 640,
    focusKey: 'tool.multi_size',
    draftKey: 'd1',
  });
  const { state: closed, restore } = dismissComposerSheet(state);
  assert.equal(closed.open, null);
  assert.equal(closed.restore, null);
  assert.deepEqual(restore, {
    scrollY: 640,
    focusKey: 'tool.multi_size',
    draftKey: 'd1',
  });

  // Idempotent when already closed.
  const again = dismissComposerSheet(closed);
  assert.equal(again.restore, null);
  assert.equal(again.state.open, null);
});

test('sheetKindForApplyPhase maps confirming only', () => {
  assert.equal(sheetKindForApplyPhase('confirming'), 'conflict');
  assert.equal(sheetKindForApplyPhase('idle'), null);
  assert.equal(sheetKindForApplyPhase('applied'), null);
});

test('syncSheetWithApplyPhase opens and dismisses with phase', () => {
  let state = createComposerBottomSheetState();
  state = syncSheetWithApplyPhase(state, 'confirming', {
    scrollY: 10,
    focusKey: 'c1',
  });
  assert.equal(state.open, 'conflict');

  state = syncSheetWithApplyPhase(state, 'idle');
  assert.equal(state.open, null);
});

test('same-kind sync is a no-op (preserves generation)', () => {
  let state = openComposerSheet(createComposerBottomSheetState(), {
    kind: 'conflict',
    scrollY: 1,
  });
  const gen = state.generation;
  state = syncSheetWithApplyPhase(state, 'confirming', { scrollY: 99 });
  assert.equal(state.generation, gen);
  assert.equal(state.restore?.scrollY, 1);
});
