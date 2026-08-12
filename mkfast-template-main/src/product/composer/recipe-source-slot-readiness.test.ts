/**
 * V31-73: default recipe required slots must be compared to the sources
 * this run would actually submit — before Brief / confirm / 400.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  BrowserRecipeProjection,
  RecipeSourceRequirement,
} from '@meiye/contracts';

import { P1RequestError } from '@/p1/client';

import {
  findSlotFreeFallbackRecipe,
  listUnsatisfiedRequiredSlots,
  requiredSourceSlotFromError,
} from './recipe-source-slot-readiness';

const CASE_IMAGE: RecipeSourceRequirement = {
  slot: 'case_image',
  required: true,
  kinds: ['image'],
};

test('empty sources leave a required image slot unsatisfied', () => {
  const missing = listUnsatisfiedRequiredSlots({
    requirements: [CASE_IMAGE],
    sources: [],
    workspaceAssets: [],
  });
  assert.deepEqual(
    missing.map((slot) => slot.slot),
    ['case_image']
  );
});

test('an attached image satisfies case_image the same way Core does', () => {
  const missing = listUnsatisfiedRequiredSlots({
    requirements: [CASE_IMAGE],
    sources: [{ id: 'asset-1', kind: 'asset', revision: '1' }],
    workspaceAssets: [{ id: 'asset-1', mediaType: 'image' }],
  });
  assert.deepEqual(missing, []);
});

test('a draft source tagged image satisfies without workspace lookup', () => {
  const missing = listUnsatisfiedRequiredSlots({
    requirements: [CASE_IMAGE],
    sources: [{ id: 'asset-1', kind: 'image' }],
  });
  assert.deepEqual(missing, []);
});

test('optional slots never block, even with empty sources', () => {
  const missing = listUnsatisfiedRequiredSlots({
    requirements: [
      { slot: 'campaign_asset', required: false, kinds: ['image'] },
    ],
    sources: [],
  });
  assert.deepEqual(missing, []);
});

test('unattached library images do not satisfy the submitted source set', () => {
  const missing = listUnsatisfiedRequiredSlots({
    requirements: [CASE_IMAGE],
    sources: [],
    workspaceAssets: [{ id: 'library-1', mediaType: 'image' }],
  });
  assert.equal(missing[0]?.slot, 'case_image');
});

const published = (
  recipeId: string,
  requirements: RecipeSourceRequirement[]
): Pick<
  BrowserRecipeProjection,
  'recipeId' | 'lensId' | 'status' | 'sourceRequirements' | 'revisionId'
> => ({
  recipeId,
  revisionId: `${recipeId}@1`,
  lensId: 'image_text',
  status: 'published',
  sourceRequirements: requirements,
});

test('fallback prefers a same-lens published recipe with no required slots', () => {
  const fallback = findSlotFreeFallbackRecipe({
    recipes: [
      published('recipe.case_to_xhs_note', [CASE_IMAGE]),
      published('recipe.viral_adapt', [
        { slot: 'viral_reference_image', required: false, kinds: ['image'] },
      ]),
      published('recipe.campaign_visual_set', [
        { slot: 'campaign_asset', required: false, kinds: ['image'] },
      ]),
    ],
    lensId: 'image_text',
    excludeRecipeId: 'recipe.case_to_xhs_note',
  });
  assert.equal(fallback?.recipeId, 'recipe.campaign_visual_set');
});

test('fallback is null when no usable same-lens recipe exists', () => {
  const fallback = findSlotFreeFallbackRecipe({
    recipes: [published('recipe.case_to_xhs_note', [CASE_IMAGE])],
    lensId: 'image_text',
    excludeRecipeId: 'recipe.case_to_xhs_note',
  });
  assert.equal(fallback, null);
});

test('INVALID_STATE missing-slot copy is recognized; other failures are not', () => {
  const slotError = new P1RequestError(
    'Required source slot case_image is not satisfied by the current workspace sources.',
    'INVALID_STATE',
    undefined,
    400
  );
  assert.deepEqual(requiredSourceSlotFromError(slotError), {
    slot: 'case_image',
  });
  assert.equal(
    requiredSourceSlotFromError(
      new P1RequestError('Draft is frozen.', 'INVALID_STATE', undefined, 400)
    ),
    null
  );
  assert.equal(
    requiredSourceSlotFromError(new Error('Required source slot case_image')),
    null
  );
});
