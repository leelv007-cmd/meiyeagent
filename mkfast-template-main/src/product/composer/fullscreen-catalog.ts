/**
 * Fullscreen templates catalog model (C3 / #97, D-084 / D-093 / D-098 C5).
 *
 * Single tab: 模板. Task-language categories.
 * published-visible count + 12-item search gate (no search UI below gate).
 * Search index/match intentionally NOT implemented this ticket.
 * Return restores filter / scroll / focus.
 * Standalone tools tab retired (D-177 / #419).
 */

import type {
  BrowserRecipeProjection,
  BrowserSurfaceProjection,
  CreationLensId,
} from '@meiye/contracts';

import {
  buildComposerCatalogHref,
  parseComposerCatalogSearch,
  type ComposerCatalogSearchParams,
} from './composer-nav';

// ---------------------------------------------------------------------------
// Tabs & categories
// ---------------------------------------------------------------------------

export const CATALOG_TABS = ['templates'] as const;
export type CatalogTab = (typeof CATALOG_TABS)[number];

export const CATALOG_TAB_LABELS: Record<CatalogTab, string> = {
  templates: '模板',
};

/** Template task-language categories (D-093). */
export const TEMPLATE_CATALOG_CATEGORIES = [
  'featured',
  'copy',
  'image_text',
  'video',
  'reuse',
] as const;

export type TemplateCatalogCategory =
  (typeof TEMPLATE_CATALOG_CATEGORIES)[number];

export const TEMPLATE_CATALOG_CATEGORY_LABELS: Record<
  TemplateCatalogCategory,
  string
> = {
  featured: '精选',
  copy: '文案',
  image_text: '图文',
  video: '视频',
  reuse: '内容复用',
};

/** Search appears only when published-visible count ≥ this (D-093 / D-098 C5). */
export const CATALOG_SEARCH_GATE = 12;

// ---------------------------------------------------------------------------
// Catalog items
// ---------------------------------------------------------------------------

export type CatalogItemKind = 'template';

export type CatalogItemView = {
  id: string;
  kind: CatalogItemKind;
  title: string;
  summary: string;
  order: number;
  /** Task-language category ids this item belongs to. */
  categories: string[];
  /**
   * Counts toward search gate only when true:
   * published && visible && capability gate open (D-093).
   */
  publishedVisible: boolean;
  locked?: boolean;
  lockReason?: string;
  lensId?: CreationLensId | null;
  recipeId?: string;
  recipeRevisionId?: string;
};

export type CatalogItemSource = {
  /** Live surface recipes (preferred). */
  surface?: BrowserSurfaceProjection | null;
  recipes?: readonly BrowserRecipeProjection[] | null;
};

/** Join live server surface with browser-only category presentation. */
export function catalogItemSourceFromLive(
  surface: BrowserSurfaceProjection
): CatalogItemSource {
  return {
    surface,
    recipes: surface.recipes,
  };
}

// ---------------------------------------------------------------------------
// Return / restore snapshot
// ---------------------------------------------------------------------------

export type CatalogReturnRestoreSnapshot = {
  tab: CatalogTab;
  category: string;
  scrollY: number;
  focusKey?: string;
  /** Only restored when search gate is open. */
  query?: string;
  surfaceRevisionId?: string;
  returnKey?: string;
};

export type CatalogUiState = {
  tab: CatalogTab;
  category: string;
  scrollY: number;
  focusKey: string | null;
  query: string;
  surfaceRevisionId: string | null;
  returnKey: string | null;
};

export function createCatalogUiState(
  partial: Partial<CatalogUiState> = {}
): CatalogUiState {
  return {
    tab: partial.tab ?? 'templates',
    category: partial.category ?? 'featured',
    scrollY: partial.scrollY ?? 0,
    focusKey: partial.focusKey ?? null,
    query: partial.query ?? '',
    surfaceRevisionId: partial.surfaceRevisionId ?? null,
    returnKey: partial.returnKey ?? null,
  };
}

export function captureCatalogReturnSnapshot(
  state: CatalogUiState
): CatalogReturnRestoreSnapshot {
  return {
    tab: state.tab,
    category: state.category,
    scrollY: state.scrollY,
    ...(state.focusKey ? { focusKey: state.focusKey } : {}),
    ...(state.query ? { query: state.query } : {}),
    ...(state.surfaceRevisionId
      ? { surfaceRevisionId: state.surfaceRevisionId }
      : {}),
    ...(state.returnKey ? { returnKey: state.returnKey } : {}),
  };
}

export function restoreCatalogUiState(
  snapshot: CatalogReturnRestoreSnapshot
): CatalogUiState {
  return createCatalogUiState({
    tab: snapshot.tab,
    category: snapshot.category,
    scrollY: snapshot.scrollY,
    focusKey: snapshot.focusKey ?? null,
    query: snapshot.query ?? '',
    surfaceRevisionId: snapshot.surfaceRevisionId ?? null,
    returnKey: snapshot.returnKey ?? null,
  });
}

// ---------------------------------------------------------------------------
// Project items
// ---------------------------------------------------------------------------

function isReuseRecipe(recipe: BrowserRecipeProjection): boolean {
  return (
    recipe.familyId === 'reuse_content' ||
    recipe.recipeId.startsWith('recipe.reuse_content')
  );
}

function templateCategoriesFor(
  recipe: BrowserRecipeProjection,
  featured: boolean
): TemplateCatalogCategory[] {
  const cats: TemplateCatalogCategory[] = [];
  if (featured) cats.push('featured');
  if (isReuseRecipe(recipe)) {
    cats.push('reuse');
  } else if (recipe.lensId === 'copy') {
    cats.push('copy');
  } else if (recipe.lensId === 'image_text') {
    cats.push('image_text');
  } else if (recipe.lensId === 'video') {
    cats.push('video');
  }
  return cats.length > 0 ? cats : ['featured'];
}

function projectTemplateItems(source: CatalogItemSource): CatalogItemView[] {
  const surface = source.surface;
  const recipes =
    source.recipes ?? surface?.recipes ?? ([] as BrowserRecipeProjection[]);
  if (recipes.length === 0) return [];

  const featuredIds = new Set<string>();
  const visibleIds = new Set<string>();
  const orderByRevision = new Map<string, number>();
  const hasSurfaceRecipeRefs = Boolean(surface?.recipeRefs?.length);

  if (surface?.recipeRefs?.length) {
    for (const ref of surface.recipeRefs) {
      orderByRevision.set(ref.recipeRevisionId, ref.order);
      if (ref.visible) visibleIds.add(ref.recipeRevisionId);
      if (ref.visible && ref.featured) featuredIds.add(ref.recipeRevisionId);
    }
  }

  return recipes.map((recipe, index) => {
    const featured = !hasSurfaceRecipeRefs
      ? true
      : featuredIds.has(recipe.revisionId);
    const surfaceVisible = !hasSurfaceRecipeRefs
      ? true
      : visibleIds.has(recipe.revisionId);
    const publishedVisible = recipe.status === 'published' && surfaceVisible;
    return {
      id: recipe.recipeId,
      kind: 'template' as const,
      title: recipe.presentation.title,
      summary: recipe.presentation.summary,
      order: orderByRevision.get(recipe.revisionId) ?? index,
      categories: templateCategoriesFor(recipe, featured),
      publishedVisible,
      lensId: recipe.lensId,
      recipeId: recipe.recipeId,
      recipeRevisionId: recipe.revisionId,
    };
  });
}

export function listCatalogItems(
  tab: CatalogTab,
  source: CatalogItemSource = {}
): CatalogItemView[] {
  void tab;
  const items = projectTemplateItems(source);
  return items.slice().sort((a, b) => a.order - b.order);
}

/**
 * Count only published && visible items.
 * Unpublished / not-through-gate items do not count (D-093).
 */
export function countPublishedVisible(
  tab: CatalogTab,
  source: CatalogItemSource = {}
): number {
  return listCatalogItems(tab, source).filter((item) => item.publishedVisible)
    .length;
}

/**
 * Search gate: show search UI only when published-visible count ≥ 12.
 * First ship builds the gate only — no search index/match implementation.
 */
export function shouldShowCatalogSearch(
  tab: CatalogTab,
  source: CatalogItemSource = {}
): boolean {
  return countPublishedVisible(tab, source) >= CATALOG_SEARCH_GATE;
}

export function listCategoriesForTab(tab: CatalogTab): {
  id: string;
  label: string;
}[] {
  void tab;
  return TEMPLATE_CATALOG_CATEGORIES.map((id) => ({
    id,
    label: TEMPLATE_CATALOG_CATEGORY_LABELS[id],
  }));
}

export function filterCatalogItems(
  items: readonly CatalogItemView[],
  category: string
): CatalogItemView[] {
  // Only published-visible items appear in the browsable list.
  const visible = items.filter((item) => item.publishedVisible);
  if (!category || category === 'all' || category === 'featured') {
    if (category === 'featured') {
      return visible.filter((item) => item.categories.includes('featured'));
    }
    return visible;
  }
  return visible.filter((item) => item.categories.includes(category));
}

// ---------------------------------------------------------------------------
// Catalog view model
// ---------------------------------------------------------------------------

export type FullscreenCatalogView = {
  tab: CatalogTab;
  tabLabels: Record<CatalogTab, string>;
  categories: { id: string; label: string }[];
  activeCategory: string;
  items: CatalogItemView[];
  publishedVisibleCount: number;
  /** True only when count ≥ CATALOG_SEARCH_GATE. */
  showSearch: boolean;
  /**
   * Query string from URL/state — NOT applied as a filter this ticket
   * (search implementation deferred; gate only).
   */
  query: string;
  scrollY: number;
  focusKey: string | null;
  view: {
    empty: boolean;
    emptyLabel: string;
  };
};

export function projectFullscreenCatalogView(
  state: CatalogUiState,
  source: CatalogItemSource = {}
): FullscreenCatalogView {
  const allItems = listCatalogItems(state.tab, source);
  const publishedVisibleCount = allItems.filter(
    (i) => i.publishedVisible
  ).length;
  const showSearch = publishedVisibleCount >= CATALOG_SEARCH_GATE;
  const items = filterCatalogItems(allItems, state.category);
  // Intentionally ignore state.query for filtering (gate-only this ticket).
  return {
    tab: state.tab,
    tabLabels: { ...CATALOG_TAB_LABELS },
    categories: listCategoriesForTab(state.tab),
    activeCategory: state.category,
    items,
    publishedVisibleCount,
    showSearch,
    query: showSearch ? state.query : '',
    scrollY: state.scrollY,
    focusKey: state.focusKey,
    view: {
      empty: items.length === 0,
      emptyLabel: '暂无可用模板',
    },
  };
}

// ---------------------------------------------------------------------------
// State transitions (pure)
// ---------------------------------------------------------------------------

export function setCatalogTab(
  state: CatalogUiState,
  tab: CatalogTab
): CatalogUiState {
  if (state.tab === tab) return state;
  return {
    ...state,
    tab,
    category: 'featured',
    // Switching tab clears query (and search only reappears if gate open).
    query: '',
    scrollY: 0,
    focusKey: null,
  };
}

export function setCatalogCategory(
  state: CatalogUiState,
  category: string
): CatalogUiState {
  return {
    ...state,
    category,
    scrollY: 0,
    focusKey: null,
  };
}

export function setCatalogScroll(
  state: CatalogUiState,
  scrollY: number
): CatalogUiState {
  return { ...state, scrollY: Math.max(0, scrollY) };
}

export function setCatalogFocus(
  state: CatalogUiState,
  focusKey: string | null
): CatalogUiState {
  return { ...state, focusKey };
}

/**
 * Set query only when search gate is open. Below gate, query is forced empty
 * so hosts never render a hollow search box with latent state.
 */
export function setCatalogQuery(
  state: CatalogUiState,
  query: string,
  source: CatalogItemSource = {}
): CatalogUiState {
  if (!shouldShowCatalogSearch(state.tab, source)) {
    return { ...state, query: '' };
  }
  return { ...state, query };
}

/** Hydrate catalog UI from URL search (allowlisted params only). */
export function catalogStateFromSearch(
  raw: URLSearchParams | Record<string, unknown>
): CatalogUiState {
  const parsed: ComposerCatalogSearchParams = parseComposerCatalogSearch(raw);
  return createCatalogUiState({
    tab: parsed.tab ?? 'templates',
    category: parsed.category ?? 'featured',
    query: parsed.q ?? '',
    surfaceRevisionId: parsed.surfaceRevisionId ?? null,
    returnKey: parsed.returnKey ?? null,
  });
}

/**
 * Serialize UI state to allowlisted catalog href.
 *
 * `surfaceRevisionId` is deliberately **not** serialized. It is a supply-side
 * revision ref (`surface.home.launch@27`), and PRODUCT.md keeps internal object
 * ids off merchant surfaces — the address bar included. Nothing depends on it
 * being there: the catalog always fetches the live surface, and the revision a
 * merchant actually acts on is read from that response, not from the URL. The
 * parser still accepts the parameter so older links keep working.
 */
export function catalogStateToHref(state: CatalogUiState): string {
  return buildComposerCatalogHref({
    tab: state.tab,
    category: state.category,
    ...(state.query ? { q: state.query } : {}),
    ...(state.returnKey ? { returnKey: state.returnKey } : {}),
  });
}
