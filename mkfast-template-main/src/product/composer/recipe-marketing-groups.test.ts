import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LAUNCH_CARD_SEEDS,
  REUSE_CONTENT_FAMILY_ID,
} from './launch-card-seeds';
import { listColdCardsFromSeeds } from './recipe-cards';
import {
  MARKETING_TASK_ORDER,
  groupRecipeCardsByMarketingTask,
  marketingTaskForCard,
} from './recipe-marketing-groups';
import type { RecipeCardView } from './recipe-cards';

function card(overrides: Partial<RecipeCardView>): RecipeCardView {
  return {
    actionLabel: '选择图文并套用',
    available: true,
    cardKey: 'recipe.x',
    kind: 'single',
    lensId: 'image_text',
    order: 0,
    recipe: null,
    summary: '说明',
    title: '标题',
    ...overrides,
  } as RecipeCardView;
}

test('the cold catalog lands in three groups, in the declared order', () => {
  const groups = groupRecipeCardsByMarketingTask(listColdCardsFromSeeds());

  assert.deepEqual(
    groups.map((group) => group.id),
    ['project_exposure', 'promotion_conversion', 'promotional_material']
  );
  assert.deepEqual(
    groups.map((group) => group.cards.length),
    [3, 1, 1]
  );
  // Order comes from the declared list, not from whichever recipe was seen
  // first — the row must not reshuffle itself as the catalog changes.
  const declared = MARKETING_TASK_ORDER.filter((id) =>
    groups.some((group) => group.id === id)
  );
  assert.deepEqual(
    groups.map((group) => group.id),
    declared
  );
});

test('热点借势 and 品牌与个人 IP are absent, not empty', () => {
  const groups = groupRecipeCardsByMarketingTask(listColdCardsFromSeeds());

  // Both are real product gaps today. A rendered group that opens onto nothing
  // is the imagined feature with no carrier behind it, so they do not appear
  // at all — and no group appears with zero cards, whatever its id.
  assert.equal(
    groups.some((group) => group.id === 'hot_topic'),
    false
  );
  assert.equal(
    groups.some((group) => group.id === 'brand_ip'),
    false
  );
  assert.equal(
    groups.every((group) => group.cards.length > 0),
    true
  );
});

test('the reuse collection never becomes a pill', () => {
  const groups = groupRecipeCardsByMarketingTask([
    card({ cardKey: 'reuse_content', kind: 'reuse_collection', lensId: null }),
  ]);

  // Every other pill applies a recipe; this one hands a sentence back to the
  // conversation. A pill that does not apply would be a pill that lies.
  assert.deepEqual(groups, []);
});

test('a recipe the mapping has not met is shown, not dropped', () => {
  const unknown = card({ cardKey: 'recipe.brand_new', title: '全新配方' });

  assert.equal(marketingTaskForCard(unknown), 'project_exposure');
  const groups = groupRecipeCardsByMarketingTask([unknown]);
  assert.deepEqual(
    groups.flatMap((group) => group.cards.map((item) => item.cardKey)),
    ['recipe.brand_new']
  );
});

test('a lens variant groups by its family, not by its recipe id', () => {
  const variant = card({
    cardKey: 'recipe.promotion_poster.copy',
    recipe: { familyId: 'promotion_poster' } as RecipeCardView['recipe'],
  });

  // `cardKey` carries the recipe id, which varies per lens; grouping on it
  // would scatter one family across the row as lenses are added.
  assert.equal(marketingTaskForCard(variant), 'promotional_material');
});

test('every known recipe family is mapped, not caught by the fallback', () => {
  // The fallback exists so an unrecognised recipe is still offered rather than
  // dropped — but a family that ships in this repo landing there means the row
  // quietly mis-files it, and nothing goes red. Core seeds the same familyIds
  // this mirror lists, so covering the mirror covers the catalog.
  const unmapped = LAUNCH_CARD_SEEDS.filter(
    (seed) => seed.familyId !== REUSE_CONTENT_FAMILY_ID
  )
    .map((seed) => seed.familyId)
    .filter(
      (familyId) =>
        marketingTaskForCard({
          cardKey: familyId,
          recipe: { familyId },
        } as never) === 'project_exposure' &&
        !['case_to_xhs_note', 'project_intro', 'douyin_project_video'].includes(
          familyId
        )
    );

  assert.deepEqual(unmapped, []);
});
