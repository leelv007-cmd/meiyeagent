/**
 * Typed recommendation → Composer handoff (#286 / D2 / F1).
 *
 * Prefill only: never auto-submit, never charge. `outputHint` selects a lens
 * when the recommendation knows one; absent hint leaves the lens untouched
 * (must not hardcode `copy`).
 */

import type {
  BrowserSurfaceProjection,
  CreationLensId,
  TodayRecommendation,
} from '@meiye/contracts';

import { todayRecommendationIntent } from '@/product/creation-entry-model';
import {
  selectLens,
  updateUserText,
  type ComposerLensState,
} from '@/product/composer/lens-state-machine';
import { browserRecipeToTarget } from '@/product/composer/launch-card-seeds';
import { applyRecipeToLensState } from '@/product/composer/recipe-apply';

export type RecommendationHandoff = {
  intent: string;
  /** When set, Composer selects this lens. Absent = leave lens alone. */
  outputHint?: CreationLensId;
  /**
   * Idle recipe chip id when the handoff comes from first-screen capsules.
   * Host may start a structured journey (e.g. viral_adapt paste-track #324).
   */
  recipeChipId?: 'xhs_image_text' | 'viral_adapt';
};

/**
 * Build a handoff from a recommendation. Optional `outputHint` is caller-supplied
 * until the harness projects a stable field; recommendations without a hint
 * must not force a lens.
 */
export function buildRecommendationHandoff(
  recommendation: Pick<
    TodayRecommendation,
    'customerAction' | 'title' | 'whyNow'
  >,
  outputHint?: CreationLensId
): RecommendationHandoff {
  const intent = todayRecommendationIntent(recommendation);
  return outputHint ? { intent, outputHint } : { intent };
}

/** Apply handoff to the lens draft: text always; lens only when hint is present. */
export function applyRecommendationHandoff(
  state: ComposerLensState,
  handoff: RecommendationHandoff
): ComposerLensState {
  const withLens = handoff.outputHint
    ? selectLens(state, handoff.outputHint)
    : state;
  return updateUserText(withLens, handoff.intent);
}

export type RecommendationRecipeHandoffOutcome =
  | { kind: 'prefilled'; state: ComposerLensState }
  | { kind: 'recipe_bound'; state: ComposerLensState }
  | { kind: 'recipe_unavailable'; state: ComposerLensState };

/**
 * Bind structured chips to their exact visible, published server Recipe.
 * Missing catalog state fails closed; it must never drift to the first recipe
 * sharing the same lens.
 */
export function applyRecommendationHandoffWithRecipe(input: {
  state: ComposerLensState;
  handoff: RecommendationHandoff;
  surface?: BrowserSurfaceProjection;
}): RecommendationRecipeHandoffOutcome {
  const prefilled = applyRecommendationHandoff(input.state, input.handoff);
  if (input.handoff.recipeChipId !== 'viral_adapt') {
    return { kind: 'prefilled', state: prefilled };
  }
  const surface = input.surface;
  if (!surface) return { kind: 'recipe_unavailable', state: prefilled };
  const visibleRevisions = new Set(
    surface.recipeRefs
      .filter((reference) => reference.visible)
      .map((reference) => reference.recipeRevisionId)
  );
  const recipe = surface.recipes.find(
    (candidate) =>
      candidate.recipeId === 'recipe.viral_adapt' &&
      candidate.lensId === 'image_text' &&
      candidate.status === 'published' &&
      visibleRevisions.has(candidate.revisionId)
  );
  if (!recipe) return { kind: 'recipe_unavailable', state: prefilled };
  return {
    kind: 'recipe_bound',
    state: applyRecipeToLensState(prefilled, browserRecipeToTarget(recipe)),
  };
}
