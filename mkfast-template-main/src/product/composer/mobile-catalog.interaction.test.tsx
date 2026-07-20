/**
 * RTL: single bottom sheet mutex + catalog return restore + responsive grid
 * (C3 / #97, D-084 / D-093).
 */
import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserRecipeProjection } from '@meiye/contracts';

import {
  createComposerBottomSheetState,
  dismissComposerSheet,
  openComposerSheet,
  type ComposerBottomSheetState,
  type ComposerSheetRestoreSnapshot,
} from './composer-bottom-sheet';
import { ComposerBottomSheet } from './composer-bottom-sheet-ui';
import {
  createCatalogUiState,
  projectFullscreenCatalogView,
  type CatalogUiState,
} from './fullscreen-catalog';
import { FullscreenCatalogPanel } from './fullscreen-catalog-panel';
import { resolveComposerCardGridLayout } from './mobile-layout';
import { RecipeCardGrid } from './recipe-card-grid';
import { listColdCardsFromSeeds } from './recipe-cards';
import { ComposerToolsStrip } from './composer-tools-strip';
import { COMPOSER_TOOL_ENTRY_SEEDS } from './tool-entry-seeds';

afterEach(() => {
  cleanup();
});

function makeRecipe(
  i: number,
  status: 'published' | 'draft' = 'published'
): BrowserRecipeProjection {
  return {
    recipeId: `recipe.item_${i}`,
    revision: 1,
    revisionId: `recipe.item_${i}@1`,
    status,
    lensId: i % 2 === 0 ? 'copy' : 'image_text',
    presentation: {
      title: `模板 ${i}`,
      summary: `说明 ${i}`,
    },
    delivery: {},
    contextPatches: {},
    sourceRequirements: [],
    modelPolicy: { mode: 'auto' },
    settingsPatches: {},
    promptRevisionRef: 'prompt@1',
    targetWorkspaceKind: i % 2 === 0 ? 'copy' : 'image_text',
    contentHash: 'hash',
  };
}

describe('responsive card grid matrix', () => {
  it('two-col at 320/390 and single-col at 200% with no truncate attrs', () => {
    const cards = listColdCardsFromSeeds();
    const twoCol = resolveComposerCardGridLayout({ width: 320 }, { cardCount: 6 });
    expect(twoCol.columns).toBe(2);

    const { rerender } = render(
      <RecipeCardGrid
        cards={cards}
        onSelectCard={() => undefined}
        singleColumn={false}
      />
    );
    const grid = screen.getByTestId('composer-recipe-card-grid');
    expect(grid).toHaveAttribute('data-columns', '2');
    expect(grid).toHaveAttribute('data-card-count', '6');

    const buttons = within(grid).getAllByRole('button');
    expect(buttons).toHaveLength(6);
    for (const button of buttons) {
      expect(button).toHaveAttribute('data-no-truncate', 'true');
      expect(button.className).toMatch(/min-h-12/);
      // No line-clamp classes.
      expect(button.className).not.toMatch(/line-clamp|truncate/);
    }

    const single = resolveComposerCardGridLayout({ width: 160 }, { cardCount: 6 });
    expect(single.singleColumn).toBe(true);
    rerender(
      <RecipeCardGrid
        cards={cards}
        onSelectCard={() => undefined}
        singleColumn
      />
    );
    expect(screen.getByTestId('composer-recipe-card-grid')).toHaveAttribute(
      'data-columns',
      '1'
    );
  });
});

describe('single bottom sheet mutex + restore', () => {
  function SheetHarness() {
    const [state, setState] = useState<ComposerBottomSheetState>(() =>
      createComposerBottomSheetState()
    );
    const [restored, setRestored] =
      useState<ComposerSheetRestoreSnapshot | null>(null);

    return (
      <div>
        <button
          type="button"
          data-testid="open-conflict"
          onClick={() =>
            setState(
              openComposerSheet(state, {
                kind: 'conflict',
                scrollY: 88,
                focusKey: 'trigger-a',
                draftKey: 'draft-1',
              })
            )
          }
        >
          open conflict
        </button>
        <button
          type="button"
          data-testid="open-reuse"
          onClick={() =>
            setState(
              openComposerSheet(state, {
                kind: 'reuse_panel',
                scrollY: 12,
                focusKey: 'trigger-b',
              })
            )
          }
        >
          open reuse
        </button>
        <button
          type="button"
          data-testid="dismiss-sheet"
          onClick={() => {
            const { state: next, restore } = dismissComposerSheet(state);
            setState(next);
            setRestored(restore);
          }}
        >
          dismiss
        </button>
        <div data-testid="restore-json">
          {restored ? JSON.stringify(restored) : 'none'}
        </div>
        <ComposerBottomSheet
          state={state}
          onStateChange={setState}
          onRestore={setRestored}
        >
          <p data-testid="sheet-body-text">sheet body for {state.open}</p>
        </ComposerBottomSheet>
      </div>
    );
  }

  it('opens one sheet, replaces on second open, restores on dismiss', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);

    expect(screen.queryByTestId('composer-bottom-sheet')).toBeNull();

    await user.click(screen.getByTestId('open-conflict'));
    expect(screen.getByTestId('composer-bottom-sheet')).toHaveAttribute(
      'data-sheet-kind',
      'conflict'
    );

    // Mutex: opening reuse replaces conflict — still a single sheet root.
    await user.click(screen.getByTestId('open-reuse'));
    const sheets = screen.getAllByTestId('composer-bottom-sheet');
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toHaveAttribute('data-sheet-kind', 'reuse_panel');

    await user.click(screen.getByTestId('composer-bottom-sheet-close'));
    expect(screen.queryByTestId('composer-bottom-sheet')).toBeNull();
    const restoreJson = screen.getByTestId('restore-json').textContent ?? '';
    expect(restoreJson).toContain('trigger-b');
    expect(restoreJson).toContain('"scrollY":12');
  });

  it('Escape dismisses and restores', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    await user.click(screen.getByTestId('open-conflict'));
    expect(screen.getByTestId('composer-bottom-sheet')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('composer-bottom-sheet')).toBeNull();
    expect(screen.getByTestId('restore-json').textContent).toContain(
      'trigger-a'
    );
  });
});

describe('catalog search gate + return restore', () => {
  function CatalogHarness({
    recipeCount,
    includeDrafts = 0,
    withVerifiedTool = false,
  }: {
    recipeCount: number;
    includeDrafts?: number;
    withVerifiedTool?: boolean;
  }) {
    const [state, setState] = useState<CatalogUiState>(() =>
      createCatalogUiState({ tab: 'templates' })
    );
    const [backSnap, setBackSnap] = useState<string>('none');
    const recipes = [
      ...Array.from({ length: recipeCount }, (_, i) => makeRecipe(i, 'published')),
      ...Array.from({ length: includeDrafts }, (_, i) =>
        makeRecipe(1000 + i, 'draft')
      ),
    ];

    return (
      <div>
        <FullscreenCatalogPanel
          state={state}
          onStateChange={setState}
          source={{
            recipes,
            ...(withVerifiedTool
              ? {
                  tools: COMPOSER_TOOL_ENTRY_SEEDS.map((tool) =>
                    tool.id === 'tool.multi_size'
                      ? { ...tool, capabilityPublished: true }
                      : tool
                  ),
                }
              : {}),
          }}
          onBack={(snap) => setBackSnap(JSON.stringify(snap))}
        />
        <div data-testid="back-snap">{backSnap}</div>
      </div>
    );
  }

  it('does not render search when published-visible < 12', () => {
    render(<CatalogHarness recipeCount={11} includeDrafts={5} />);
    const root = screen.getByTestId('composer-fullscreen-catalog');
    expect(root).toHaveAttribute('data-published-count', '11');
    expect(root).toHaveAttribute('data-show-search', 'false');
    expect(screen.queryByTestId('composer-catalog-search')).toBeNull();
    // Drafts are not listed.
    expect(screen.getAllByTestId(/composer-catalog-item-recipe\.item_/)).toHaveLength(
      11
    );
  });

  it('renders search shell when published-visible ≥ 12 (gate only)', () => {
    render(<CatalogHarness recipeCount={12} />);
    const root = screen.getByTestId('composer-fullscreen-catalog');
    expect(root).toHaveAttribute('data-published-count', '12');
    expect(root).toHaveAttribute('data-show-search', 'true');
    expect(screen.getByTestId('composer-catalog-search')).toBeInTheDocument();
  });

  it('back captures tab/filter/scroll/focus for restore', async () => {
    const user = userEvent.setup();
    render(<CatalogHarness recipeCount={6} withVerifiedTool />);

    await user.click(screen.getByTestId('composer-catalog-tab-tools'));
    expect(screen.getByTestId('composer-fullscreen-catalog')).toHaveAttribute(
      'data-tab',
      'tools'
    );

    await user.click(screen.getByTestId('composer-catalog-category-image'));
    await user.click(screen.getByTestId('composer-catalog-item-tool.multi_size'));
    await user.click(screen.getByTestId('composer-catalog-back'));

    const snap = screen.getByTestId('back-snap').textContent ?? '';
    expect(snap).toContain('"tab":"tools"');
    expect(snap).toContain('"category":"image"');
    expect(snap).toContain('tool.multi_size');
  });

  it('projectFullscreenCatalogView pure gate matches panel attrs', () => {
    const recipes = Array.from({ length: 11 }, (_, i) => makeRecipe(i));
    const view = projectFullscreenCatalogView(
      createCatalogUiState({ tab: 'templates' }),
      { recipes }
    );
    expect(view.showSearch).toBe(false);
    expect(view.publishedVisibleCount).toBe(11);
  });
});

describe('tools strip caps + Pro Studio banner', () => {
  it('mobile hides unverified ordinary tools and shows Pro Studio banner', () => {
    const opens: string[] = [];
    render(
      <ComposerToolsStrip
        viewport="mobile"
        proStudioStatus="active"
        onOpenTool={(href) => opens.push(href)}
      />
    );
    const strip = screen.getByTestId('composer-tools-strip');
    expect(strip).toHaveAttribute('data-ordinary-cap', '2');
    expect(strip).toHaveAttribute('data-ordinary-count', '0');

    const banner = screen.getByTestId('composer-pro-studio-banner');
    expect(banner).toHaveAttribute('data-status', 'active');
    expect(banner).toHaveAttribute('data-href', '/pro-studio');
  });

  it('desktop shows ≤3 ordinary tools', () => {
    render(
      <ComposerToolsStrip viewport="desktop" proStudioStatus="locked" />
    );
    const strip = screen.getByTestId('composer-tools-strip');
    expect(strip).toHaveAttribute('data-ordinary-cap', '3');
    expect(Number(strip.getAttribute('data-ordinary-count'))).toBeLessThanOrEqual(
      3
    );
    expect(screen.getByTestId('composer-pro-studio-banner')).toHaveAttribute(
      'data-status',
      'locked'
    );
  });
});
