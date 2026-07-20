/**
 * Six-card / P0 list pure model tests (C2 / #96, D-083 / D-084).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserRecipeProjection } from '@meiye/contracts';

import {
  COLD_CARD_TITLES,
  LAUNCH_CARD_SEEDS,
  P0_CARD_CAP,
  REUSE_CONTENT_ACTION_LABEL,
  REUSE_CONTENT_FAMILY_ID,
  actionLabelForLens,
  appliedTipLabel,
  ctaSwitchToLensAndApply,
} from './launch-card-seeds';
import {
  listColdCardsFromRecipes,
  listColdCardsFromSeeds,
  listP0CardsForLens,
  listVisibleRecipeCards,
} from './recipe-cards';

function makeRecipe(
  partial: Partial<BrowserRecipeProjection> &
    Pick<BrowserRecipeProjection, 'recipeId' | 'lensId' | 'presentation'>
): BrowserRecipeProjection {
  return {
    revision: 1,
    revisionId: `${partial.recipeId}@1`,
    status: 'published',
    delivery: {},
    contextPatches: {},
    sourceRequirements: [],
    modelPolicy: { mode: 'auto' },
    settingsPatches: {},
    promptRevisionRef: 'prompt@1',
    targetWorkspaceKind: partial.lensId,
    contentHash: 'hash',
    ...partial,
  };
}

test('cold seeds expose six D-083 cards with exact copy', () => {
  const cards = listColdCardsFromSeeds();
  assert.equal(cards.length, 6);
  assert.deepEqual(
    cards.map((c) => c.title),
    COLD_CARD_TITLES
  );

  assert.equal(cards[0]?.summary, '用案例图生成笔记与封面');
  assert.equal(cards[0]?.actionLabel, '选择图文并套用');
  assert.equal(cards[0]?.lensId, 'image_text');

  assert.equal(cards[1]?.summary, '用项目资料生成朋友圈文案');
  assert.equal(cards[1]?.actionLabel, '选择文案并套用');

  assert.equal(cards[2]?.summary, '用项目或活动信息生成 4 张套图');
  assert.equal(cards[3]?.summary, '用优惠和期限生成活动海报');
  assert.equal(cards[4]?.summary, '用案例素材生成 15 秒竖版成片');
  assert.equal(cards[4]?.actionLabel, '选择视频并套用');

  assert.equal(cards[5]?.kind, 'reuse_collection');
  assert.equal(cards[5]?.title, '旧内容换平台');
  assert.equal(cards[5]?.summary, '选择旧内容，再决定改成哪种形式');
  assert.equal(cards[5]?.actionLabel, REUSE_CONTENT_ACTION_LABEL);
  assert.equal(cards[5]?.lensId, null);
  assert.equal(cards[5]?.recipe, null);
});

test('action labels lock to 选择{对口}并套用', () => {
  assert.equal(actionLabelForLens('copy'), '选择文案并套用');
  assert.equal(actionLabelForLens('image_text'), '选择图文并套用');
  assert.equal(actionLabelForLens('video'), '选择视频并套用');
  assert.equal(ctaSwitchToLensAndApply('image_text'), '切换到图文并套用');
  assert.equal(
    appliedTipLabel('image_text', '从案例图写小红书'),
    '已选择图文并套用“从案例图写小红书”'
  );
});

test('eight recipes collapse to six cold cards with reuse collection', () => {
  const recipes: BrowserRecipeProjection[] = [
    makeRecipe({
      recipeId: 'recipe.case_to_xhs_note',
      familyId: 'case_to_xhs_note',
      lensId: 'image_text',
      presentation: {
        title: '从案例图写小红书',
        summary: '用案例图生成笔记与封面',
        actionLabel: '选择图文并套用',
      },
    }),
    makeRecipe({
      recipeId: 'recipe.project_intro',
      familyId: 'project_intro',
      lensId: 'copy',
      presentation: {
        title: '朋友圈项目介绍',
        summary: '用项目资料生成朋友圈文案',
        actionLabel: '选择文案并套用',
      },
    }),
    makeRecipe({
      recipeId: 'recipe.campaign_visual_set',
      familyId: 'campaign_visual_set',
      lensId: 'image_text',
      presentation: {
        title: '项目/活动套图',
        summary: '用项目或活动信息生成 4 张套图',
        actionLabel: '选择图文并套用',
      },
    }),
    makeRecipe({
      recipeId: 'recipe.promotion_poster',
      familyId: 'promotion_poster',
      lensId: 'image_text',
      presentation: {
        title: '促销海报',
        summary: '用优惠和期限生成活动海报',
        actionLabel: '选择图文并套用',
      },
    }),
    makeRecipe({
      recipeId: 'recipe.douyin_project_video',
      familyId: 'douyin_project_video',
      lensId: 'video',
      presentation: {
        title: '抖音项目成片',
        summary: '用案例素材生成 15 秒竖版成片',
        actionLabel: '选择视频并套用',
      },
    }),
    makeRecipe({
      recipeId: 'recipe.reuse_content.copy_adapt',
      familyId: REUSE_CONTENT_FAMILY_ID,
      lensId: 'copy',
      presentation: {
        title: '旧内容换平台',
        summary: '选择旧内容，再决定改成哪种形式',
        actionLabel: REUSE_CONTENT_ACTION_LABEL,
      },
    }),
    makeRecipe({
      recipeId: 'recipe.reuse_content.image_text_adapt',
      familyId: REUSE_CONTENT_FAMILY_ID,
      lensId: 'image_text',
      presentation: {
        title: '旧内容换平台',
        summary: '选择旧内容，再决定改成哪种形式',
        actionLabel: REUSE_CONTENT_ACTION_LABEL,
      },
    }),
    makeRecipe({
      recipeId: 'recipe.reuse_content.video_adapt',
      familyId: REUSE_CONTENT_FAMILY_ID,
      lensId: 'video',
      presentation: {
        title: '旧内容换平台',
        summary: '选择旧内容，再决定改成哪种形式',
        actionLabel: REUSE_CONTENT_ACTION_LABEL,
      },
    }),
  ];

  const cards = listColdCardsFromRecipes(recipes);
  assert.equal(cards.length, 6);
  const reuse = cards.find((c) => c.kind === 'reuse_collection');
  assert.ok(reuse);
  assert.equal(reuse?.reuseVariants?.copy?.lensId, 'copy');
  assert.equal(reuse?.reuseVariants?.image_text?.lensId, 'image_text');
  assert.equal(reuse?.reuseVariants?.video?.lensId, 'video');
});

test('P0 caps: image_text ≤4, video ≤3, copy ≤4', () => {
  assert.equal(P0_CARD_CAP.image_text, 4);
  assert.equal(P0_CARD_CAP.video, 3);
  assert.equal(P0_CARD_CAP.copy, 4);

  const manyImage: BrowserRecipeProjection[] = Array.from(
    { length: 6 },
    (_, i) =>
      makeRecipe({
        recipeId: `recipe.img_${i}`,
        lensId: 'image_text',
        presentation: {
          title: `图文卡${i}`,
          summary: 's',
          actionLabel: '选择图文并套用',
        },
      })
  );
  assert.equal(listP0CardsForLens(manyImage, 'image_text').length, 4);

  const manyVideo: BrowserRecipeProjection[] = Array.from(
    { length: 5 },
    (_, i) =>
      makeRecipe({
        recipeId: `recipe.vid_${i}`,
        lensId: 'video',
        presentation: {
          title: `视频卡${i}`,
          summary: 's',
          actionLabel: '选择视频并套用',
        },
      })
  );
  assert.equal(listP0CardsForLens(manyVideo, 'video').length, 3);
});

test('listVisibleRecipeCards: cold six vs lens P0', () => {
  const cold = listVisibleRecipeCards({ lensId: null });
  assert.equal(cold.length, 6);

  const imageP0 = listVisibleRecipeCards({ lensId: 'image_text' });
  assert.ok(imageP0.length <= 4);
  assert.ok(imageP0.every((c) => c.lensId === 'image_text'));
});

test('launch seeds count: five singles + one reuse collection', () => {
  const singles = LAUNCH_CARD_SEEDS.filter((s) => !s.isReuseCollection);
  const reuse = LAUNCH_CARD_SEEDS.filter((s) => s.isReuseCollection);
  assert.equal(singles.length, 5);
  assert.equal(reuse.length, 1);
});
