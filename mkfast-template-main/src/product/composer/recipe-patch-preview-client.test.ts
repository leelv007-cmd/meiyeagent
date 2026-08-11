import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LAUNCH_CARD_SEEDS,
  seedToRecipeTarget,
  type RecipeCardTarget,
} from './launch-card-seeds';
import { buildClientRecipePatchPreview } from './recipe-patch-preview-client';

test('client preview preserves the legacy auto-model fallback for incomplete runtime targets', () => {
  const seed = LAUNCH_CARD_SEEDS.find(
    (candidate) => candidate.recipeId === 'recipe.promotion_poster'
  );
  assert.ok(seed);
  const recipe = seedToRecipeTarget(seed) as Partial<RecipeCardTarget>;
  delete recipe.modelPolicy;

  const preview = buildClientRecipePatchPreview({
    draft: { lensId: null },
    recipe: recipe as RecipeCardTarget,
  });

  assert.deepEqual(
    preview.conflicts.find((conflict) => conflict.field === 'modelPolicy'),
    {
      field: 'modelPolicy',
      action: 'change',
      from: null,
      to: { mode: 'auto' },
    }
  );
});
