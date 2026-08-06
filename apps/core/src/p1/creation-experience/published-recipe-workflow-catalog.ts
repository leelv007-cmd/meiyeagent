/**
 * Published Recipe workflow revision catalog (Spec B / #360).
 *
 * Sole authority for skill-bind allowlists and admin workflow dropdowns:
 * merge launch-seed specs with currently published Recipe heads, then
 * return non-empty normalized workflow revision refs (deduped, sorted).
 *
 * Lens-scoped merge supports merchant skill projection (#378): only workflows
 * that belong to published recipes (or launch seeds) for the active output lens.
 */

import type { CreationLensId } from '@meiye/contracts';

import type { LaunchRecipeSeedSpec } from './launch-seeds.js';
import { LAUNCH_RECIPE_SPECS } from './launch-seeds.js';
import type { RecipeId, ServerRecipeRecord } from './types.js';

export type PublishedRecipeWorkflowSource = Pick<
  ServerRecipeRecord,
  'recipeId' | 'workflowRevisionRef'
>;

export type PublishedRecipeLensWorkflowSource = Pick<
  ServerRecipeRecord,
  'recipeId' | 'lensId' | 'workflowRevisionRef'
>;

export type LaunchRecipeWorkflowSeed = Pick<
  LaunchRecipeSeedSpec,
  'recipeId' | 'workflowRevisionRef'
>;

export type LaunchRecipeLensWorkflowSeed = Pick<
  LaunchRecipeSeedSpec,
  'recipeId' | 'lensId' | 'workflowRevisionRef'
>;

/** Trim and drop empty refs. Returns null when the value must not enter the catalog. */
export function normalizeWorkflowRevisionRef(
  value: string | undefined | null,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Merge launch-seed workflow refs with published Recipe records by recipeId.
 *
 * Rules (locked by Spec B):
 * - Same recipeId with any published DB record → DB refs override seed for that id.
 * - No published DB record for a recipeId → use seed only if still listed and ref non-empty.
 * - Losing published status removes the DB contribution; seed may fill again if present.
 * - Seed removed from the constant list or empty ref → seed contribution expires.
 * - Final output: cross-recipe dedupe + stable string sort.
 */
export function mergePublishedRecipeWorkflowRevisionRefs(
  publishedRecipes: readonly PublishedRecipeWorkflowSource[],
  launchSpecs: readonly LaunchRecipeWorkflowSeed[] = LAUNCH_RECIPE_SPECS,
): string[] {
  const dbRefsByRecipeId = new Map<RecipeId, Set<string>>();

  for (const recipe of publishedRecipes) {
    let refs = dbRefsByRecipeId.get(recipe.recipeId);
    if (!refs) {
      refs = new Set();
      dbRefsByRecipeId.set(recipe.recipeId, refs);
    }
    const normalized = normalizeWorkflowRevisionRef(recipe.workflowRevisionRef);
    if (normalized) refs.add(normalized);
  }

  const merged = new Set<string>();
  for (const refs of dbRefsByRecipeId.values()) {
    for (const ref of refs) merged.add(ref);
  }

  for (const spec of launchSpecs) {
    if (dbRefsByRecipeId.has(spec.recipeId)) continue;
    const normalized = normalizeWorkflowRevisionRef(spec.workflowRevisionRef);
    if (normalized) merged.add(normalized);
  }

  return [...merged].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

/**
 * Same merge rules as {@link mergePublishedRecipeWorkflowRevisionRefs}, but
 * only recipes (and seeds) whose `lensId` matches the requested output lens.
 * Used by merchant skill projection (#378) so copy/image_text/video stay isolated.
 */
export function mergePublishedRecipeWorkflowRevisionRefsForLens(
  lensId: CreationLensId | string,
  publishedRecipes: readonly PublishedRecipeLensWorkflowSource[],
  launchSpecs: readonly LaunchRecipeLensWorkflowSeed[] = LAUNCH_RECIPE_SPECS,
): string[] {
  const filteredPublished = publishedRecipes.filter(
    (recipe) => recipe.lensId === lensId,
  );
  const filteredSeeds = launchSpecs.filter((spec) => spec.lensId === lensId);
  return mergePublishedRecipeWorkflowRevisionRefs(
    filteredPublished,
    filteredSeeds,
  );
}
