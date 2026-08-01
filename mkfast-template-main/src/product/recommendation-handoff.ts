/**
 * Typed recommendation → Composer handoff (#286 / D2 / F1).
 *
 * Prefill only: never auto-submit, never charge. `outputHint` selects a lens
 * when the recommendation knows one; absent hint leaves the lens untouched
 * (must not hardcode `copy`).
 */

import type { CreationLensId, TodayRecommendation } from '@meiye/contracts';

import { todayRecommendationIntent } from '@/product/creation-entry-model';
import {
  selectLens,
  updateUserText,
  type ComposerLensState,
} from '@/product/composer/lens-state-machine';

export type RecommendationHandoff = {
  intent: string;
  /** When set, Composer selects this lens. Absent = leave lens alone. */
  outputHint?: CreationLensId;
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
  return outputHint
    ? {
        intent: todayRecommendationIntent(recommendation),
        outputHint,
      }
    : { intent: todayRecommendationIntent(recommendation) };
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
