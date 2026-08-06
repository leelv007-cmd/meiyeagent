/**
 * Composer six-card panel host (C2 / #96 + C3 / #97).
 *
 * Wires the pill row + apply session + patch preview + reuse panel + tip.
 * The pills are the D-164② second level of the lens axis; the host is
 * unchanged, only what it draws.
 * Spec E / #380: merchant capability-pack pills ride the same catalog host;
 * selection only mutates the Composer draft (no auto-submit / execute).
 * Mobile: conflict / reuse ride the single bottom-sheet mutex (D-084).
 * Pure UI host — zero business writes (Work/Task/Job/ContentPackage).
 */

import { useEffect, useMemo, useState } from 'react';
import type {
  BrowserRecipeProjection,
  BrowserSurfaceProjection,
  CreationLensId,
  RecipePatchPreview,
} from '@meiye/contracts';

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
  createRecipeApplySession,
  requestApplyRecipe,
  undoApply,
  type RecipeApplySession,
} from './recipe-apply';
import { RecipeApplyTip } from './recipe-apply-tip';
import { RecipePillRow } from './recipe-pill-row';
import { listVisibleRecipeCards, type RecipeCardView } from './recipe-cards';
import type { RecipeCardTarget } from './launch-card-seeds';
import { RecipePatchPreviewSurface } from './recipe-patch-preview-surface';
import {
  createComposerLensState,
  setSelectedSkillRevisionRefs,
  type ComposerLensState,
} from './lens-state-machine';
import { SkillCapabilityPillRow } from './skill-capability-pill-row';
import {
  eligibleSkillRevisionRefs,
  pruneSelectedSkillRevisionRefs,
  toggleSelectedSkillRevisionRef,
  type SkillCapabilityItemInput,
} from './skill-capability-selection';

const EMPTY_SKILL_CAPABILITY_ITEMS: readonly SkillCapabilityItemInput[] = [];

export type RecipeCardsPanelProps = {
  lensId: CreationLensId | null;
  lensState?: ComposerLensState;
  onLensStateChange?: (state: ComposerLensState) => void;
  surface?: BrowserSurfaceProjection | null;
  recipes?: readonly BrowserRecipeProjection[] | null;
  /**
   * Merchant capability packs for the current lens (Spec E / #380).
   * Parent loads `skills.merchant_skill_projection`; empty when cold / failed.
   */
  skillCapabilityItems?: readonly SkillCapabilityItemInput[];
  className?: string;
  /**
   * When true, conflict + reuse panels render inside the single bottom sheet
   * (mobile path). Desktop keeps inline panels.
   */
  useBottomSheet?: boolean;
  /** Optional focus key restored when the sheet dismisses. */
  sheetFocusKey?: string | null;
  onSheetRestore?: (restore: ComposerSheetRestoreSnapshot) => void;
  /** Production host fetches the authoritative server patch preview. */
  requestServerPreview?: (input: {
    lensState: ComposerLensState;
    recipe: RecipeCardTarget;
  }) => Promise<RecipePatchPreview>;
};

export function RecipeCardsPanel({
  lensId,
  lensState: controlledLens,
  onLensStateChange,
  surface,
  recipes,
  skillCapabilityItems = EMPTY_SKILL_CAPABILITY_ITEMS,
  className,
  useBottomSheet = false,
  sheetFocusKey = null,
  onSheetRestore,
  requestServerPreview,
}: RecipeCardsPanelProps) {
  const [session, setSession] = useState<RecipeApplySession>(() =>
    createRecipeApplySession(controlledLens ?? createComposerLensState())
  );
  const [sheet, setSheet] = useState<ComposerBottomSheetState>(() =>
    createComposerBottomSheetState()
  );
  const [previewError, setPreviewError] = useState(false);

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

  const skillItems = skillCapabilityItems;

  const publish = (next: RecipeApplySession) => {
    setSession(next);
    onLensStateChange?.(next.lensState);
  };

  // Drop draft skill refs that left the current projection (lens / catalog).
  useEffect(() => {
    const eligible = eligibleSkillRevisionRefs(skillItems);
    const current =
      activeSession.lensState.draft.selectedSkillRevisionRefs ?? [];
    const pruned = pruneSelectedSkillRevisionRefs(current, eligible);
    if (
      pruned.length === current.length &&
      pruned.every((ref, index) => ref === current[index])
    ) {
      return;
    }
    const nextLens = setSelectedSkillRevisionRefs(
      activeSession.lensState,
      pruned
    );
    publish({ ...activeSession, lensState: nextLens });
    // Only re-prune when the eligible catalog changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate
  }, [skillItems]);

  const handleToggleSkill = (skillRevisionRef: string) => {
    const eligible = eligibleSkillRevisionRefs(skillItems);
    const nextRefs = toggleSelectedSkillRevisionRef(
      activeSession.lensState.draft.selectedSkillRevisionRefs ?? [],
      skillRevisionRef,
      eligible
    );
    const nextLens = setSelectedSkillRevisionRefs(
      activeSession.lensState,
      nextRefs
    );
    publish({ ...activeSession, lensState: nextLens });
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

  // D-031 / 归桶矩阵 §6.10: the three-step source/form/carrier panel is gone,
  // and since D-164② 「旧内容换平台」is not a pill either — it is a reuse action,
  // not a marketing task, and it is answered in the conversation's reuse chips
  // with one sentence. `RecipePillRow` drops that card, so nothing here can be
  // asked to apply it.
  const handleSelectCard = async (card: RecipeCardView) => {
    if (!card.recipe) return;
    setPreviewError(false);
    let serverPreview: RecipePatchPreview | undefined;
    if (requestServerPreview) {
      try {
        serverPreview = await requestServerPreview({
          lensState: activeSession.lensState,
          recipe: card.recipe,
        });
      } catch {
        setPreviewError(true);
        return;
      }
    }
    const result = requestApplyRecipe(activeSession, card.recipe, {
      serverPreview,
    });
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
  const showInlineOverlay = !useBottomSheet && Boolean(confirming);
  const showPills = activeSession.phase !== 'confirming';

  const overlayBody = confirming ? (
    <RecipePatchPreviewSurface
      preview={activeSession.preview!}
      recipeTitle={activeSession.pendingRecipe!.presentation.title}
      onConfirm={handleConfirmPatch}
      onCancel={handleCancelPatch}
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
      <RecipeApplyTip session={activeSession} onUndo={handleUndo} />

      {previewError ? (
        <p className="text-sm text-destructive" role="alert">
          模板预览暂不可用，请稍后重试
        </p>
      ) : null}

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

      {showPills ? (
        <>
          <RecipePillRow cards={cards} onSelectCard={handleSelectCard} />
          {lensId ? (
            <SkillCapabilityPillRow
              items={skillItems}
              onToggleSelectable={handleToggleSkill}
              selectedSkillRevisionRefs={
                activeSession.lensState.draft.selectedSkillRevisionRefs ?? []
              }
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
