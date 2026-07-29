/**
 * 五类宣发任务 as the recipe pill row's grouping axis (D-164② / D-139).
 *
 * D-139 keeps the five marketing tasks「项目曝光／热点／IP／活动团购／物料」as
 * the naming and grouping dimension for recipe cards, and D-164② adopts the
 * pill form for that second level. This module is the mapping and nothing else,
 * so the grouping can be tested without rendering.
 *
 * The mapping lives here rather than in the contract: `RecipePresentation`
 * has no group field, and adding one would change the contract, the Core seeds
 * and the studio compile step — three lanes for a label the browser already
 * knows. `launch-card-seeds.ts` mirrors Core's field labels on the same
 * grounds, so this is the established side of that line.
 *
 * Groups with no recipe do not render (see `groupRecipeCardsByMarketingTask`):
 * a group that opens onto nothing is the 「无载体的想象功能」PRODUCT.md warns
 * about. 热点借势 and 品牌与个人 IP are both empty today — a real product gap,
 * recorded on the ticket, not papered over with a disabled pill.
 */

import {
  creation_entry_marketing_brand_ip,
  creation_entry_marketing_hot_topic,
  creation_entry_marketing_project_exposure,
  creation_entry_marketing_promotion_conversion,
  creation_entry_marketing_promotional_material,
} from '@/locale/paraglide/messages';

import type { RecipeCardView } from './recipe-cards';

export type MarketingTaskId =
  | 'project_exposure'
  | 'hot_topic'
  | 'brand_ip'
  | 'promotion_conversion'
  | 'promotional_material';

/** Display order of the five tasks. Empty ones are dropped, not reordered. */
export const MARKETING_TASK_ORDER: readonly MarketingTaskId[] = [
  'project_exposure',
  'promotion_conversion',
  'promotional_material',
  'hot_topic',
  'brand_ip',
];

const TASK_LABEL: Record<MarketingTaskId, () => string> = {
  brand_ip: creation_entry_marketing_brand_ip,
  hot_topic: creation_entry_marketing_hot_topic,
  project_exposure: creation_entry_marketing_project_exposure,
  promotion_conversion: creation_entry_marketing_promotion_conversion,
  promotional_material: creation_entry_marketing_promotional_material,
};

/**
 * familyId → task. Keyed by family rather than recipe so a lens variant of the
 * same family lands in the same group (`browserRecipeToTarget` and
 * `seedToRecipeTarget` both carry `familyId`).
 */
const FAMILY_TASK: Record<string, MarketingTaskId> = {
  campaign_visual_set: 'promotion_conversion',
  case_to_xhs_note: 'project_exposure',
  douyin_project_video: 'project_exposure',
  project_intro: 'project_exposure',
  promotion_poster: 'promotional_material',
};

const FALLBACK_TASK: MarketingTaskId = 'project_exposure';

export type MarketingTaskGroup = {
  id: MarketingTaskId;
  label: string;
  cards: RecipeCardView[];
};

export function marketingTaskForCard(card: RecipeCardView): MarketingTaskId {
  const familyId = card.recipe?.familyId ?? card.cardKey;
  const task = FAMILY_TASK[familyId];
  if (task) return task;
  // A recipe the mapping has not met yet is still the merchant's to use, so it
  // is shown under the broadest group rather than dropped. Silence here would
  // read as「配方没上线」on a surface that is otherwise complete.
  // Optional chain as in `auth.ts`: this module is also read by the node:test
  // runner, where there is no Vite `import.meta.env` to read.
  if (import.meta.env?.DEV === true) {
    console.warn(
      `[recipe-pill-row] familyId "${familyId}" has no marketing task; ` +
        `falling back to ${FALLBACK_TASK}`
    );
  }
  return FALLBACK_TASK;
}

/**
 * Groups the visible cards. Drops the reuse collection —「旧内容换平台」is a
 * reuse action, not a marketing task, and its click hands the intent back to
 * the conversation instead of applying a recipe, so a pill of it would be a
 * pill that does not apply. It keeps its home in the conversation's reuse
 * chips. Groups with no cards are omitted entirely.
 */
export function groupRecipeCardsByMarketingTask(
  cards: readonly RecipeCardView[]
): MarketingTaskGroup[] {
  const buckets = new Map<MarketingTaskId, RecipeCardView[]>();
  for (const card of cards) {
    if (card.kind === 'reuse_collection') continue;
    const task = marketingTaskForCard(card);
    const bucket = buckets.get(task);
    if (bucket) bucket.push(card);
    else buckets.set(task, [card]);
  }
  return MARKETING_TASK_ORDER.filter((id) => buckets.has(id)).map((id) => ({
    id,
    label: TASK_LABEL[id](),
    cards: buckets.get(id)!,
  }));
}
