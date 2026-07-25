/**
 * First-ship six-card presentation (D-082 / D-083).
 *
 * Mirror of core `launch-seeds` field labels — browser must not import core.
 * Titles / summaries / action labels locked to D-083 wording; later Surface
 * revisions may override presentation at runtime via BrowserRecipeProjection.
 */

import type {
  BrowserRecipeProjection,
  CreationLensId,
  RecipeDeliveryDefaults,
  RecipeId,
  RecipeSourceRequirement,
} from '@meiye/contracts';

import { COMPOSER_LENS_LABELS } from './lens-labels';

/** Shared family for the three "旧内容换平台" variants (D-082). */
export const REUSE_CONTENT_FAMILY_ID = 'reuse_content';

/** Reuse-family cold action — no lens preselection (D-083). */
export const REUSE_CONTENT_ACTION_LABEL = '选择创作形式';

/** Action labels locked to D-083 wording. */
export function actionLabelForLens(lensId: CreationLensId): string {
  return `选择${COMPOSER_LENS_LABELS[lensId]}并套用`;
}

/** CTA locked to D-083 conflict confirm (A2). */
export const CTA_APPLY_AND_UPDATE_SETTINGS = '套用并更新设置';
export const CTA_CANCEL = '取消';

export function ctaSwitchToLensAndApply(lensId: CreationLensId): string {
  return `切换到${COMPOSER_LENS_LABELS[lensId]}并套用`;
}

/** After-apply tip: cold / same-lens apply. */
export function appliedTipLabel(
  lensId: CreationLensId,
  recipeTitle: string
): string {
  return `已选择${COMPOSER_LENS_LABELS[lensId]}并套用“${recipeTitle}”`;
}

/** After-apply tip: cross-lens confirm. */
export function switchedTipLabel(
  lensId: CreationLensId,
  recipeTitle: string
): string {
  return `已切换到${COMPOSER_LENS_LABELS[lensId]}并套用“${recipeTitle}”`;
}

export const UNDO_LABEL = '撤销';

/** Reuse panel incomplete primary CTA (D-083 §6). */
export const REUSE_INCOMPLETE_CTA = '先选择创作形式和目标载体';

/** P0 card caps after lens select (D-084). */
export const P0_CARD_CAP: Record<CreationLensId, number> = {
  copy: 4,
  image_text: 4,
  video: 3,
};

/**
 * Static first-ship card specs (D-083 table).
 * Used when Surface projection is not yet loaded; runtime prefers live recipes.
 */
export type LaunchCardSeedSpec = {
  recipeId: RecipeId;
  familyId: string;
  variantKey: string;
  /** null for cold reuse card (user must pick form). */
  lensId: CreationLensId | null;
  title: string;
  summary: string;
  actionLabel: string;
  delivery: RecipeDeliveryDefaults;
  sourceRequirements: RecipeSourceRequirement[];
  cardOrder: number;
  /** True when this seed is the reuse-family collection card (not a single variant). */
  isReuseCollection?: boolean;
};

export const LAUNCH_CARD_SEEDS: readonly LaunchCardSeedSpec[] = [
  {
    recipeId: 'recipe.case_to_xhs_note',
    familyId: 'case_to_xhs_note',
    variantKey: 'xhs_image_text',
    lensId: 'image_text',
    title: '从案例图写小红书',
    summary: '用案例图生成笔记与封面',
    actionLabel: '选择图文并套用',
    delivery: {
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverableKind: 'note',
      quantity: 1,
      aspectRatio: '3:4',
    },
    sourceRequirements: [
      { slot: 'case_image', required: true, kinds: ['image'] },
    ],
    cardOrder: 0,
  },
  {
    recipeId: 'recipe.project_intro',
    familyId: 'project_intro',
    variantKey: 'wechat_copy',
    lensId: 'copy',
    title: '朋友圈项目介绍',
    summary: '用项目资料生成朋友圈文案',
    actionLabel: '选择文案并套用',
    delivery: {
      contentPackagePlatform: 'wechat_moments',
      distributionTarget: 'assisted_handoff',
      deliverableKind: 'copy_document',
      quantity: 1,
    },
    sourceRequirements: [
      { slot: 'project_facts', required: true, kinds: ['text'] },
    ],
    cardOrder: 1,
  },
  {
    recipeId: 'recipe.campaign_visual_set',
    familyId: 'campaign_visual_set',
    variantKey: 'image_set',
    lensId: 'image_text',
    title: '项目/活动套图',
    summary: '用项目或活动信息生成 4 张套图',
    actionLabel: '选择图文并套用',
    delivery: {
      contentPackagePlatform: 'generic',
      distributionTarget: 'export',
      deliverableKind: 'image_set',
      quantity: 4,
      aspectRatio: '3:4',
    },
    sourceRequirements: [
      { slot: 'campaign_facts', required: true, kinds: ['text'] },
      { slot: 'campaign_asset', required: false, kinds: ['image'] },
    ],
    cardOrder: 2,
  },
  {
    recipeId: 'recipe.promotion_poster',
    familyId: 'promotion_poster',
    variantKey: 'poster',
    lensId: 'image_text',
    title: '促销海报',
    summary: '用优惠和期限生成活动海报',
    actionLabel: '选择图文并套用',
    delivery: {
      contentPackagePlatform: 'offline_material',
      distributionTarget: 'export',
      deliverableKind: 'poster',
      quantity: 1,
      aspectRatio: '3:4',
    },
    sourceRequirements: [
      { slot: 'promotion_facts', required: true, kinds: ['text'] },
      { slot: 'hero_visual', required: false, kinds: ['image'] },
    ],
    cardOrder: 3,
  },
  {
    recipeId: 'recipe.douyin_project_video',
    familyId: 'douyin_project_video',
    variantKey: 'douyin_video',
    lensId: 'video',
    title: '抖音项目成片',
    summary: '用案例素材生成 15 秒竖版成片',
    actionLabel: '选择视频并套用',
    delivery: {
      contentPackagePlatform: 'douyin',
      distributionTarget: 'export',
      deliverableKind: 'video_package',
      quantity: 1,
      aspectRatio: '9:16',
      durationSeconds: 15,
    },
    sourceRequirements: [
      { slot: 'case_media', required: true, kinds: ['image', 'video'] },
    ],
    cardOrder: 4,
  },
  {
    recipeId: 'recipe.reuse_content',
    familyId: REUSE_CONTENT_FAMILY_ID,
    variantKey: 'collection',
    lensId: null,
    title: '旧内容换平台',
    summary: '选择旧内容，再决定改成哪种形式',
    actionLabel: REUSE_CONTENT_ACTION_LABEL,
    delivery: {},
    sourceRequirements: [
      {
        slot: 'source_content',
        required: true,
        kinds: ['content', 'work', 'content_package'],
      },
    ],
    cardOrder: 5,
    isReuseCollection: true,
  },
];

/** Cold-start six card titles in D-083 order. */
export const COLD_CARD_TITLES = LAUNCH_CARD_SEEDS.map((s) => s.title);

/**
 * Minimal recipe-like shape for apply / preview.
 * Accepts BrowserRecipeProjection or a local seed-derived stub.
 */
export type RecipeCardTarget = {
  recipeId: RecipeId;
  revisionId: string;
  lensId: CreationLensId;
  familyId?: string;
  presentation: {
    title: string;
    summary: string;
    actionLabel?: string;
    previewAssetRef?: string;
  };
  delivery: RecipeDeliveryDefaults;
  modelPolicy: { mode: 'auto' | 'fixed'; catalogModelId?: string };
  settingsPatches: Record<string, unknown>;
  sourceRequirements: RecipeSourceRequirement[];
  quotePolicyRevisionRef?: string;
  contextPatches?: Record<string, unknown>;
};

/** Build a local stub target from a single-lens launch seed (for offline/tests). */
export function seedToRecipeTarget(
  seed: LaunchCardSeedSpec,
  revisionId = `${seed.recipeId}@1`
): RecipeCardTarget {
  if (seed.lensId == null) {
    throw new Error('reuse collection seed has no single lens target');
  }
  return {
    recipeId: seed.recipeId,
    revisionId,
    lensId: seed.lensId,
    familyId: seed.familyId,
    presentation: {
      title: seed.title,
      summary: seed.summary,
      actionLabel: seed.actionLabel,
    },
    delivery: { ...seed.delivery },
    modelPolicy: { mode: 'auto' },
    settingsPatches: { variantKey: seed.variantKey },
    sourceRequirements: seed.sourceRequirements.map((s) => ({ ...s })),
  };
}

/** Project a browser recipe into the card target shape. */
export function browserRecipeToTarget(
  recipe: BrowserRecipeProjection
): RecipeCardTarget {
  return {
    recipeId: recipe.recipeId,
    revisionId: recipe.revisionId,
    lensId: recipe.lensId,
    familyId: recipe.familyId,
    presentation: { ...recipe.presentation },
    delivery: { ...recipe.delivery },
    modelPolicy: { ...recipe.modelPolicy },
    settingsPatches: { ...(recipe.settingsPatches ?? {}) },
    sourceRequirements: (recipe.sourceRequirements ?? []).map((s) => ({
      ...s,
    })),
    quotePolicyRevisionRef: recipe.quotePolicyRevisionRef,
    contextPatches: recipe.contextPatches
      ? { ...recipe.contextPatches }
      : undefined,
  };
}
