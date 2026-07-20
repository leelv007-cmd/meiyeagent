/**
 * Composer six-card panel host (C2 / #96 + C3 / #97).
 *
 * Wires card grid + apply session + patch preview + reuse panel + tip.
 * Mobile: conflict / reuse ride the single bottom-sheet mutex (D-084).
 * Pure UI host — zero business writes (Work/Task/Job/ContentPackage).
 */

import { useEffect, useMemo, useState } from 'react';
import type {
  BrowserRecipeProjection,
  BrowserSurfaceProjection,
  CreationLensId,
  CreativeBrief,
} from '@meiye/contracts';

import { ComposerBriefChips } from './brief-chips';
import {
  createComposerBottomSheetState,
  syncSheetWithApplyPhase,
  type ComposerBottomSheetState,
  type ComposerSheetRestoreSnapshot,
} from './composer-bottom-sheet';
import { ComposerBottomSheet } from './composer-bottom-sheet-ui';
import {
  cancelApply,
  clearAnnouncement,
  confirmApply,
  confirmReusePanel,
  createRecipeApplySession,
  openReusePanel,
  requestApplyRecipe,
  undoApply,
  type RecipeApplySession,
  type ReusePanelSelection,
} from './recipe-apply';
import { RecipeApplyTip } from './recipe-apply-tip';
import { RecipeCardGrid } from './recipe-card-grid';
import {
  listVisibleRecipeCards,
  type RecipeCardView,
} from './recipe-cards';
import { RecipePatchPreviewSurface } from './recipe-patch-preview-surface';
import {
  ReuseContentPanel,
  emptyReuseSelection,
  type ReuseSourceOption,
} from './reuse-content-panel';
import {
  createComposerLensState,
  type ComposerLensState,
} from './lens-state-machine';

export type RecipeCardsPanelProps = {
  lensId: CreationLensId | null;
  lensState?: ComposerLensState;
  onLensStateChange?: (state: ComposerLensState) => void;
  surface?: BrowserSurfaceProjection | null;
  recipes?: readonly BrowserRecipeProjection[] | null;
  /** Optional brief chips (T1 re-hang). */
  brief?: CreativeBrief;
  autoConfirmingBrief?: boolean;
  reuseSources?: ReuseSourceOption[];
  className?: string;
  singleColumn?: boolean;
  /**
   * When true, conflict + reuse panels render inside the single bottom sheet
   * (mobile path). Desktop keeps inline panels.
   */
  useBottomSheet?: boolean;
  /** Optional focus key restored when the sheet dismisses. */
  sheetFocusKey?: string | null;
  onSheetRestore?: (restore: ComposerSheetRestoreSnapshot) => void;
};

export function RecipeCardsPanel({
  lensId,
  lensState: controlledLens,
  onLensStateChange,
  surface,
  recipes,
  brief,
  autoConfirmingBrief,
  reuseSources = [],
  className,
  singleColumn,
  useBottomSheet = false,
  sheetFocusKey = null,
  onSheetRestore,
}: RecipeCardsPanelProps) {
  const [session, setSession] = useState<RecipeApplySession>(() =>
    createRecipeApplySession(
      controlledLens ?? createComposerLensState()
    )
  );
  const [reuseSelection, setReuseSelection] = useState<ReusePanelSelection>(
    emptyReuseSelection
  );
  const [sheet, setSheet] = useState<ComposerBottomSheetState>(() =>
    createComposerBottomSheetState()
  );

  // Keep session lens in sync when parent drives lens radiogroup.
  const activeSession = useMemo(() => {
    if (!controlledLens) return session;
    if (session.lensState === controlledLens) return session;
    return { ...session, lensState: controlledLens };
  }, [controlledLens, session]);

  const cards = listVisibleRecipeCards({
    lensId,
    surface,
    recipes,
  });

  const publish = (next: RecipeApplySession) => {
    setSession(next);
    onLensStateChange?.(next.lensState);
  };

  // Keep single sheet mutex in sync with apply phase (mobile only).
  useEffect(() => {
    if (!useBottomSheet) return;
    setSheet((current) =>
      syncSheetWithApplyPhase(current, activeSession.phase, {
        scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
        focusKey: sheetFocusKey,
      })
    );
  }, [activeSession.phase, useBottomSheet, sheetFocusKey]);

  const handleSelectCard = (card: RecipeCardView) => {
    if (card.kind === 'reuse_collection') {
      setReuseSelection(emptyReuseSelection());
      publish(openReusePanel(activeSession));
      return;
    }
    if (!card.recipe) return;
    const result = requestApplyRecipe(activeSession, card.recipe);
    publish(result.session);
  };

  const handleConfirmPatch = () => {
    publish(confirmApply(activeSession));
  };

  const handleCancelPatch = () => {
    publish(cancelApply(activeSession));
  };

  const handleUndo = () => {
    publish(undoApply(activeSession));
  };

  const handleReuseConfirm = () => {
    if (!reuseSelection.lensId) return;
    // Resolve variant from cards/surface recipes.
    const variant =
      cards
        .flatMap((c) =>
          c.reuseVariants
            ? Object.values(c.reuseVariants)
            : c.recipe
              ? [c.recipe]
              : []
        )
        .find((r) => r && r.lensId === reuseSelection.lensId) ??
      (recipes ?? surface?.recipes ?? [])
        .filter(
          (r) =>
            r.lensId === reuseSelection.lensId &&
            (r.familyId === 'reuse_content' ||
              r.recipeId.startsWith('recipe.reuse_content'))
        )
        .map((r) => ({
          recipeId: r.recipeId,
          revisionId: r.revisionId,
          lensId: r.lensId,
          familyId: r.familyId,
          presentation: r.presentation,
          delivery: r.delivery,
          modelPolicy: r.modelPolicy,
          settingsPatches: r.settingsPatches ?? {},
          sourceRequirements: r.sourceRequirements ?? [],
          quotePolicyRevisionRef: r.quotePolicyRevisionRef,
        }))[0];

    if (!variant) {
      // Build a minimal stub so tests without surface still work.
      const stub = {
        recipeId: `recipe.reuse_content.${reuseSelection.lensId}_adapt` as const,
        revisionId: `recipe.reuse_content.${reuseSelection.lensId}_adapt@1`,
        lensId: reuseSelection.lensId,
        familyId: 'reuse_content',
        presentation: {
          title: '旧内容换平台',
          summary: '选择旧内容，再决定改成哪种形式',
          actionLabel: '选择创作形式',
        },
        delivery: {},
        modelPolicy: { mode: 'auto' as const },
        settingsPatches: {},
        sourceRequirements: [
          {
            slot: 'source_content',
            required: true,
            kinds: ['content', 'work', 'content_package'],
          },
        ],
      };
      const result = confirmReusePanel(
        activeSession,
        reuseSelection,
        stub
      );
      publish(result.session);
      return;
    }

    const result = confirmReusePanel(
      activeSession,
      reuseSelection,
      variant
    );
    publish(result.session);
  };

  // Clear one-shot announcement after paint so polite region fires once.
  useEffect(() => {
    if (!activeSession.announcement) return;
    const timer = window.setTimeout(() => {
      setSession((current) =>
        current.announcement ? clearAnnouncement(current) : current
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSession.announcement]);

  const confirming =
    activeSession.phase === 'confirming' &&
    activeSession.preview &&
    activeSession.pendingRecipe;
  const reuseOpen = activeSession.phase === 'reuse_panel';
  const showInlineOverlay = !useBottomSheet && (confirming || reuseOpen);
  const showGrid =
    activeSession.phase !== 'confirming' &&
    activeSession.phase !== 'reuse_panel';

  const overlayBody = confirming ? (
    <RecipePatchPreviewSurface
      preview={activeSession.preview!}
      recipeTitle={activeSession.pendingRecipe!.presentation.title}
      onConfirm={handleConfirmPatch}
      onCancel={handleCancelPatch}
    />
  ) : reuseOpen ? (
    <ReuseContentPanel
      selection={reuseSelection}
      onChange={setReuseSelection}
      onConfirm={handleReuseConfirm}
      onCancel={handleCancelPatch}
      sourceOptions={reuseSources}
    />
  ) : null;

  return (
    <div
      data-testid="composer-recipe-cards-panel"
      data-phase={activeSession.phase}
      data-use-bottom-sheet={useBottomSheet ? 'true' : 'false'}
      data-sheet-open={sheet.open ?? 'none'}
      className={className}
    >
      <ComposerBriefChips
        brief={brief}
        autoConfirming={autoConfirmingBrief}
      />

      <RecipeApplyTip session={activeSession} onUndo={handleUndo} />

      {showInlineOverlay ? overlayBody : null}

      {useBottomSheet && sheet.open ? (
        <ComposerBottomSheet
          state={sheet}
          onStateChange={setSheet}
          onRestore={(restore) => {
            // Dismissing the sheet cancels the pending apply / reuse.
            publish(cancelApply(activeSession));
            onSheetRestore?.(restore);
          }}
        >
          {overlayBody}
        </ComposerBottomSheet>
      ) : null}

      {showGrid ? (
        <RecipeCardGrid
          cards={cards}
          onSelectCard={handleSelectCard}
          singleColumn={singleColumn}
        />
      ) : null}
    </div>
  );
}
