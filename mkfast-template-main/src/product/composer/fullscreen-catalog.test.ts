/**
 * Fullscreen catalog count gate + return restore (C3 / #97, D-093 / D-098 C5).
 * Standalone tools tab retired (D-177 / #419).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  BrowserRecipeProjection,
  BrowserSurfaceProjection,
} from '@meiye/contracts';

import {
  CATALOG_SEARCH_GATE,
  TEMPLATE_CATALOG_CATEGORIES,
  captureCatalogReturnSnapshot,
  catalogItemSourceFromLive,
  catalogStateFromSearch,
  catalogStateToHref,
  countPublishedVisible,
  createCatalogUiState,
  filterCatalogItems,
  listCatalogItems,
  listCategoriesForTab,
  projectFullscreenCatalogView,
  restoreCatalogUiState,
  setCatalogCategory,
  setCatalogQuery,
  setCatalogScroll,
  shouldShowCatalogSearch,
} from './fullscreen-catalog';

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

function nRecipes(count: number, status: 'published' | 'draft' = 'published') {
  const lenses = ['copy', 'image_text', 'video'] as const;
  return Array.from({ length: count }, (_, i) =>
    makeRecipe({
      recipeId: `recipe.item_${i}`,
      lensId: lenses[i % 3]!,
      status,
      presentation: {
        title: `模板 ${i}`,
        summary: `说明 ${i}`,
      },
    })
  );
}

test('search gate constant is 12', () => {
  assert.equal(CATALOG_SEARCH_GATE, 12);
});

test('<12 published-visible → no search UI', () => {
  const recipes = nRecipes(11);
  assert.equal(countPublishedVisible('templates', { recipes }), 11);
  assert.equal(shouldShowCatalogSearch('templates', { recipes }), false);

  const view = projectFullscreenCatalogView(
    createCatalogUiState({ tab: 'templates' }),
    { recipes }
  );
  assert.equal(view.showSearch, false);
  assert.equal(view.publishedVisibleCount, 11);
});

test('≥12 published-visible → show search gate (no match impl)', () => {
  const recipes = nRecipes(12);
  assert.equal(countPublishedVisible('templates', { recipes }), 12);
  assert.equal(shouldShowCatalogSearch('templates', { recipes }), true);

  const view = projectFullscreenCatalogView(
    createCatalogUiState({ tab: 'templates', query: 'ignored-for-filter' }),
    { recipes }
  );
  assert.equal(view.showSearch, true);
  // Query is retained for URL restore but NOT applied as a filter this ticket.
  assert.equal(view.items.length, 12);
});

test('unpublished items do not count toward search gate', () => {
  const recipes = [
    ...nRecipes(10, 'published'),
    ...nRecipes(5, 'draft').map((r, i) => ({
      ...r,
      recipeId: `recipe.draft_${i}`,
      revisionId: `recipe.draft_${i}@1`,
    })),
  ];
  assert.equal(countPublishedVisible('templates', { recipes }), 10);
  assert.equal(shouldShowCatalogSearch('templates', { recipes }), false);
});

test('Surface-hidden recipes never render or count when every ref is hidden', () => {
  const recipes = nRecipes(2);
  const surface = {
    surfaceId: 'surface.home.launch',
    revision: 1,
    revisionId: 'surface.home.launch@1',
    status: 'published',
    recipeRefs: recipes.map((recipe, order) => ({
      recipeRevisionId: recipe.revisionId,
      lensId: recipe.lensId,
      order,
      featured: false,
      visible: false,
    })),
    contentHash: 'hash',
    recipes,
  } satisfies BrowserSurfaceProjection;
  assert.equal(countPublishedVisible('templates', { surface }), 0);
  assert.deepEqual(
    listCatalogItems('templates', { surface }).map(
      (item) => item.publishedVisible
    ),
    [false, false]
  );
});

test('live Surface projects template items from server recipes', () => {
  const recipe = makeRecipe({
    recipeId: 'recipe.live',
    revisionId: 'recipe.live@7',
    lensId: 'copy',
    presentation: { title: '服务端模板', summary: '实时 recipe' },
  });
  const surface = {
    surfaceId: 'surface.home.launch',
    revision: 7,
    revisionId: 'surface.home.launch@7',
    status: 'published',
    contentHash: 'surface-hash',
    recipeRefs: [
      {
        recipeRevisionId: recipe.revisionId,
        lensId: 'copy',
        order: 3,
        featured: true,
        visible: true,
      },
    ],
    recipes: [recipe],
  } satisfies BrowserSurfaceProjection;

  const source = catalogItemSourceFromLive(surface);
  const templateItems = listCatalogItems('templates', source);
  assert.equal(templateItems[0]?.title, '服务端模板');
  assert.equal(templateItems[0]?.recipeRevisionId, 'recipe.live@7');
  assert.equal(source.surface, surface);
  assert.equal(source.recipes, surface.recipes);
});

test('task-language categories for templates tab', () => {
  const templateCats = listCategoriesForTab('templates').map((c) => c.id);
  assert.deepEqual(templateCats, [...TEMPLATE_CATALOG_CATEGORIES]);
});

test('filter by category keeps only published-visible matches', () => {
  const recipes = [
    makeRecipe({
      recipeId: 'recipe.copy_1',
      lensId: 'copy',
      presentation: { title: '文案模板', summary: 's' },
    }),
    makeRecipe({
      recipeId: 'recipe.video_1',
      lensId: 'video',
      presentation: { title: '视频模板', summary: 's' },
    }),
    makeRecipe({
      recipeId: 'recipe.draft_copy',
      lensId: 'copy',
      status: 'draft',
      presentation: { title: '草稿', summary: 's' },
    }),
  ];
  const items = listCatalogItems('templates', { recipes });
  const copyOnly = filterCatalogItems(items, 'copy');
  assert.equal(copyOnly.length, 1);
  assert.equal(copyOnly[0]?.id, 'recipe.copy_1');
});

test('return restore snapshot round-trips tab/filter/scroll/focus', () => {
  let state = createCatalogUiState({ tab: 'templates', category: 'video' });
  state = setCatalogScroll(state, 420);
  state = { ...state, focusKey: 'recipe.video_1', query: '' };
  const snap = captureCatalogReturnSnapshot(state);
  assert.equal(snap.tab, 'templates');
  assert.equal(snap.category, 'video');
  assert.equal(snap.scrollY, 420);
  assert.equal(snap.focusKey, 'recipe.video_1');

  const restored = restoreCatalogUiState(snap);
  assert.equal(restored.tab, 'templates');
  assert.equal(restored.category, 'video');
  assert.equal(restored.scrollY, 420);
  assert.equal(restored.focusKey, 'recipe.video_1');
});

test('setCatalogQuery forced empty when below search gate', () => {
  const recipes = nRecipes(5);
  let state = createCatalogUiState({ tab: 'templates' });
  state = setCatalogQuery(state, 'anything', { recipes });
  assert.equal(state.query, '');
});

test('catalog URL search is allowlisted only', () => {
  const state = createCatalogUiState({
    tab: 'templates',
    category: 'video',
    returnKey: 'rk',
    surfaceRevisionId: 'surf@1',
    query: 'x',
  });
  // Force query present even below gate for href serialization check.
  const href = catalogStateToHref({ ...state, query: 'x' });
  assert.ok(href.startsWith('/dashboard/catalog'));
  assert.ok(href.includes('tab=templates'));
  assert.ok(href.includes('category=video'));
  assert.ok(href.includes('returnKey=rk'));
  assert.ok(!/prompt|provider|userText|body/i.test(href));
  // Supply-side revision refs stay off the merchant's address bar (PRODUCT.md).
  assert.ok(!href.includes('surfaceRevisionId'));

  const parsed = catalogStateFromSearch(new URL(href, 'http://x').searchParams);
  assert.equal(parsed.tab, 'templates');
  assert.equal(parsed.category, 'video');
});

test('setCatalogCategory updates filter without changing tab', () => {
  let state = createCatalogUiState({ tab: 'templates' });
  state = setCatalogCategory(state, 'reuse');
  assert.equal(state.tab, 'templates');
  assert.equal(state.category, 'reuse');
});

test('empty catalog label is templates-only', () => {
  const view = projectFullscreenCatalogView(createCatalogUiState(), {
    recipes: [],
  });
  assert.equal(view.view.empty, true);
  assert.equal(view.view.emptyLabel, '暂无可用模板');
});
