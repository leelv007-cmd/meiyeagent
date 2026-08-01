/**
 * Recipe apply session (C2 / #96, D-083).
 *
 * - No conflict → local apply (select lens + patch draft); zero business write
 * - Conflict → surface RecipePatchPreview (two CTAs); cancel restores baseline
 * - After apply → inline tip + undo + first missing input focus target
 * - userText / sources / assetRights always preserved (never a hidden prompt)
 *
 * Browse / apply / preview / cancel / undo MUST NOT create Work/Task/Job/
 * ContentPackage — this module only mutates ComposerLensState.
 */

import type {
  CreationLensId,
  RecipePatchPreview,
  RecipeSourceRequirement,
} from '@meiye/contracts';

import {
  UNDO_LABEL,
  appliedTipLabel,
  switchedTipLabel,
  type RecipeCardTarget,
} from './launch-card-seeds';
import {
  createComposerLensState,
  selectLens,
  type ComposerDraft,
  type ComposerLensState,
} from './lens-state-machine';
import {
  buildClientRecipePatchPreview,
  composerDraftToRecipeFields,
} from './recipe-patch-preview-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Business entity kinds that recipe browse/apply must never create. */
export const FORBIDDEN_APPLY_SIDE_EFFECTS = [
  'Work',
  'Task',
  'Job',
  'ContentPackage',
  'QuotaHold',
] as const;
export type ForbiddenApplySideEffect =
  (typeof FORBIDDEN_APPLY_SIDE_EFFECTS)[number];

export type MissingInputFocus = {
  slot: string;
  required: boolean;
  kinds?: string[];
};

export type RecipeApplyPhase = 'idle' | 'confirming' | 'applied';

export type RecipeApplySession = {
  phase: RecipeApplyPhase;
  /** Live composer lens state (always holds current draft). */
  lensState: ComposerLensState;
  /** Server or client RecipePatchPreview when confirming. */
  preview: RecipePatchPreview | null;
  /** Recipe pending confirmation or last applied. */
  pendingRecipe: RecipeCardTarget | null;
  /** Snapshot taken before confirm/apply for cancel/undo. */
  baseline: {
    lensState: ComposerLensState;
  } | null;
  /** Inline tip after successful apply. */
  tip: string | null;
  /** Single polite live announcement (apply only; never while typing). */
  announcement: string | null;
  /** First missing required source slot after apply. */
  focusMissing: MissingInputFocus | null;
  /** Undo available after apply. */
  canUndo: boolean;
  undoLabel: string;
  /**
   * Always empty — browse/apply/preview/cancel never create business objects.
   * Present so tests can assert zero writes without mocking a store.
   */
  sideEffects: ForbiddenApplySideEffect[];
};

export type RequestApplyResult =
  | { kind: 'applied'; session: RecipeApplySession }
  | { kind: 'confirming'; session: RecipeApplySession }
  | { kind: 'unavailable'; session: RecipeApplySession; reason: string };

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------

export function createRecipeApplySession(
  lensState: ComposerLensState = createComposerLensState()
): RecipeApplySession {
  return {
    phase: 'idle',
    lensState,
    preview: null,
    pendingRecipe: null,
    baseline: null,
    tip: null,
    announcement: null,
    focusMissing: null,
    canUndo: false,
    undoLabel: UNDO_LABEL,
    sideEffects: [],
  };
}

export function bindLensState(
  session: RecipeApplySession,
  lensState: ComposerLensState
): RecipeApplySession {
  return { ...session, lensState };
}

// ---------------------------------------------------------------------------
// Missing inputs
// ---------------------------------------------------------------------------

export function listMissingRequiredInputs(
  recipe: RecipeCardTarget,
  draft: ComposerDraft
): MissingInputFocus[] {
  const filledSlots = new Set<string>();
  for (const source of draft.sources) {
    if (source && typeof source === 'object' && 'slot' in source) {
      const slot = (source as { slot?: unknown }).slot;
      if (typeof slot === 'string') filledSlots.add(slot);
    }
  }
  // Heuristic: any non-empty sources counts as partially filled when no slots.
  const hasAnySource = draft.sources.length > 0;
  const hasText = draft.userText.trim().length > 0;

  return recipe.sourceRequirements
    .filter((req) => req.required)
    .filter((req) => {
      if (filledSlots.has(req.slot)) return false;
      // Text-kind requirements satisfied by userText when no structured source.
      if (
        req.kinds?.includes('text') &&
        hasText &&
        !hasStructuredSlot(draft, req)
      ) {
        // Still missing structured facts unless only free text is enough —
        // D-083: tip then focus first missing. Free text alone does not fill
        // named fact slots (project_facts etc.) — keep them missing.
        return true;
      }
      if (
        hasAnySource &&
        req.kinds?.some((k) => k === 'image' || k === 'video')
      ) {
        // Sources present but slot-tagged match preferred; without tags still missing.
        return !filledSlots.has(req.slot);
      }
      return true;
    })
    .map((req) => ({
      slot: req.slot,
      required: req.required,
      kinds: req.kinds,
    }));
}

function hasStructuredSlot(
  draft: ComposerDraft,
  req: RecipeSourceRequirement
): boolean {
  return draft.sources.some(
    (source) =>
      source &&
      typeof source === 'object' &&
      'slot' in source &&
      (source as { slot?: string }).slot === req.slot
  );
}

export function firstMissingInput(
  recipe: RecipeCardTarget,
  draft: ComposerDraft
): MissingInputFocus | null {
  return listMissingRequiredInputs(recipe, draft)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Apply patch onto lens state (local, pure)
// ---------------------------------------------------------------------------

function cloneState(state: ComposerLensState): ComposerLensState {
  return structuredClone(state);
}

/**
 * Apply recipe onto composer state.
 * NEVER overwrites userText with recipe-owned hidden prompt content.
 */
export function applyRecipeToLensState(
  state: ComposerLensState,
  recipe: RecipeCardTarget
): ComposerLensState {
  const preservedText = state.draft.userText;
  const preservedSources = [...state.draft.sources];
  const preservedRights = state.draft.assetRights;

  // Select / switch lens without going through switch_preview (caller already
  // resolved conflicts). selectLens from selected different lens enters preview —
  // so force path: if different lens, commit via unselected-style patch.
  let next: ComposerLensState;
  if (state.phase === 'unselected' || state.lensId == null) {
    next = selectLens(state, recipe.lensId);
  } else if (state.lensId === recipe.lensId) {
    next = state;
  } else {
    // Cross-lens confirmed: stash previous and jump to target lens defaults.
    next = forceLens(state, recipe.lensId);
  }

  // Patch delivery + recipe revision + settings from recipe (template ownership).
  const draft = next.draft;
  const settingsPatches = recipe.settingsPatches ?? {};
  const delivery = recipe.delivery ?? {};

  next = {
    ...next,
    phase: 'selected',
    lensId: recipe.lensId,
    source: 'user_explicit',
    draft: {
      ...draft,
      // CRITICAL: user original text preserved — no hidden-prompt path.
      userText: preservedText,
      sources: preservedSources,
      assetRights: preservedRights,
      recipeRevisionId: recipe.revisionId,
      delivery: {
        platform: delivery.contentPackagePlatform ?? draft.delivery.platform,
        distributionTarget:
          delivery.distributionTarget ?? draft.delivery.distributionTarget,
        deliverableKind:
          delivery.deliverableKind ?? draft.delivery.deliverableKind,
      },
      settings: {
        ...draft.settings,
        aspectRatio: delivery.aspectRatio ?? draft.settings.aspectRatio,
        quantity: delivery.quantity ?? draft.settings.quantity,
        durationSeconds:
          delivery.durationSeconds ?? draft.settings.durationSeconds,
        params: {
          ...draft.settings.params,
          ...settingsPatches,
        },
      },
      modelPolicyMode: recipe.modelPolicy?.mode ?? draft.modelPolicyMode,
      // Template apply clears quote confirmation (will re-quote).
      quoteRevisionId: null,
      quoteView: null,
      fieldMeta: {
        ...draft.fieldMeta,
        userText: {
          ownership: 'user',
          dirty: preservedText.length > 0,
        },
        sources: {
          ownership: 'user',
          dirty: preservedSources.length > 0,
        },
        recipe: { ownership: 'template', dirty: false },
      },
    },
  };

  return next;
}

function forceLens(
  state: ComposerLensState,
  lensId: CreationLensId
): ComposerLensState {
  // Build a selected state on target lens while keeping text/sources.
  const base = createComposerLensState({
    userText: state.draft.userText,
    sources: state.draft.sources,
    assetRights: state.draft.assetRights,
    delivery: state.draft.delivery,
    surfaceRevisionId: state.draft.surfaceRevisionId,
  });
  return selectLens(base, lensId);
}

// ---------------------------------------------------------------------------
// Request / confirm / cancel / undo
// ---------------------------------------------------------------------------

/**
 * Request apply of a single-lens recipe card.
 * @param serverPreview optional server-authored preview (preferred when present)
 */
export function requestApplyRecipe(
  session: RecipeApplySession,
  recipe: RecipeCardTarget,
  options?: {
    /** Prefer server preview when caller already fetched it. */
    serverPreview?: RecipePatchPreview | null;
  }
): RequestApplyResult {
  // Zero business writes invariant.
  assertNoSideEffects(session);

  const fields = composerDraftToRecipeFields(session.lensState);
  const preview =
    options?.serverPreview ??
    buildClientRecipePatchPreview({
      draft: fields,
      recipe,
      currentLens: session.lensState.lensId,
      surfaceRevisionId: session.lensState.draft.surfaceRevisionId ?? undefined,
    });

  if (preview.requiresConfirmation) {
    return {
      kind: 'confirming',
      session: {
        ...session,
        phase: 'confirming',
        preview,
        pendingRecipe: recipe,
        baseline: { lensState: cloneState(session.lensState) },
        tip: null,
        announcement: null,
        focusMissing: null,
        canUndo: false,
        sideEffects: [],
      },
    };
  }

  // Passthrough local apply.
  return {
    kind: 'applied',
    session: commitApply(session, recipe, /* wasCrossLens */ false),
  };
}

export function confirmApply(session: RecipeApplySession): RecipeApplySession {
  if (
    session.phase !== 'confirming' ||
    !session.pendingRecipe ||
    !session.preview
  ) {
    return session;
  }
  const wasCrossLens = session.preview.conflictKind === 'cross_lens';
  return commitApply(session, session.pendingRecipe, wasCrossLens);
}

export function cancelApply(session: RecipeApplySession): RecipeApplySession {
  if (session.phase !== 'confirming') return session;
  const restored = session.baseline?.lensState ?? session.lensState;
  return {
    ...session,
    phase: 'idle',
    lensState: cloneState(restored),
    preview: null,
    pendingRecipe: null,
    baseline: null,
    tip: null,
    announcement: null,
    focusMissing: null,
    canUndo: false,
    sideEffects: [],
  };
}

export function undoApply(session: RecipeApplySession): RecipeApplySession {
  if (!session.canUndo || !session.baseline) {
    return session;
  }
  // Restore baseline; keep any text typed after apply (always preserve live text).
  const restored = cloneState(session.baseline.lensState);
  restored.draft.userText = session.lensState.draft.userText;
  restored.draft.sources = [...session.lensState.draft.sources];
  restored.draft.assetRights = session.lensState.draft.assetRights;

  return {
    ...session,
    phase: 'idle',
    lensState: restored,
    preview: null,
    pendingRecipe: null,
    baseline: null,
    tip: null,
    announcement: null,
    focusMissing: null,
    canUndo: false,
    sideEffects: [],
  };
}

function commitApply(
  session: RecipeApplySession,
  recipe: RecipeCardTarget,
  wasCrossLens: boolean
): RecipeApplySession {
  const baseline = session.baseline ?? {
    lensState: cloneState(session.lensState),
  };
  const nextLens = applyRecipeToLensState(session.lensState, recipe);

  // Invariant: user text byte-identical.
  if (nextLens.draft.userText !== session.lensState.draft.userText) {
    throw new Error(
      'recipe apply must preserve userText (no hidden-prompt overwrite)'
    );
  }

  const tip = wasCrossLens
    ? switchedTipLabel(recipe.lensId, recipe.presentation.title)
    : appliedTipLabel(recipe.lensId, recipe.presentation.title);

  const focusMissing = firstMissingInput(recipe, nextLens.draft);

  return {
    phase: 'applied',
    lensState: nextLens,
    preview: null,
    pendingRecipe: recipe,
    baseline,
    tip,
    // Single polite announcement on apply only.
    announcement: tip,
    focusMissing,
    canUndo: true,
    undoLabel: UNDO_LABEL,
    sideEffects: [],
  };
}

function assertNoSideEffects(session: RecipeApplySession): void {
  if (session.sideEffects.length > 0) {
    throw new Error(
      `recipe apply session leaked side effects: ${session.sideEffects.join(',')}`
    );
  }
}

/** Clear the one-shot polite announcement after it has been read. */
export function clearAnnouncement(
  session: RecipeApplySession
): RecipeApplySession {
  return { ...session, announcement: null };
}

/** Test helper: assert session never recorded business writes. */
export function assertZeroBusinessWrites(session: RecipeApplySession): void {
  if (session.sideEffects.length !== 0) {
    throw new Error(
      `expected zero business writes, got: ${session.sideEffects.join(',')}`
    );
  }
  for (const kind of FORBIDDEN_APPLY_SIDE_EFFECTS) {
    if (session.sideEffects.includes(kind)) {
      throw new Error(`forbidden side effect present: ${kind}`);
    }
  }
}
