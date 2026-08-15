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
  contentHashFromAssetObjectKey,
  draftSourceFromWorkspaceAsset,
  findSlotFreeFallbackRecipe,
  listEligibleLibraryAssetsForSlots,
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

const publishedForLens = (
  recipeId: string,
  lensId: BrowserRecipeProjection['lensId'],
  requirements: RecipeSourceRequirement[]
): Pick<
  BrowserRecipeProjection,
  'recipeId' | 'lensId' | 'status' | 'sourceRequirements' | 'revisionId'
> => ({
  ...published(recipeId, requirements),
  lensId,
});

test('video launch recipes have no slot-free fallback (V31-85)', () => {
  const fallback = findSlotFreeFallbackRecipe({
    recipes: [
      publishedForLens('recipe.douyin_project_video', 'video', [
        { slot: 'case_media', required: true, kinds: ['image', 'video'] },
      ]),
      publishedForLens('recipe.reuse_content.video_adapt', 'video', [
        {
          slot: 'source_content',
          required: true,
          kinds: ['content', 'work', 'content_package'],
        },
      ]),
    ],
    lensId: 'video',
    excludeRecipeId: 'recipe.douyin_project_video',
  });
  assert.equal(fallback, null);
});

test('a published video recipe without required slots is a real fallback', () => {
  const fallback = findSlotFreeFallbackRecipe({
    recipes: [
      publishedForLens('recipe.douyin_project_video', 'video', [
        { slot: 'case_media', required: true, kinds: ['image', 'video'] },
      ]),
      publishedForLens('recipe.video_freeform', 'video', []),
    ],
    lensId: 'video',
    excludeRecipeId: 'recipe.douyin_project_video',
  });
  assert.equal(fallback?.recipeId, 'recipe.video_freeform');
});

const CASE_MEDIA: RecipeSourceRequirement = {
  slot: 'case_media',
  required: true,
  kinds: ['image', 'video'],
};

test('an attached library image satisfies case_media the same way case_image does', () => {
  const missing = listUnsatisfiedRequiredSlots({
    requirements: [CASE_MEDIA],
    sources: [{ id: 'asset-1', kind: 'image' }],
  });
  assert.deepEqual(missing, []);
});

test('content hash is read from the product-asset object key', () => {
  const hash = 'ab'.repeat(32);
  assert.equal(
    contentHashFromAssetObjectKey(`ws_1/assets/user-1/${hash}.png`),
    hash
  );
  assert.equal(
    contentHashFromAssetObjectKey('ws_1/assets/user-1/nope.png'),
    null
  );
});

test('case_image library pick lists only authorized customer_case and before_after', () => {
  const hash = 'cd'.repeat(32);
  const eligible = listEligibleLibraryAssetsForSlots({
    requirements: [CASE_IMAGE],
    assets: [
      {
        id: 'asset-case',
        authorizationStatus: 'authorized',
        category: 'customer_case',
        mediaType: 'image',
        objectKey: `ws_1/assets/u/${hash}.png`,
      },
      {
        id: 'asset-before',
        authorizationStatus: 'authorized',
        category: 'before_after',
        mediaType: 'image',
        objectKey: `ws_1/assets/u/${hash}.png`,
      },
      {
        id: 'asset-store',
        authorizationStatus: 'authorized',
        category: 'store',
        mediaType: 'image',
        objectKey: `ws_1/assets/u/${hash}.png`,
      },
      {
        id: 'asset-pending',
        authorizationStatus: 'pending',
        category: 'customer_case',
        mediaType: 'image',
        objectKey: `ws_1/assets/u/${hash}.png`,
      },
    ],
  });
  assert.deepEqual(
    eligible.map((asset) => asset.id),
    ['asset-case', 'asset-before']
  );
});

test('picking a library asset produces a draft source that satisfies the slot', () => {
  const hash = 'ef'.repeat(32);
  const asset = {
    id: 'asset-0a411f19',
    authorizationStatus: 'authorized' as const,
    category: 'customer_case' as const,
    mediaType: 'image' as const,
    objectKey: `ws_1/assets/u/${hash}.png`,
    consentScope: 'public_marketing' as const,
    containsPerson: false,
  };
  const source = draftSourceFromWorkspaceAsset(asset);
  assert.ok(source);
  assert.equal(source.revision, hash);
  const missing = listUnsatisfiedRequiredSlots({
    requirements: [CASE_IMAGE],
    sources: [source],
    workspaceAssets: [asset],
  });
  assert.deepEqual(missing, []);
});

test('empty or ineligible library is an honest empty list', () => {
  assert.deepEqual(
    listEligibleLibraryAssetsForSlots({
      requirements: [CASE_IMAGE],
      assets: [],
    }),
    []
  );
  assert.deepEqual(
    listEligibleLibraryAssetsForSlots({
      requirements: [CASE_IMAGE],
      assets: [
        {
          id: 'asset-store',
          authorizationStatus: 'authorized',
          category: 'store',
          mediaType: 'image',
          objectKey: `ws_1/assets/u/${'aa'.repeat(32)}.png`,
        },
      ],
    }),
    []
  );
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
