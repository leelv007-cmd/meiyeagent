import assert from 'node:assert/strict';
import test from 'node:test';

import type { BrowserSurfaceProjection } from '@meiye/contracts';

import { applyCatalogRecipeSelection } from './catalog-selection';
import { createComposerLensState } from './lens-state-machine';

const surface = {
  surfaceId: 'surface.home.launch',
  revision: 7,
  revisionId: 'surface.home.launch@7',
  status: 'published',
  recipeRefs: [
    {
      recipeRevisionId: 'recipe.live@7',
      lensId: 'video',
      order: 1,
      featured: true,
      visible: true,
    },
  ],
  contentHash: 'surface-hash',
  recipes: [
    {
      recipeId: 'recipe.live',
      revisionId: 'recipe.live@7',
      lensId: 'video',
      status: 'published',
      presentation: { title: '服务端视频模板', summary: '真实版本' },
      delivery: {},
      contextPatches: {},
      sourceRequirements: [],
      modelPolicy: { mode: 'auto' },
      settingsPatches: {},
      promptRevisionRef: 'prompt@7',
      targetWorkspaceKind: 'video',
      contentHash: 'hash',
      revision: 7,
    },
  ],
} satisfies BrowserSurfaceProjection;

test('catalog selection applies the exact live recipe revision with zero server write', () => {
  const outcome = applyCatalogRecipeSelection({
    state: createComposerLensState(),
    surface,
    recipeRevisionId: 'recipe.live@7',
    surfaceRevisionId: 'surface.home.launch@7',
  });
  assert.equal(outcome.kind, 'applied');
  assert.equal(outcome.state.lensId, 'video');
  assert.equal(outcome.state.draft.recipeRevisionId, 'recipe.live@7');
});

test('catalog selection never guesses after Surface revision changes', () => {
  const state = createComposerLensState();
  const outcome = applyCatalogRecipeSelection({
    state,
    surface,
    recipeRevisionId: 'recipe.live@7',
    surfaceRevisionId: 'surface.home.launch@6',
  });
  assert.equal(outcome.kind, 'surface_changed');
  assert.equal(outcome.state, state);
});
