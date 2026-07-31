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
import { RecipePillRow } from './recipe-pill-row';
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

describe('recipe pill row on the narrow path', () => {
  it('keeps the D-084 no-truncate contract and drops the empty groups', () => {
    const cards = listColdCardsFromSeeds();
    // The grid's two-column matrix still decides `viewportKind` upstream
    // (composer-home reads it through isTwoColumnMobileViewport), so the pure
    // layout call stays exercised even though pills wrap instead of gridding.
    expect(
      resolveComposerCardGridLayout({ width: 320 }, { cardCount: 6 }).columns
    ).toBe(2);
    expect(
      resolveComposerCardGridLayout({ width: 160 }, { cardCount: 6 })
        .singleColumn
    ).toBe(true);

    render(<RecipePillRow cards={cards} onSelectCard={() => undefined} />);

    // Six cold cards, five pills: 旧内容换平台 is a reuse action, not a
    // marketing task, and its click hands the intent back to the conversation
    // instead of applying a recipe — a pill of it would not apply anything.
    const row = screen.getByTestId('composer-recipe-pill-row');
    const pills = within(row).getAllByRole('button');
    expect(pills).toHaveLength(5);
    expect(
      screen.queryByTestId('composer-recipe-card-reuse_content')
    ).not.toBeInTheDocument();

    // 热点借势 / 品牌与个人 IP have no recipes today. They are absent rather
    // than greyed out: a group that opens onto nothing is the imagined feature
    // with no carrier behind it.
    expect(row).toHaveAttribute('data-group-count', '3');
    expect(
      screen.queryByTestId('composer-recipe-pill-group-hot_topic')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('composer-recipe-pill-group-brand_ip')
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByTestId('composer-recipe-pill-group-project_exposure')
      ).getAllByRole('button')
    ).toHaveLength(3);

    for (const pill of pills) {
      expect(pill).toHaveAttribute('data-no-truncate', 'true');
      expect(pill.className).toMatch(/min-h-12/);
      // D-084 narrow path: the merchant's sentence wraps, never ellipses.
      expect(pill.className).not.toMatch(/line-clamp|truncate/);
      // D-083: one <button>, no nested interactive control inside it.
      expect(pill.querySelector('button, a, input, select')).toBeNull();
    }
  });

  it('carries the action label D-083 wants visible in the accessible name', () => {
    const cards = listColdCardsFromSeeds();
    render(<RecipePillRow cards={cards} onSelectCard={() => undefined} />);

    const pill = screen.getByTestId(
      'composer-recipe-card-recipe.project_intro'
    );
    const card = cards.find((item) => item.cardKey === 'recipe.project_intro')!;
    expect(pill.textContent).toBe(card.title);
    // The pill shows the title alone, so the action has to survive somewhere a
    // screen reader reaches — this is the single place this row bends D-083.
    expect(pill.getAttribute('aria-label')).toContain(card.actionLabel);
    expect(pill).toHaveAttribute('title', card.summary);
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
          id="trigger-a"
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
          id="trigger-b"
          type="button"
          data-testid="open-tool"
          onClick={() =>
            setState(
              openComposerSheet(state, {
                kind: 'tool_confirm',
                scrollY: 12,
                focusKey: 'trigger-b',
              })
            )
          }
        >
          open tool
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
    const sheet = screen.getByTestId('composer-bottom-sheet');
    expect(sheet).toHaveAttribute('data-sheet-kind', 'conflict');
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(sheet).toContainElement(
      document.activeElement as HTMLElement | null
    );

    // Mutex: opening a tool confirmation replaces conflict.
    await user.click(screen.getByTestId('open-tool'));
    const sheets = screen.getAllByTestId('composer-bottom-sheet');
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toHaveAttribute('data-sheet-kind', 'tool_confirm');

    await user.click(screen.getByTestId('composer-bottom-sheet-close'));
    expect(screen.queryByTestId('composer-bottom-sheet')).toBeNull();
    expect(screen.getByTestId('open-tool')).toHaveFocus();
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
      ...Array.from({ length: recipeCount }, (_, i) =>
        makeRecipe(i, 'published')
      ),
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
    expect(
      screen.getAllByTestId(/composer-catalog-item-recipe\.item_/)
    ).toHaveLength(11);
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
    await user.click(
      screen.getByTestId('composer-catalog-item-tool.multi_size')
    );
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

describe('tools strip caps', () => {
  it('mobile hides unverified ordinary tools and has no Pro Studio banner', () => {
    const opens: string[] = [];
    render(
      <ComposerToolsStrip
        viewport="mobile"
        onOpenTool={(href) => opens.push(href)}
      />
    );
    const strip = screen.getByTestId('composer-tools-strip');
    expect(strip).toHaveAttribute('data-ordinary-cap', '2');
    expect(strip).toHaveAttribute('data-ordinary-count', '0');
    expect(
      screen.queryByTestId('composer-pro-studio-banner')
    ).not.toBeInTheDocument();
  });

  it('desktop shows ≤3 ordinary tools and no Pro Studio banner', () => {
    render(<ComposerToolsStrip viewport="desktop" />);
    const strip = screen.getByTestId('composer-tools-strip');
    expect(strip).toHaveAttribute('data-ordinary-cap', '3');
    expect(
      Number(strip.getAttribute('data-ordinary-count'))
    ).toBeLessThanOrEqual(3);
    expect(
      screen.queryByTestId('composer-pro-studio-banner')
    ).not.toBeInTheDocument();
  });
});
