/**
 * Six-card / P0 card list pure model (C2 / #96, D-083 / D-084).
 *
 * Cold: six cards (reuse family collapsed to one collection card).
 * After lens select: that lens's P0 cards — copy/image_text ≤4, video ≤3.
 * No auto-recommend / default lens.
 */

import type {
  BrowserRecipeProjection,
  BrowserSurfaceProjection,
  CreationLensId,
} from '@meiye/contracts';

import {
  LAUNCH_CARD_SEEDS,
  P0_CARD_CAP,
  REUSE_CONTENT_ACTION_LABEL,
  REUSE_CONTENT_FAMILY_ID,
  actionLabelForLens,
  type LaunchCardSeedSpec,
  type RecipeCardTarget,
  browserRecipeToTarget,
  seedToRecipeTarget,
} from './launch-card-seeds';

// ---------------------------------------------------------------------------
// Card view
// ---------------------------------------------------------------------------

export type RecipeCardKind = 'single' | 'reuse_collection';

export type RecipeCardView = {
  /** Stable card key (familyId for collection; recipeId for single). */
  cardKey: string;
  kind: RecipeCardKind;
  title: string;
  summary: string;
  /** Always-visible action label (not hover-only). */
  actionLabel: string;
  /** Target lens for single cards; null for cold reuse collection. */
  lensId: CreationLensId | null;
  /** Single-lens apply target; null for reuse collection (opens panel). */
  recipe: RecipeCardTarget | null;
  /** Reuse family variants keyed by lens (when kind === reuse_collection). */
  reuseVariants?: Partial<Record<CreationLensId, RecipeCardTarget>>;
  previewAssetRef?: string;
  order: number;
  /** When false, card stays visible but action becomes unavailableReason. */
  available: boolean;
  unavailableReason?: string;
};

// ---------------------------------------------------------------------------
// Cold six from static seeds
// ---------------------------------------------------------------------------

export function listColdCardsFromSeeds(
  seeds: readonly LaunchCardSeedSpec[] = LAUNCH_CARD_SEEDS
): RecipeCardView[] {
  return seeds
    .slice()
    .sort((a, b) => a.cardOrder - b.cardOrder)
    .map((seed) => {
      if (seed.isReuseCollection || seed.lensId == null) {
        return {
          cardKey: seed.familyId,
          kind: 'reuse_collection' as const,
          title: seed.title,
          summary: seed.summary,
          actionLabel: REUSE_CONTENT_ACTION_LABEL,
          lensId: null,
          recipe: null,
          order: seed.cardOrder,
          available: true,
        };
      }
      return {
        cardKey: seed.recipeId,
        kind: 'single' as const,
        title: seed.title,
        summary: seed.summary,
        actionLabel: seed.actionLabel,
        lensId: seed.lensId,
        recipe: seedToRecipeTarget(seed),
        order: seed.cardOrder,
        available: true,
      };
    });
}

// ---------------------------------------------------------------------------
// From live Surface / Recipe projections
// ---------------------------------------------------------------------------

function isReuseFamily(recipe: BrowserRecipeProjection): boolean {
  return (
    recipe.familyId === REUSE_CONTENT_FAMILY_ID ||
    recipe.recipeId.startsWith('recipe.reuse_content')
  );
}

/**
 * Collapse eight published recipes into six cold cards.
 * Reuse family → one collection card with three lens variants.
 */
export function listColdCardsFromRecipes(
  recipes: readonly BrowserRecipeProjection[]
): RecipeCardView[] {
  if (recipes.length === 0) {
    return listColdCardsFromSeeds();
  }

  const singles: RecipeCardView[] = [];
  const reuseByLens: Partial<Record<CreationLensId, RecipeCardTarget>> = {};
  let reusePresentation: BrowserRecipeProjection | null = null;
  let reuseOrder = 5;

  for (const recipe of recipes) {
    if (isReuseFamily(recipe)) {
      reuseByLens[recipe.lensId] = browserRecipeToTarget(recipe);
      if (!reusePresentation) reusePresentation = recipe;
      continue;
    }
    const refOrder =
      recipes.findIndex((r) => r.revisionId === recipe.revisionId) ?? 0;
    singles.push({
      cardKey: recipe.recipeId,
      kind: 'single',
      title: recipe.presentation.title,
      summary: recipe.presentation.summary,
      actionLabel:
        recipe.presentation.actionLabel ?? actionLabelForLens(recipe.lensId),
      lensId: recipe.lensId,
      recipe: browserRecipeToTarget(recipe),
      previewAssetRef: recipe.presentation.previewAssetRef,
      order: refOrder,
      available: recipe.status === 'published',
      unavailableReason:
        recipe.status === 'published' ? undefined : '模板暂不可用',
    });
  }

  if (reusePresentation) {
    singles.push({
      cardKey: REUSE_CONTENT_FAMILY_ID,
      kind: 'reuse_collection',
      title: reusePresentation.presentation.title,
      summary: reusePresentation.presentation.summary,
      actionLabel: REUSE_CONTENT_ACTION_LABEL,
      lensId: null,
      recipe: null,
      reuseVariants: reuseByLens,
      previewAssetRef: reusePresentation.presentation.previewAssetRef,
      order: reuseOrder,
      available: true,
    });
  }

  return singles.sort((a, b) => a.order - b.order);
}

export function listColdCardsFromSurface(
  surface: BrowserSurfaceProjection | null | undefined
): RecipeCardView[] {
  if (!surface?.recipes?.length) {
    return listColdCardsFromSeeds();
  }
  // Order by surface recipeRefs.order when present.
  const byRevision = new Map(
    surface.recipes.map((r) => [r.revisionId, r] as const)
  );
  const ordered: BrowserRecipeProjection[] = [];
  for (const ref of surface.recipeRefs ?? []) {
    if (!ref.visible || !ref.featured) continue;
    const recipe = byRevision.get(ref.recipeRevisionId);
    if (recipe) ordered.push(recipe);
  }
  // Fallback: all published recipes if refs empty/mismatch.
  if (ordered.length === 0) {
    return listColdCardsFromRecipes(surface.recipes);
  }
  return listColdCardsFromRecipes(ordered);
}

// ---------------------------------------------------------------------------
// P0 after lens select
// ---------------------------------------------------------------------------

/**
 * P0 cards for a selected lens.
 * Caps: copy/image_text ≤4, video ≤3 (D-084).
 * Includes the matching reuse variant as a single-lens card when present.
 */
export function listP0CardsForLens(
  recipes: readonly BrowserRecipeProjection[],
  lensId: CreationLensId
): RecipeCardView[] {
  const cap = P0_CARD_CAP[lensId];
  const matching = recipes.filter((r) => r.lensId === lensId);
  const cards: RecipeCardView[] = matching.map((recipe, index) => {
    const isReuse = isReuseFamily(recipe);
    return {
      cardKey: recipe.recipeId,
      kind: 'single' as const,
      title: recipe.presentation.title,
      summary: recipe.presentation.summary,
      // Same-lens apply uses "套用模板" when already on lens? D-083 table:
      // same lens clean → 套用模板; cold action stays 选择{对口}并套用.
      // Card action label stays server-derived / D-083 for discoverability.
      actionLabel:
        recipe.presentation.actionLabel ??
        (isReuse
          ? actionLabelForLens(lensId)
          : actionLabelForLens(recipe.lensId)),
      lensId: recipe.lensId,
      recipe: browserRecipeToTarget(recipe),
      previewAssetRef: recipe.presentation.previewAssetRef,
      order: index,
      available: recipe.status === 'published',
      unavailableReason:
        recipe.status === 'published' ? undefined : '模板暂不可用',
    };
  });

  return cards.slice(0, cap);
}

/**
 * Visible cards given current lens selection.
 * null lens → cold six; selected → P0 for that lens.
 */
export function listVisibleRecipeCards(input: {
  lensId: CreationLensId | null;
  surface?: BrowserSurfaceProjection | null;
  recipes?: readonly BrowserRecipeProjection[] | null;
}): RecipeCardView[] {
  const recipes =
    input.recipes ??
    input.surface?.recipes ??
    ([] as BrowserRecipeProjection[]);

  if (input.lensId == null) {
    if (input.surface) return listColdCardsFromSurface(input.surface);
    if (recipes.length > 0) return listColdCardsFromRecipes(recipes);
    return listColdCardsFromSeeds();
  }

  if (recipes.length === 0 && input.surface?.recipes) {
    return listP0CardsForLens(input.surface.recipes, input.lensId);
  }
  if (recipes.length === 0) {
    // Fall back to static seeds filtered by lens.
    const cold = listColdCardsFromSeeds();
    const cap = P0_CARD_CAP[input.lensId];
    return cold
      .filter(
        (card) =>
          card.kind === 'single' &&
          card.lensId === input.lensId &&
          card.recipe != null
      )
      .slice(0, cap);
  }
  return listP0CardsForLens(recipes, input.lensId);
}
