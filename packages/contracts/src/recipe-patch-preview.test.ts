import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecipePatchPreview,
  type BuildRecipePatchPreviewInput,
} from './recipe-patch-preview.js';

function wirePreview(input: BuildRecipePatchPreviewInput): unknown {
  return JSON.parse(JSON.stringify(buildRecipePatchPreview(input)));
}

test('recipe patch preview preserves the dirty same-lens golden wire shape', () => {
  assert.deepEqual(
    wirePreview({
      draft: {
        userText: '保留',
        sources: [{ id: 'asset-1' }],
        lensId: 'image_text',
        recipeRevisionId: 'recipe.old',
        surfaceRevisionId: 'surface.draft',
        delivery: { quantity: 2 },
        modelPolicy: { mode: 'fixed', catalogModelId: 'model.user' },
        dirtySettings: { modelPolicy: true, variantKey: true },
        settings: { variantKey: 'old' },
        confirmedQuoteRef: 'quote.confirmed',
      },
      recipe: {
        revisionId: 'recipe.new',
        lensId: 'image_text',
        delivery: { quantity: 1 },
        modelPolicy: { mode: 'auto' },
        settingsPatches: { variantKey: 'new' },
        quotePolicyRevisionRef: 'quote.policy',
      },
    }),
    {
      recipeRevisionId: 'recipe.new',
      lensId: 'image_text',
      currentLensId: 'image_text',
      conflictKind: 'same_lens_dirty',
      requiresConfirmation: true,
      conflicts: [
        {
          field: 'userText',
          action: 'preserve',
          from: '保留',
          to: '保留',
        },
        {
          field: 'sources',
          action: 'preserve',
          from: [{ id: 'asset-1' }],
          to: [{ id: 'asset-1' }],
        },
        {
          field: 'recipeRevisionId',
          action: 'change',
          from: 'recipe.old',
          to: 'recipe.new',
        },
        {
          field: 'delivery',
          action: 'change',
          from: { quantity: 2 },
          to: { quantity: 1 },
        },
        {
          field: 'modelPolicy',
          action: 'stash',
          from: { mode: 'fixed', catalogModelId: 'model.user' },
          to: { mode: 'auto' },
        },
        {
          field: 'settings.variantKey',
          action: 'stash',
          from: 'old',
          to: 'new',
        },
        {
          field: 'confirmedQuoteRef',
          action: 'stash',
          from: 'quote.confirmed',
          to: 'quote.policy',
        },
      ],
      preserve: ['userText', 'sources'],
      stash: ['modelPolicy', 'settings.variantKey', 'confirmedQuoteRef'],
      change: [
        'recipeRevisionId',
        'delivery',
        'modelPolicy',
        'settings.variantKey',
        'confirmedQuoteRef',
      ],
      primaryCtaLabel: '套用并更新设置',
      cancelCtaLabel: '取消',
      surfaceRevisionId: 'surface.draft',
      baseSurfaceRevisionId: 'surface.draft',
      baseRecipeRevisionId: 'recipe.old',
    },
  );
});

test('recipe patch preview preserves cross-lens CTA and surface override wire shape', () => {
  assert.deepEqual(
    wirePreview({
      draft: { lensId: 'copy', surfaceRevisionId: 'surface.draft' },
      recipe: {
        revisionId: 'recipe.video',
        lensId: 'video',
        delivery: {},
        modelPolicy: { mode: 'auto' },
        settingsPatches: {},
      },
      surfaceRevisionId: 'surface.override',
    }),
    {
      recipeRevisionId: 'recipe.video',
      lensId: 'video',
      currentLensId: 'copy',
      conflictKind: 'cross_lens',
      requiresConfirmation: true,
      conflicts: [
        {
          field: 'lensId',
          action: 'change',
          from: 'copy',
          to: 'video',
        },
        {
          field: 'recipeRevisionId',
          action: 'change',
          from: null,
          to: 'recipe.video',
        },
        {
          field: 'modelPolicy',
          action: 'change',
          from: null,
          to: { mode: 'auto' },
        },
      ],
      preserve: [],
      stash: [],
      change: ['lensId', 'recipeRevisionId', 'modelPolicy'],
      primaryCtaLabel: '切换到视频并套用',
      cancelCtaLabel: '取消',
      surfaceRevisionId: 'surface.override',
      baseSurfaceRevisionId: 'surface.override',
      baseRecipeRevisionId: null,
    },
  );
});
