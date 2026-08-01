/**
 * Idle first-screen light capsules — xhs-spec §2.4 / D2 (#318).
 *
 * Beside 「今日建议」the row surfaces XHS image-text / 爆款复刻 recipes so the
 * vertical is discoverable without a new top-level nav (C4). Every chip only
 * builds a typed handoff — never auto-submits, never charges (C3).
 */

import type { CreationLensId } from '@meiye/contracts';

import type { RecommendationHandoff } from './recommendation-handoff';

export type IdleRecipeChipId = 'xhs_image_text' | 'viral_adapt';

export type IdleRecipeChip = {
  id: IdleRecipeChipId;
  /** Merchant-facing capsule label. */
  label: string;
  /** Prefill handoff — prefill only (C3). */
  handoff: RecommendationHandoff;
};

/** First-screen recipe capsules (xhs-spec §2.4 / §4.1 / §4.3). */
export const IDLE_FIRST_SCREEN_RECIPE_CHIPS: readonly IdleRecipeChip[] = [
  {
    id: 'xhs_image_text',
    label: '小红书图文',
    handoff: {
      intent: '帮我做一篇小红书图文笔记：有封面和多页内容，适合本店项目种草。',
      outputHint: 'image_text' satisfies CreationLensId,
      recipeChipId: 'xhs_image_text',
    },
  },
  {
    id: 'viral_adapt',
    label: '爆款复刻',
    handoff: {
      // Paste-track honest: no scrape, merchant supplies the reference.
      intent:
        '帮我复刻一条爆款笔记：我会粘贴原文或参考内容，请按本店项目改写成可发版本。',
      outputHint: 'image_text' satisfies CreationLensId,
      recipeChipId: 'viral_adapt',
    },
  },
];

/** Highlight chip label when a live recommendation is present. */
export function todaySuggestionChipLabel(title: string): string {
  const normalized = title.replace(/\s+/gu, ' ').trim();
  if (!normalized) return '今日建议';
  const short =
    normalized.length > 18 ? `${normalized.slice(0, 18)}…` : normalized;
  return `今日建议：${short}`;
}
