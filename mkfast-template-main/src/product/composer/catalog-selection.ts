import type { BrowserSurfaceProjection } from '@meiye/contracts';

import { browserRecipeToTarget } from './launch-card-seeds';
import { applyRecipeToLensState } from './recipe-apply';
import type { ComposerLensState } from './lens-state-machine';

export type CatalogSelectionOutcome =
  | { kind: 'applied'; state: ComposerLensState }
  | { kind: 'surface_changed' | 'recipe_not_found'; state: ComposerLensState };

/** Apply an exact live recipe revision locally; never falls back to latest. */
export function applyCatalogRecipeSelection(input: {
  state: ComposerLensState;
  surface: BrowserSurfaceProjection;
  recipeRevisionId: string;
  surfaceRevisionId: string;
}): CatalogSelectionOutcome {
  if (input.surface.revisionId !== input.surfaceRevisionId) {
    return { kind: 'surface_changed', state: input.state };
  }
  const recipe = input.surface.recipes.find(
    (candidate) => candidate.revisionId === input.recipeRevisionId
  );
  if (!recipe) return { kind: 'recipe_not_found', state: input.state };
  return {
    kind: 'applied',
    state: applyRecipeToLensState(input.state, browserRecipeToTarget(recipe)),
  };
}
