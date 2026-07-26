/**
 * A2 / #89 — RecipePatchPreview three states (D-083).
 * 同对口覆盖手改 / 跨对口 / 无冲突直通
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RecipeDraftFields } from '@meiye/contracts';
import {
  CTA_APPLY_AND_UPDATE_SETTINGS,
  CTA_CANCEL,
  buildRecipePatchPreview,
  ctaSwitchToLensAndApply,
  type RecipePatchTarget,
} from './recipe-patch-preview.js';
import { seedLaunchCatalogInMemory } from './launch-seeds.js';

function posterRecipe(
  overrides: Partial<RecipePatchTarget> = {},
): RecipePatchTarget {
  return {
    recipeId: 'recipe.promotion_poster',
    revisionId: 'recipe.promotion_poster@3',
    lensId: 'image_text',
    presentation: {
      title: '促销海报',
      summary: '用优惠和期限生成活动海报',
      actionLabel: '选择图文并套用',
    },
    delivery: {
      deliverableKind: 'poster',
      quantity: 1,
      aspectRatio: '3:4',
    },
    modelPolicy: { mode: 'auto' },
    settingsPatches: {
      variantKey: 'poster',
      editableAspectRatios: ['3:4', '1:1', '9:16'],
    },
    quotePolicyRevisionRef: 'quote.policy@1',
    ...overrides,
  };
}

function copyRecipe(
  overrides: Partial<RecipePatchTarget> = {},
): RecipePatchTarget {
  return {
    recipeId: 'recipe.project_intro',
    revisionId: 'recipe.project_intro@3',
    lensId: 'copy',
    presentation: {
      title: '朋友圈项目介绍',
      summary: '用项目资料生成朋友圈文案',
      actionLabel: '选择文案并套用',
    },
    delivery: {
      platform: 'wechat_moments',
      deliverableKind: 'copy_document',
      quantity: 1,
    },
    modelPolicy: { mode: 'auto' },
    settingsPatches: { variantKey: 'wechat_copy' },
    quotePolicyRevisionRef: 'quote.policy@1',
    ...overrides,
  };
}

describe('buildRecipePatchPreview (D-083)', () => {
  it('passthrough: cold draft with user text/sources needs no confirmation', () => {
    const draft: RecipeDraftFields = {
      userText: '帮我写一条朋友圈',
      sources: [{ kind: 'image', id: 'asset-1' }],
      lensId: null,
      surfaceRevisionId: 'surface.home.launch@3',
    };
    const preview = buildRecipePatchPreview({
      draft,
      recipe: posterRecipe(),
    });

    assert.equal(preview.conflictKind, 'none');
    assert.equal(preview.requiresConfirmation, false);
    assert.equal(preview.primaryCtaLabel, null);
    assert.equal(preview.cancelCtaLabel, null);
    assert.ok(preview.preserve.includes('userText'));
    assert.ok(preview.preserve.includes('sources'));
    assert.ok(preview.change.includes('lensId'));
    assert.ok(preview.change.includes('delivery'));
    assert.equal(preview.currentLensId, null);
    assert.equal(preview.lensId, 'image_text');
    assert.equal(preview.baseSurfaceRevisionId, 'surface.home.launch@3');
    assert.equal(preview.surfaceRevisionId, 'surface.home.launch@3');
    assert.equal(preview.recipeRevisionId, 'recipe.promotion_poster@3');

    // Preserve entries are actual preserve actions.
    const textConflict = preview.conflicts.find((c) => c.field === 'userText');
    assert.equal(textConflict?.action, 'preserve');
  });

  it('passthrough: same lens with no dirty protected fields', () => {
    const draft: RecipeDraftFields = {
      userText: '已有文案',
      lensId: 'image_text',
      recipeRevisionId: 'recipe.case_to_xhs_note@3',
      delivery: {
        platform: 'xiaohongshu',
        deliverableKind: 'note',
        notePageBound: 3,
        quantity: 1,
        aspectRatio: '3:4',
      },
      modelPolicy: { mode: 'auto' },
      settings: { variantKey: 'xhs_image_text' },
    };
    const preview = buildRecipePatchPreview({
      draft,
      recipe: posterRecipe(),
      currentLens: 'image_text',
    });

    assert.equal(preview.conflictKind, 'none');
    assert.equal(preview.requiresConfirmation, false);
    assert.equal(preview.primaryCtaLabel, null);
    assert.ok(preview.preserve.includes('userText'));
    // Delivery actually differs → listed under change, not a confirmation trigger.
    assert.ok(preview.change.includes('delivery'));
    assert.ok(!preview.stash.includes('modelPolicy'));
  });

  it('same-lens dirty: overwrites hand-edited model/params with 套用并更新设置', () => {
    const draft: RecipeDraftFields = {
      userText: '手改过的正文',
      sources: [{ kind: 'image', id: 'a1' }],
      lensId: 'image_text',
      recipeRevisionId: 'recipe.promotion_poster@3',
      delivery: {
        deliverableKind: 'poster',
        quantity: 1,
        aspectRatio: '1:1', // user-changed aspect
      },
      modelPolicy: { mode: 'fixed', catalogModelId: 'model.user-picked' },
      dirtySettings: {
        modelPolicy: { mode: 'fixed', catalogModelId: 'model.user-picked' },
        params: { steps: 40 },
      },
      settings: {
        variantKey: 'poster',
        params: { steps: 40 },
        editableAspectRatios: ['3:4', '1:1', '9:16'],
      },
      confirmedQuoteRef: 'quote.snap@user-confirmed',
      surfaceRevisionId: 'surface.home.launch@3',
    };

    const preview = buildRecipePatchPreview({
      draft,
      recipe: posterRecipe({
        modelPolicy: { mode: 'auto' },
      }),
    });

    assert.equal(preview.conflictKind, 'same_lens_dirty');
    assert.equal(preview.requiresConfirmation, true);
    assert.equal(preview.primaryCtaLabel, CTA_APPLY_AND_UPDATE_SETTINGS);
    assert.equal(preview.cancelCtaLabel, CTA_CANCEL);
    assert.ok(preview.preserve.includes('userText'));
    assert.ok(preview.preserve.includes('sources'));
    assert.ok(preview.stash.includes('modelPolicy'));
    assert.ok(preview.stash.includes('confirmedQuoteRef'));
    assert.equal(preview.baseRecipeRevisionId, 'recipe.promotion_poster@3');
    assert.equal(preview.baseSurfaceRevisionId, 'surface.home.launch@3');
    assert.equal(preview.currentLensId, 'image_text');
    assert.equal(preview.lensId, 'image_text');

    // Actual diffs only — model from fixed → auto.
    const model = preview.conflicts.find((c) => c.field === 'modelPolicy');
    assert.equal(model?.action, 'stash');
    assert.deepEqual(model?.from, {
      mode: 'fixed',
      catalogModelId: 'model.user-picked',
    });
  });

  it('cross-lens: CTA is 切换到{对口}并套用 and freezes base revisions', () => {
    const draft: RecipeDraftFields = {
      userText: '当前文案草稿',
      sources: [{ kind: 'text', id: 'fact-1' }],
      lensId: 'copy',
      recipeRevisionId: 'recipe.project_intro@3',
      delivery: {
        platform: 'wechat_moments',
        deliverableKind: 'copy_document',
        quantity: 1,
      },
      modelPolicy: { mode: 'auto' },
      settings: { variantKey: 'wechat_copy' },
      surfaceRevisionId: 'surface.home.launch@3',
    };

    const target = posterRecipe();
    const preview = buildRecipePatchPreview({
      draft,
      recipe: target,
      currentLens: 'copy',
    });

    assert.equal(preview.conflictKind, 'cross_lens');
    assert.equal(preview.requiresConfirmation, true);
    assert.equal(
      preview.primaryCtaLabel,
      ctaSwitchToLensAndApply('image_text'),
    );
    assert.equal(preview.primaryCtaLabel, '切换到图文并套用');
    assert.equal(preview.cancelCtaLabel, CTA_CANCEL);
    assert.ok(preview.preserve.includes('userText'));
    assert.ok(preview.preserve.includes('sources'));
    assert.ok(preview.change.includes('lensId'));
    assert.ok(preview.change.includes('delivery'));
    assert.equal(preview.currentLensId, 'copy');
    assert.equal(preview.lensId, 'image_text');
    assert.equal(preview.baseRecipeRevisionId, 'recipe.project_intro@3');
    assert.equal(preview.baseSurfaceRevisionId, 'surface.home.launch@3');
    assert.equal(preview.recipeRevisionId, target.revisionId);

    const lens = preview.conflicts.find((c) => c.field === 'lensId');
    assert.equal(lens?.action, 'change');
    assert.equal(lens?.from, 'copy');
    assert.equal(lens?.to, 'image_text');
  });

  it('does not invent diffs when delivery already matches recipe', () => {
    const recipe = copyRecipe();
    const draft: RecipeDraftFields = {
      lensId: 'copy',
      delivery: { ...recipe.delivery },
      modelPolicy: { mode: 'auto' },
      settings: { variantKey: 'wechat_copy' },
      recipeRevisionId: recipe.revisionId,
    };
    const preview = buildRecipePatchPreview({ draft, recipe });
    assert.equal(preview.conflictKind, 'none');
    assert.ok(!preview.change.includes('delivery'));
    assert.ok(!preview.change.includes('recipeRevisionId'));
    // No lens change when already same.
    assert.ok(!preview.change.includes('lensId'));
  });

  it('works against published launch seed revisions', async () => {
    const { result } = await seedLaunchCatalogInMemory();
    const poster = result.recipes.find(
      (r) => r.recipeId === 'recipe.promotion_poster',
    );
    assert.ok(poster);

    const preview = buildRecipePatchPreview({
      draft: {
        lensId: 'copy',
        userText: 'hello',
        recipeRevisionId: result.recipes[1]!.revisionId,
        surfaceRevisionId: result.surface.revisionId,
      },
      recipe: {
        recipeId: poster.recipeId,
        revisionId: poster.revisionId,
        lensId: poster.lensId,
        presentation: poster.presentation,
        delivery: poster.delivery,
        modelPolicy: poster.modelPolicy,
        settingsPatches: poster.settingsPatches,
        quotePolicyRevisionRef: poster.quotePolicyRevisionRef,
      },
    });

    assert.equal(preview.conflictKind, 'cross_lens');
    assert.equal(preview.primaryCtaLabel, '切换到图文并套用');
    assert.equal(preview.baseSurfaceRevisionId, result.surface.revisionId);
    assert.equal(preview.recipeRevisionId, poster.revisionId);
  });
});
