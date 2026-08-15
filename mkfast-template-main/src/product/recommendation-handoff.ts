/**
 * Typed recommendation → Composer handoff (#286 / D2 / F1).
 *
 * Prefill only: never auto-submit, never charge. `outputHint` selects a lens
 * when the recommendation knows one; absent hint leaves the lens untouched
 * (must not hardcode `copy`).
 *
 * D-C1 「空填入、脏不碰」: a chip fills an empty box and never rewrites a box the
 * merchant has already typed into. The lens state machine's own contract is
 * "Switch always keeps user text", and PRODUCT.md promises no silent overwrite;
 * the handoff used to break both by calling `updateUserText` unconditionally.
 * The lens hint and the recipe binding still land either way — only the sentence
 * is theirs.
 */

import type {
  BrowserSurfaceProjection,
  CreationLensId,
  TodayRecommendation,
} from '@meiye/contracts';

import { todayRecommendationIntent } from '@/product/creation-entry-model';
import {
  reopenComposer,
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
  /**
   * Explicit replace (example-store remix). D-C1 empty-only applies to chips;
   * a second 「复用这条结构」 must overwrite the previous sample draft.
   */
  replaceText?: boolean;
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

/** What the handoff did to the sentence in the box. */
export type RecommendationHandoffTextOutcome = 'prefilled' | 'kept_user_text';

/**
 * True when the draft already carries a sentence the merchant would mind
 * losing. Exported so the host can name the outcome in the undo bar without
 * re-deriving the rule.
 */
export function recommendationHandoffKeepsUserText(
  state: ComposerLensState
): boolean {
  return state.draft.userText.trim().length > 0;
}

/**
 * Same-tab draft restore / remix listener path. Always writes the sentence —
 * sessionStorage writes do not fire `storage` in the writing tab.
 */
export function replaceComposerDraftText(
  state: ComposerLensState,
  intent: string
): ComposerLensState {
  return updateUserText(reopenComposer(state), intent);
}

/** Apply handoff to the lens draft: lens on hint; text only into an empty box. */
export function applyRecommendationHandoff(
  state: ComposerLensState,
  handoff: RecommendationHandoff
): ComposerLensState {
  const withLens = handoff.outputHint
    ? selectLens(state, handoff.outputHint)
    : state;
  if (!handoff.replaceText && recommendationHandoffKeepsUserText(withLens)) {
    return withLens;
  }
  return replaceComposerDraftText(withLens, handoff.intent);
}

export type RecommendationRecipeHandoffOutcome = {
  kind: 'prefilled' | 'recipe_bound' | 'recipe_unavailable';
  text: RecommendationHandoffTextOutcome;
  state: ComposerLensState;
};

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
  const text: RecommendationHandoffTextOutcome =
    !input.handoff.replaceText &&
    recommendationHandoffKeepsUserText(input.state)
      ? 'kept_user_text'
      : 'prefilled';
  const prefilled = applyRecommendationHandoff(input.state, input.handoff);
  if (input.handoff.recipeChipId !== 'viral_adapt') {
    return { kind: 'prefilled', text, state: prefilled };
  }
  const surface = input.surface;
  if (!surface) return { kind: 'recipe_unavailable', text, state: prefilled };
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
  if (!recipe) return { kind: 'recipe_unavailable', text, state: prefilled };
  return {
    kind: 'recipe_bound',
    text,
    state: applyRecipeToLensState(prefilled, browserRecipeToTarget(recipe)),
  };
}
