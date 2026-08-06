/**
 * Recipe under evaluation for the recipe-governance suite.
 *
 * Cases are derived from the subject's fact types, intent types, and output
 * contract (Spec I). The frozen fixture subject pins the committed baseline.
 */

import type { StoreFactKind } from '@meiye/contracts';

import type {
  RecipeStudioIntentType,
  RecipeStudioOutputKind,
} from '../../p1/creation-experience/recipe-studio.js';

export interface RecipeGovernanceOutputContract {
  outputKind: RecipeStudioOutputKind;
  quantity: number;
  aspectRatio?: string;
  durationSeconds?: number;
  notePageBound?: number;
}

export interface RecipeGovernanceSubject {
  recipeId: string;
  recipeRevision: number;
  /** Frozen compile prompt — stamped onto every case result as promptRevision. */
  promptRevisionRef: string;
  factTypes: readonly StoreFactKind[];
  intentTypes: readonly RecipeStudioIntentType[];
  output: RecipeGovernanceOutputContract;
}

/**
 * Frozen baseline subject: launch seed `recipe.project_intro` (wechat copy).
 * Keeps recorded artifact stable and recipe-shaped without live catalog reads.
 */
export const FIXTURE_RECIPE_GOVERNANCE_SUBJECT: RecipeGovernanceSubject = {
  recipeId: 'recipe.project_intro',
  recipeRevision: 1,
  promptRevisionRef: 'prompt.project_intro@1',
  factTypes: ['service'],
  intentTypes: ['daily_exposure'],
  output: {
    outputKind: 'copy',
    quantity: 1,
  },
};
