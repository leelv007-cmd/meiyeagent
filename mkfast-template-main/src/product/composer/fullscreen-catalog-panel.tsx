/**
 * Fullscreen dual-tab catalog panel (C3 / #97, D-093).
 *
 * Templates | Tools, task-language categories, published-visible search gate.
 * Search UI renders only when count ≥ 12 and filters title/summary/category.
 * Host restores tab/filter/scroll/focus via CatalogReturnRestoreSnapshot.
 */

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import {
  CATALOG_TABS,
  captureCatalogReturnSnapshot,
  projectFullscreenCatalogView,
  setCatalogCategory,
  setCatalogFocus,
  setCatalogQuery,
  setCatalogScroll,
  setCatalogTab,
  type CatalogItemSource,
  type CatalogItemView,
  type CatalogReturnRestoreSnapshot,
  type CatalogTab,
  type CatalogUiState,
  type FullscreenCatalogView,
} from './fullscreen-catalog';

export type FullscreenCatalogPanelProps = {
  state: CatalogUiState;
  onStateChange: (next: CatalogUiState) => void;
  source?: CatalogItemSource;
  onSelectItem?: (item: CatalogItemView) => void;
  onBack?: (snapshot: CatalogReturnRestoreSnapshot) => void;
  className?: string;
  /** Controlled view override (tests). */
  view?: FullscreenCatalogView;
};

export function FullscreenCatalogPanel({
  state,
  onStateChange,
  source = {},
  onSelectItem,
  onBack,
  className,
  view: viewOverride,
}: FullscreenCatalogPanelProps) {
  const view = viewOverride ?? projectFullscreenCatalogView(state, source);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const restoredScroll = useRef(false);

  // Restore scroll once after mount / state restore.
  useEffect(() => {
    if (restoredScroll.current) return;
    if (!scrollerRef.current) return;
    if (state.scrollY > 0) {
      scrollerRef.current.scrollTop = state.scrollY;
    }
    restoredScroll.current = true;
  }, [state.scrollY]);

  // Restore focus to the previously focused item when present.
  useEffect(() => {
    if (!state.focusKey) return;
    const node = document.querySelector<HTMLElement>(
      `[data-catalog-item-id="${CSS.escape(state.focusKey)}"]`
    );
    node?.focus();
  }, [state.focusKey, view.tab]);

  const handleScroll = () => {
    const top = scrollerRef.current?.scrollTop ?? 0;
    if (Math.abs(top - state.scrollY) < 4) return;
    onStateChange(setCatalogScroll(state, top));
  };

  return (
    <div
      data-testid="composer-fullscreen-catalog"
      data-tab={view.tab}
      data-category={view.activeCategory}
      data-published-count={view.publishedVisibleCount}
      data-show-search={view.showSearch ? 'true' : 'false'}
      className={cn('flex h-full min-h-0 flex-col bg-background', className)}
    >
      <header className="flex items-center gap-2 border-b border-input px-3 py-2">
        <button
          type="button"
          data-testid="composer-catalog-back"
          className="min-h-12 min-w-12 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent/40"
          onClick={() => onBack?.(captureCatalogReturnSnapshot(state))}
        >
          返回
        </button>
        <h1 className="flex-1 text-base font-semibold text-foreground">
          创作目录
        </h1>
      </header>

      <div
        role="tablist"
        aria-label="目录类型"
        data-testid="composer-catalog-tabs"
        className="flex gap-1 border-b border-input px-3"
      >
        {CATALOG_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`catalog-tab-${tab}`}
            aria-selected={view.tab === tab}
            data-testid={`composer-catalog-tab-${tab}`}
            className={cn(
              'min-h-12 flex-1 px-3 text-sm font-medium',
              view.tab === tab
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground'
            )}
            onClick={() =>
              onStateChange(setCatalogTab(state, tab as CatalogTab))
            }
          >
            {view.tabLabels[tab]}
          </button>
        ))}
      </div>

      <div
        data-testid="composer-catalog-categories"
        className="flex gap-2 overflow-x-auto px-3 py-2"
      >
        {view.categories.map((category) => (
          <button
            key={category.id}
            type="button"
            data-testid={`composer-catalog-category-${category.id}`}
            data-active={view.activeCategory === category.id ? 'true' : 'false'}
            className={cn(
              'min-h-12 shrink-0 rounded-full border px-3 text-xs font-medium',
              view.activeCategory === category.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-input text-muted-foreground'
            )}
            onClick={() =>
              onStateChange(setCatalogCategory(state, category.id))
            }
          >
            {category.label}
          </button>
        ))}
      </div>

      {view.showSearch ? (
        <div className="px-3 pb-2" data-testid="composer-catalog-search">
          <label className="sr-only" htmlFor="composer-catalog-search-input">
            搜索
          </label>
          <input
            id="composer-catalog-search-input"
            data-testid="composer-catalog-search-input"
            type="search"
            value={view.query}
            placeholder="搜索模板"
            className="min-h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
            onChange={(event) =>
              onStateChange(setCatalogQuery(state, event.target.value, source))
            }
          />
        </div>
      ) : null}

      <div
        ref={scrollerRef}
        data-testid="composer-catalog-scroller"
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-6"
        onScroll={handleScroll}
      >
        {view.view.empty ? (
          <p
            data-testid="composer-catalog-empty"
            className="py-8 text-center text-sm text-muted-foreground"
          >
            {view.view.emptyLabel}
          </p>
        ) : (
          <ul
            data-testid="composer-catalog-list"
            className="flex flex-col gap-2"
          >
            {view.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-testid={`composer-catalog-item-${item.id}`}
                  data-catalog-item-id={item.id}
                  data-item-kind={item.kind}
                  className={cn(
                    'flex min-h-12 w-full flex-col items-start gap-0.5 rounded-2xl border border-input bg-background p-3 text-left',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'hover:bg-accent/40'
                  )}
                  onClick={() => {
                    onStateChange(setCatalogFocus(state, item.id));
                    onSelectItem?.(item);
                  }}
                >
                  <span className="text-sm font-semibold text-foreground">
                    {item.title}
                  </span>
                  <span className="text-xs leading-5 text-muted-foreground">
                    {item.summary}
                  </span>
                  {item.locked ? (
                    <span className="text-xs text-muted-foreground">
                      {item.lockReason ?? '未解锁'}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
