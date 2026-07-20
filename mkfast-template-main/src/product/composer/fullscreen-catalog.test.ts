/**
 * Fullscreen catalog count gate + return restore (C3 / #97, D-093 / D-098 C5).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserRecipeProjection } from '@meiye/contracts';

import {
  CATALOG_SEARCH_GATE,
  TEMPLATE_CATALOG_CATEGORIES,
  captureCatalogReturnSnapshot,
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
  setCatalogTab,
  shouldShowCatalogSearch,
} from './fullscreen-catalog';
import type { ComposerToolEntrySeed } from './tool-entry-seeds';
import { COMPOSER_TOOL_ENTRY_SEEDS } from './tool-entry-seeds';

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

test('capability-gated tools do not count', () => {
  const tools: ComposerToolEntrySeed[] = Array.from({ length: 15 }, (_, i) => ({
    id: `tool.extra_${i}` as ComposerToolEntrySeed['id'],
    label: `工具 ${i}`,
    summary: `说明 ${i}`,
    kind: 'standalone_tool',
    container: 'dialog',
    order: i,
    categories: ['image'],
    isProStudioBanner: false,
    capabilityPublished: i < 5, // only 5 published
    entitlementLocked: false,
  }));
  assert.equal(countPublishedVisible('tools', { tools }), 5);
  assert.equal(shouldShowCatalogSearch('tools', { tools }), false);
});

test('first-ship tool seeds are below search gate', () => {
  assert.ok(COMPOSER_TOOL_ENTRY_SEEDS.length < CATALOG_SEARCH_GATE);
  assert.equal(
    shouldShowCatalogSearch('tools', { tools: COMPOSER_TOOL_ENTRY_SEEDS }),
    false
  );
});

test('task-language categories for both tabs', () => {
  const templateCats = listCategoriesForTab('templates').map((c) => c.id);
  assert.deepEqual(templateCats, [...TEMPLATE_CATALOG_CATEGORIES]);
  const toolCats = listCategoriesForTab('tools').map((c) => c.id);
  assert.deepEqual(toolCats, ['all', 'image', 'video', 'publish', 'pro']);
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
  let state = createCatalogUiState({ tab: 'tools', category: 'image' });
  state = setCatalogScroll(state, 420);
  state = { ...state, focusKey: 'tool.multi_size', query: '' };
  const snap = captureCatalogReturnSnapshot(state);
  assert.equal(snap.tab, 'tools');
  assert.equal(snap.category, 'image');
  assert.equal(snap.scrollY, 420);
  assert.equal(snap.focusKey, 'tool.multi_size');

  const restored = restoreCatalogUiState(snap);
  assert.equal(restored.tab, 'tools');
  assert.equal(restored.category, 'image');
  assert.equal(restored.scrollY, 420);
  assert.equal(restored.focusKey, 'tool.multi_size');
});

test('setCatalogTab resets category and scroll', () => {
  let state = createCatalogUiState({
    tab: 'templates',
    category: 'video',
    scrollY: 100,
  });
  state = setCatalogTab(state, 'tools');
  assert.equal(state.tab, 'tools');
  assert.equal(state.category, 'all');
  assert.equal(state.scrollY, 0);
});

test('setCatalogQuery forced empty when below search gate', () => {
  const recipes = nRecipes(5);
  let state = createCatalogUiState({ tab: 'templates' });
  state = setCatalogQuery(state, 'anything', { recipes });
  assert.equal(state.query, '');
});

test('catalog URL search is allowlisted only', () => {
  const state = createCatalogUiState({
    tab: 'tools',
    category: 'video',
    returnKey: 'rk',
    surfaceRevisionId: 'surf@1',
    query: 'x',
  });
  // Force query present even below gate for href serialization check.
  const href = catalogStateToHref({ ...state, query: 'x' });
  assert.ok(href.startsWith('/dashboard/catalog'));
  assert.ok(href.includes('tab=tools'));
  assert.ok(href.includes('category=video'));
  assert.ok(href.includes('returnKey=rk'));
  assert.ok(!/prompt|provider|userText|body/i.test(href));

  const parsed = catalogStateFromSearch(new URL(href, 'http://x').searchParams);
  assert.equal(parsed.tab, 'tools');
  assert.equal(parsed.category, 'video');
});

test('setCatalogCategory updates filter without changing tab', () => {
  let state = createCatalogUiState({ tab: 'templates' });
  state = setCatalogCategory(state, 'reuse');
  assert.equal(state.tab, 'templates');
  assert.equal(state.category, 'reuse');
});
