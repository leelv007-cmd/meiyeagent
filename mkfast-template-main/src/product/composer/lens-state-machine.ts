/**
 * Composer lens state machine (C1 / #95, D-081).
 *
 * Phases: unselected → selected(user_explicit) → switch_preview → frozen
 *
 * Pure model — no React, no I/O. Field ownership + previewChange →
 * commitChange → undoChange for reversible protected-field updates.
 *
 * Rules:
 * - Cold: no default lens; submit blocked with "选择创作类型后继续"
 * - Selection source is always user_explicit (never inferred)
 * - Switch always keeps user text / sources / asset rights
 * - Protected dirty fields (model / params / tools / quote) → switch_preview
 * - Platform + deliverable suggestion never reverse-changes lens
 * - Frozen after submit; further lens change requires a derived draft
 */

import type { CreationLensId, ProductQuoteSnapshot } from '@meiye/contracts';
import { creationLensIds } from '@meiye/contracts';

import { LENS_REQUIRED_SUBMIT_HINT, lensLabel } from './lens-labels';
import type { ComposerQuoteView } from './quote-wiring';
import {
  buildVideoConfirmZone,
  evaluateSubmitGate,
  type SubmitGateResult,
  type VideoConfirmZone,
} from './video-confirm-zone';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComposerLensPhase =
  | 'unselected'
  | 'selected'
  | 'switch_preview'
  | 'frozen';

export type FieldOwnership = 'user' | 'template' | 'system';
export type ConflictAction = 'preserve' | 'stash' | 'change';
export type LensSelectionSource = 'user_explicit';

/** Protected field keys that may produce switch conflicts. */
export const PROTECTED_FIELD_KEYS = [
  'userText',
  'sources',
  'assetRights',
  'explicitModel',
  'handEditedParams',
  'selectedTools',
  'confirmedQuote',
  'recipe',
] as const;
export type ProtectedFieldKey = (typeof PROTECTED_FIELD_KEYS)[number];

export type FieldMeta = {
  ownership: FieldOwnership;
  dirty: boolean;
  revision?: string;
};

export type DeliverySuggestion = {
  platform: string | null;
  distributionTarget: string | null;
  deliverableKind: string | null;
};

export type ComposerSettings = {
  catalogModelId: string | null;
  /** Merchant-facing CatalogModel display name (T2 — visible on settings row). */
  catalogModelName: string | null;
  catalogModelRevision: string | null;
  /**
   * How the model above was arrived at (#240①) — the merchant's own pick, a
   * saved default, or the platform fallback nobody in this shop chose. Kept
   * next to the id so the decision snapshot the server persists shows which,
   * rather than presenting every run as a deliberate selection.
   */
  catalogModelSource: string | null;
  aspectRatio: string | null;
  quantity: number | null;
  durationSeconds: number | null;
  /** Hand-edited free-form params (dirty when user-touched). */
  params: Record<string, unknown>;
};

export type ComposerDraft = {
  userText: string;
  sources: unknown[];
  assetRights: unknown | null;
  selectedToolIds: string[];
  settings: ComposerSettings;
  delivery: DeliverySuggestion;
  recipeRevisionId: string | null;
  surfaceRevisionId: string | null;
  quoteRevisionId: string | null;
  /** modelPolicy.mode fixed + catalogModelId = explicit model (protected). */
  modelPolicyMode: 'auto' | 'fixed';
  /** Keys present here are user-dirty settings. */
  dirtySettings: Record<string, unknown>;
  fieldMeta: Partial<Record<string, FieldMeta>>;
  /** Last product-quote view bound to this draft (browser-safe). */
  quoteView: ComposerQuoteView | null;
};

export type ConflictDiff = {
  field: ProtectedFieldKey | string;
  action: ConflictAction;
  from?: unknown;
  to?: unknown;
};

export type SwitchPreview = {
  fromLensId: CreationLensId;
  toLensId: CreationLensId;
  conflicts: ConflictDiff[];
  preserve: string[];
  stash: string[];
  change: string[];
  primaryCtaLabel: string;
  cancelCtaLabel: string;
};

export type FrozenRevisions = {
  lensId: CreationLensId;
  surfaceRevisionId: string | null;
  recipeRevisionId: string | null;
  modelRevisionId: string | null;
  quoteRevisionId: string | null;
  frozenAt: string;
};

export type UndoEntry = {
  kind: 'lens_switch' | 'settings_change';
  previousLensId: CreationLensId;
  previousDraft: ComposerDraft;
  label: string;
};

type StashByLens = Partial<Record<CreationLensId, ComposerDraft>>;

type BaseState = {
  draft: ComposerDraft;
  stashByLens: StashByLens;
  undoStack: UndoEntry[];
};

export type UnselectedState = BaseState & {
  phase: 'unselected';
  lensId: null;
  source: null;
};

export type SelectedState = BaseState & {
  phase: 'selected';
  lensId: CreationLensId;
  source: LensSelectionSource;
};

export type SwitchPreviewState = BaseState & {
  phase: 'switch_preview';
  /** Still the active (pre-switch) lens until confirm. */
  lensId: CreationLensId;
  source: LensSelectionSource;
  preview: SwitchPreview;
  /** Draft snapshot captured when entering preview (for cancel). */
  previewBaseline: ComposerDraft;
};

export type FrozenState = BaseState & {
  phase: 'frozen';
  lensId: CreationLensId;
  source: LensSelectionSource;
  frozen: FrozenRevisions;
};

export type ComposerLensState =
  | UnselectedState
  | SelectedState
  | SwitchPreviewState
  | FrozenState;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function emptyComposerSettings(): ComposerSettings {
  return {
    catalogModelId: null,
    catalogModelName: null,
    catalogModelRevision: null,
    catalogModelSource: null,
    aspectRatio: null,
    quantity: null,
    durationSeconds: null,
    params: {},
  };
}

export function emptyComposerDraft(
  partial?: Partial<ComposerDraft>
): ComposerDraft {
  const {
    settings: settingsPartial,
    delivery: deliveryPartial,
    ...rest
  } = partial ?? {};
  return {
    userText: '',
    sources: [],
    assetRights: null,
    selectedToolIds: [],
    recipeRevisionId: null,
    surfaceRevisionId: null,
    quoteRevisionId: null,
    modelPolicyMode: 'auto',
    dirtySettings: {},
    fieldMeta: {},
    quoteView: null,
    ...rest,
    settings: {
      ...emptyComposerSettings(),
      ...(settingsPartial ?? {}),
    },
    delivery: {
      platform: null,
      distributionTarget: null,
      deliverableKind: null,
      ...(deliveryPartial ?? {}),
    },
  };
}

export function createComposerLensState(
  partial?: Partial<ComposerDraft>
): UnselectedState {
  return {
    phase: 'unselected',
    lensId: null,
    source: null,
    draft: emptyComposerDraft(partial),
    stashByLens: {},
    undoStack: [],
  };
}

function cloneDraft(draft: ComposerDraft): ComposerDraft {
  return structuredClone(draft);
}

// ---------------------------------------------------------------------------
// Protected-field conflict detection (lens switch)
// ---------------------------------------------------------------------------

function hasUserText(draft: ComposerDraft): boolean {
  return draft.userText.length > 0;
}

function hasSources(draft: ComposerDraft): boolean {
  return draft.sources.length > 0;
}

function hasAssetRights(draft: ComposerDraft): boolean {
  return draft.assetRights != null;
}

function hasExplicitModel(draft: ComposerDraft): boolean {
  return (
    draft.modelPolicyMode === 'fixed' ||
    Boolean(draft.dirtySettings.catalogModelId) ||
    Boolean(draft.fieldMeta.catalogModelId?.dirty)
  );
}

function hasHandEditedParams(draft: ComposerDraft): boolean {
  return (
    Object.keys(draft.dirtySettings).some((k) => k !== 'catalogModelId') ||
    Object.keys(draft.settings.params).length > 0
  );
}

function hasSelectedTools(draft: ComposerDraft): boolean {
  return draft.selectedToolIds.length > 0;
}

function hasConfirmedQuote(draft: ComposerDraft): boolean {
  return Boolean(draft.quoteRevisionId) || Boolean(draft.quoteView);
}

function hasRecipe(draft: ComposerDraft): boolean {
  return Boolean(draft.recipeRevisionId);
}

/**
 * Build preserve / stash / change lists for a prospective lens switch.
 * userText / sources / assetRights always preserve.
 * Explicit model, hand-edited params, tools, recipe, quote are stashed + changed.
 */
export function buildLensSwitchPreview(
  fromLensId: CreationLensId,
  toLensId: CreationLensId,
  draft: ComposerDraft
): SwitchPreview {
  const conflicts: ConflictDiff[] = [];
  const preserve: string[] = [];
  const stash: string[] = [];
  const change: string[] = [];

  if (hasUserText(draft)) {
    preserve.push('userText');
    conflicts.push({
      field: 'userText',
      action: 'preserve',
      from: draft.userText,
      to: draft.userText,
    });
  }
  if (hasSources(draft)) {
    preserve.push('sources');
    conflicts.push({
      field: 'sources',
      action: 'preserve',
      from: draft.sources,
      to: draft.sources,
    });
  }
  if (hasAssetRights(draft)) {
    preserve.push('assetRights');
    conflicts.push({
      field: 'assetRights',
      action: 'preserve',
      from: draft.assetRights,
      to: draft.assetRights,
    });
  }

  if (hasExplicitModel(draft)) {
    stash.push('explicitModel');
    change.push('explicitModel');
    conflicts.push({
      field: 'explicitModel',
      action: 'stash',
      from: {
        catalogModelId: draft.settings.catalogModelId,
        mode: draft.modelPolicyMode,
      },
      to: null,
    });
  }

  if (hasHandEditedParams(draft)) {
    stash.push('handEditedParams');
    change.push('handEditedParams');
    conflicts.push({
      field: 'handEditedParams',
      action: 'stash',
      from: {
        dirtySettings: draft.dirtySettings,
        params: draft.settings.params,
        aspectRatio: draft.settings.aspectRatio,
        quantity: draft.settings.quantity,
        durationSeconds: draft.settings.durationSeconds,
      },
      to: null,
    });
  }

  if (hasSelectedTools(draft)) {
    stash.push('selectedTools');
    change.push('selectedTools');
    conflicts.push({
      field: 'selectedTools',
      action: 'stash',
      from: draft.selectedToolIds,
      to: [],
    });
  }

  if (hasRecipe(draft)) {
    stash.push('recipe');
    change.push('recipe');
    conflicts.push({
      field: 'recipe',
      action: 'stash',
      from: draft.recipeRevisionId,
      to: null,
    });
  }

  if (hasConfirmedQuote(draft)) {
    stash.push('confirmedQuote');
    change.push('confirmedQuote');
    conflicts.push({
      field: 'confirmedQuote',
      action: 'stash',
      from: draft.quoteRevisionId ?? draft.quoteView?.revision ?? null,
      to: null,
    });
  }

  return {
    fromLensId,
    toLensId,
    conflicts,
    preserve,
    stash,
    change,
    primaryCtaLabel: `切换到${lensLabel(toLensId)}`,
    cancelCtaLabel: '取消',
  };
}

/** True when switch needs confirmation (any stash/change beyond always-preserve). */
export function switchRequiresConfirmation(preview: SwitchPreview): boolean {
  return preview.stash.length > 0 || preview.change.length > 0;
}

// ---------------------------------------------------------------------------
// Default settings applied on (fresh) lens select
// ---------------------------------------------------------------------------

export function defaultSettingsForLens(
  lensId: CreationLensId
): Partial<ComposerSettings> {
  switch (lensId) {
    case 'copy':
      return { quantity: 3, aspectRatio: null, durationSeconds: null };
    case 'image_text':
      return { quantity: 1, aspectRatio: '3:4', durationSeconds: null };
    case 'video':
      return { quantity: 1, aspectRatio: '9:16', durationSeconds: 15 };
  }
}

function applyLensDefaults(
  draft: ComposerDraft,
  lensId: CreationLensId
): ComposerDraft {
  const defaults = defaultSettingsForLens(lensId);
  return {
    ...draft,
    settings: {
      ...draft.settings,
      // Only fill system defaults when field is not user-dirty.
      aspectRatio: draft.fieldMeta.aspectRatio?.dirty
        ? draft.settings.aspectRatio
        : (defaults.aspectRatio ?? draft.settings.aspectRatio),
      quantity: draft.fieldMeta.quantity?.dirty
        ? draft.settings.quantity
        : (defaults.quantity ?? draft.settings.quantity),
      durationSeconds: draft.fieldMeta.durationSeconds?.dirty
        ? draft.settings.durationSeconds
        : (defaults.durationSeconds ?? draft.settings.durationSeconds),
    },
  };
}

function resetLensScopedSettings(draft: ComposerDraft): ComposerDraft {
  return {
    ...draft,
    settings: {
      ...draft.settings,
      catalogModelId: null,
      catalogModelName: null,
      catalogModelRevision: null,
      catalogModelSource: null,
      aspectRatio: null,
      quantity: null,
      durationSeconds: null,
      params: {},
    },
    modelPolicyMode: 'auto',
    dirtySettings: {},
    recipeRevisionId: null,
    quoteRevisionId: null,
    quoteView: null,
    selectedToolIds: [],
    // fieldMeta for lens-scoped keys cleared; keep userText ownership
    fieldMeta: Object.fromEntries(
      Object.entries(draft.fieldMeta).filter(
        ([key]) =>
          key === 'userText' || key === 'sources' || key === 'assetRights'
      )
    ),
  };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Explicit user lens selection from cold unselected state.
 * Never inferred — caller must pass a concrete CreationLensId.
 */
export function selectLens(
  state: ComposerLensState,
  lensId: CreationLensId
): ComposerLensState {
  assertLensId(lensId);
  if (state.phase === 'frozen') {
    return state;
  }
  if (state.phase === 'switch_preview') {
    return state;
  }
  if (state.phase === 'selected' && state.lensId === lensId) {
    return state;
  }
  if (state.phase === 'selected' && state.lensId !== lensId) {
    return requestSwitchLens(state, lensId);
  }

  // unselected → selected
  const restored = state.stashByLens[lensId];
  const nextDraft = restored
    ? cloneDraft(restored)
    : applyLensDefaults(cloneDraft(state.draft), lensId);

  // Always keep current user text / sources / rights from live draft.
  nextDraft.userText = state.draft.userText;
  nextDraft.sources = [...state.draft.sources];
  nextDraft.assetRights = state.draft.assetRights;
  nextDraft.delivery = { ...state.draft.delivery };

  return {
    phase: 'selected',
    lensId,
    source: 'user_explicit',
    draft: nextDraft,
    stashByLens: state.stashByLens,
    undoStack: state.undoStack,
  };
}

/**
 * Request a lens switch from selected.
 * No protected dirty → direct switch (still keeps text).
 * Protected dirty → switch_preview (active lens unchanged until confirm).
 */
export function requestSwitchLens(
  state: ComposerLensState,
  toLensId: CreationLensId
): ComposerLensState {
  assertLensId(toLensId);
  if (state.phase !== 'selected') return state;
  if (state.lensId === toLensId) return state;

  const preview = buildLensSwitchPreview(state.lensId, toLensId, state.draft);
  if (!switchRequiresConfirmation(preview)) {
    return commitLensSwitch(state, toLensId, preview);
  }

  return {
    phase: 'switch_preview',
    lensId: state.lensId,
    source: 'user_explicit',
    draft: state.draft,
    preview,
    previewBaseline: cloneDraft(state.draft),
    stashByLens: state.stashByLens,
    undoStack: state.undoStack,
  };
}

/**
 * Confirm switch_preview → selected(toLens).
 * Stashes previous lens draft for later restore; keeps text/sources/rights.
 */
export function confirmSwitch(state: ComposerLensState): ComposerLensState {
  if (state.phase !== 'switch_preview') return state;
  return commitLensSwitch(state, state.preview.toLensId, state.preview);
}

function commitLensSwitch(
  state: SelectedState | SwitchPreviewState,
  toLensId: CreationLensId,
  preview: SwitchPreview
): SelectedState {
  const fromLensId = state.lensId;
  const previousDraft = cloneDraft(state.draft);

  // Stash full previous draft under fromLens for restore-on-return.
  const stashByLens: StashByLens = {
    ...state.stashByLens,
    [fromLensId]: previousDraft,
  };

  const restored = stashByLens[toLensId];
  let nextDraft: ComposerDraft;
  if (restored) {
    nextDraft = cloneDraft(restored);
  } else {
    nextDraft = applyLensDefaults(
      resetLensScopedSettings(cloneDraft(state.draft)),
      toLensId
    );
  }

  // Always preserve text / sources / rights / delivery suggestion from live draft.
  nextDraft.userText = state.draft.userText;
  nextDraft.sources = [...state.draft.sources];
  nextDraft.assetRights = state.draft.assetRights;
  nextDraft.delivery = { ...state.draft.delivery };

  const undoEntry: UndoEntry = {
    kind: 'lens_switch',
    previousLensId: fromLensId,
    previousDraft,
    label: `撤销切换到${lensLabel(toLensId)}`,
  };

  // Mark stashed fields as applied (for observability; draft already reset).
  void preview;

  return {
    phase: 'selected',
    lensId: toLensId,
    source: 'user_explicit',
    draft: nextDraft,
    stashByLens,
    undoStack: [...state.undoStack, undoEntry],
  };
}

/** Cancel switch_preview — restore original lens + draft. */
export function cancelSwitch(state: ComposerLensState): ComposerLensState {
  if (state.phase !== 'switch_preview') return state;
  return {
    phase: 'selected',
    lensId: state.lensId,
    source: 'user_explicit',
    draft: cloneDraft(state.previewBaseline),
    stashByLens: state.stashByLens,
    undoStack: state.undoStack,
  };
}

/**
 * Undo the last committed change (lens switch or settings).
 * Restores previous lens + draft snapshot.
 */
export function undoChange(state: ComposerLensState): ComposerLensState {
  if (state.phase === 'unselected' || state.phase === 'frozen') return state;
  if (state.phase === 'switch_preview') {
    return cancelSwitch(state);
  }
  if (state.undoStack.length === 0) return state;

  const stack = [...state.undoStack];
  const entry = stack.pop()!;
  const restoredDraft = cloneDraft(entry.previousDraft);

  // Keep any text typed after the switch (user may have continued editing).
  // Spec: "切换逐字保留输入" — undo restores settings but live text wins if longer?
  // D-081: undo restores the previous lens settings; text is always preserve.
  // Use the undo entry's text only if current text equals post-switch text;
  // simplest correct rule: always keep CURRENT userText/sources/rights.
  restoredDraft.userText = state.draft.userText;
  restoredDraft.sources = [...state.draft.sources];
  restoredDraft.assetRights = state.draft.assetRights;

  return {
    phase: 'selected',
    lensId: entry.previousLensId,
    source: 'user_explicit',
    draft: restoredDraft,
    stashByLens: {
      ...state.stashByLens,
      [state.lensId]: cloneDraft(state.draft),
    },
    undoStack: stack,
  };
}

// ---------------------------------------------------------------------------
// Draft field updates (never reverse-change lens)
// ---------------------------------------------------------------------------

export function updateUserText(
  state: ComposerLensState,
  userText: string
): ComposerLensState {
  if (state.phase === 'frozen') return state;
  return withDraft(state, {
    ...state.draft,
    userText,
    fieldMeta: {
      ...state.draft.fieldMeta,
      userText: { ownership: 'user', dirty: userText.length > 0 },
    },
  });
}

export function updateSources(
  state: ComposerLensState,
  sources: unknown[]
): ComposerLensState {
  if (state.phase === 'frozen') return state;
  return withDraft(state, {
    ...state.draft,
    sources: [...sources],
    fieldMeta: {
      ...state.draft.fieldMeta,
      sources: { ownership: 'user', dirty: sources.length > 0 },
    },
  });
}

export function updateAssetRights(
  state: ComposerLensState,
  assetRights: unknown | null
): ComposerLensState {
  if (state.phase === 'frozen') return state;
  return withDraft(state, {
    ...state.draft,
    assetRights,
    fieldMeta: {
      ...state.draft.fieldMeta,
      assetRights: { ownership: 'user', dirty: assetRights != null },
    },
  });
}

/**
 * Platform + deliverable suggestion — visible & editable.
 * MUST NOT reverse-change the lens (D-081).
 */
export function updateDeliverySuggestion(
  state: ComposerLensState,
  delivery: Partial<DeliverySuggestion>,
  ownership: FieldOwnership = 'user'
): ComposerLensState {
  if (state.phase === 'frozen') return state;
  const userConfirmedDestination =
    state.draft.fieldMeta.deliveryPlatform?.ownership === 'user' &&
    state.draft.fieldMeta.deliveryPlatform.dirty;
  if (ownership !== 'user' && userConfirmedDestination) return state;

  const nextPlatform =
    delivery.platform !== undefined
      ? delivery.platform
      : state.draft.delivery.platform;
  const nextDistributionTarget =
    delivery.distributionTarget !== undefined
      ? delivery.distributionTarget
      : state.draft.delivery.distributionTarget;
  const destinationChanged =
    nextPlatform !== state.draft.delivery.platform ||
    nextDistributionTarget !== state.draft.delivery.distributionTarget;
  const fieldMeta = { ...state.draft.fieldMeta };
  if (delivery.platform !== undefined) {
    fieldMeta.deliveryPlatform = {
      ownership,
      dirty: ownership === 'user' && delivery.platform != null,
    };
  }
  if (delivery.distributionTarget !== undefined) {
    fieldMeta.distributionTarget = {
      ownership,
      dirty: ownership === 'user' && delivery.distributionTarget != null,
    };
  }

  return withDraft(state, {
    ...state.draft,
    delivery: {
      platform: nextPlatform,
      distributionTarget: nextDistributionTarget,
      deliverableKind:
        delivery.deliverableKind !== undefined
          ? delivery.deliverableKind
          : state.draft.delivery.deliverableKind,
    },
    fieldMeta,
    quoteRevisionId: destinationChanged ? null : state.draft.quoteRevisionId,
    quoteView: destinationChanged ? null : state.draft.quoteView,
  });
}

export function updateSelectedTools(
  state: ComposerLensState,
  toolIds: string[]
): ComposerLensState {
  if (state.phase === 'frozen') return state;
  return withDraft(state, {
    ...state.draft,
    selectedToolIds: [...toolIds],
    fieldMeta: {
      ...state.draft.fieldMeta,
      selectedTools: { ownership: 'user', dirty: toolIds.length > 0 },
    },
  });
}

export type SettingsPatch = Partial<{
  catalogModelId: string | null;
  catalogModelName: string | null;
  catalogModelRevision: string | null;
  catalogModelSource: string | null;
  aspectRatio: string | null;
  quantity: number | null;
  durationSeconds: number | null;
  params: Record<string, unknown>;
  modelPolicyMode: 'auto' | 'fixed';
}>;

/**
 * User/template settings change. Marks dirty + ownership.
 * Does not change lens. Caller should re-quote after this.
 */
export function updateSettings(
  state: ComposerLensState,
  patch: SettingsPatch,
  ownership: FieldOwnership = 'user'
): ComposerLensState {
  if (state.phase === 'frozen' || state.phase === 'switch_preview') {
    return state;
  }

  const dirtySettings = { ...state.draft.dirtySettings };
  const fieldMeta = { ...state.draft.fieldMeta };
  const settings = { ...state.draft.settings };

  const touch = (key: string, value: unknown) => {
    if (ownership === 'user') {
      dirtySettings[key] = value;
      fieldMeta[key] = { ownership: 'user', dirty: true };
    } else if (ownership === 'template') {
      fieldMeta[key] = {
        ownership: 'template',
        dirty: fieldMeta[key]?.ownership === 'user',
      };
      // Template cannot overwrite user-dirty fields.
      if (fieldMeta[key]?.ownership === 'user' && fieldMeta[key]?.dirty) {
        return false;
      }
    } else {
      // system — only when not user-dirty
      if (fieldMeta[key]?.ownership === 'user' && fieldMeta[key]?.dirty) {
        return false;
      }
      fieldMeta[key] = { ownership: 'system', dirty: false };
    }
    return true;
  };

  if (
    patch.catalogModelId !== undefined &&
    touch('catalogModelId', patch.catalogModelId)
  ) {
    settings.catalogModelId = patch.catalogModelId;
  }
  if (
    patch.catalogModelName !== undefined &&
    touch('catalogModelName', patch.catalogModelName)
  ) {
    settings.catalogModelName = patch.catalogModelName;
  }
  if (
    patch.catalogModelRevision !== undefined &&
    touch('catalogModelRevision', patch.catalogModelRevision)
  ) {
    settings.catalogModelRevision = patch.catalogModelRevision;
  }
  if (
    patch.catalogModelSource !== undefined &&
    touch('catalogModelSource', patch.catalogModelSource)
  ) {
    settings.catalogModelSource = patch.catalogModelSource;
  }
  if (
    patch.aspectRatio !== undefined &&
    touch('aspectRatio', patch.aspectRatio)
  ) {
    settings.aspectRatio = patch.aspectRatio;
  }
  if (patch.quantity !== undefined && touch('quantity', patch.quantity)) {
    settings.quantity = patch.quantity;
  }
  if (
    patch.durationSeconds !== undefined &&
    touch('durationSeconds', patch.durationSeconds)
  ) {
    settings.durationSeconds = patch.durationSeconds;
  }
  if (patch.params !== undefined && touch('params', patch.params)) {
    settings.params = { ...patch.params };
  }

  let modelPolicyMode = state.draft.modelPolicyMode;
  if (patch.modelPolicyMode !== undefined) {
    if (ownership === 'user' || !fieldMeta.modelPolicyMode?.dirty) {
      modelPolicyMode = patch.modelPolicyMode;
      if (ownership === 'user') {
        dirtySettings.modelPolicyMode = patch.modelPolicyMode;
        fieldMeta.modelPolicyMode = { ownership: 'user', dirty: true };
      }
    }
  }

  return withDraft(state, {
    ...state.draft,
    settings,
    dirtySettings,
    fieldMeta,
    modelPolicyMode,
  });
}

/** Bind a re-quoted product quote view onto the draft. */
export function bindQuoteView(
  state: ComposerLensState,
  quoteView: ComposerQuoteView | null
): ComposerLensState {
  if (state.phase === 'frozen') return state;
  return withDraft(state, {
    ...state.draft,
    quoteView,
    quoteRevisionId: quoteView?.revision ?? null,
  });
}

// ---------------------------------------------------------------------------
// Submit / freeze
// ---------------------------------------------------------------------------

export function canSubmit(state: ComposerLensState): SubmitGateResult {
  if (state.phase === 'unselected' || state.lensId == null) {
    return {
      allowed: false,
      reason: 'lens_unselected',
      message: LENS_REQUIRED_SUBMIT_HINT,
      focusTarget: 'lens_group',
    };
  }
  if (state.phase === 'switch_preview') {
    return {
      allowed: false,
      reason: 'lens_unselected',
      message: '请先完成创作类型切换确认',
      focusTarget: 'lens_group',
    };
  }
  if (state.phase === 'frozen') {
    return {
      allowed: false,
      reason: 'lens_unselected',
      message: '任务已提交，请基于当前内容新建创作',
      focusTarget: 'lens_group',
    };
  }

  return evaluateSubmitGate({
    lensId: state.lensId,
    quote: state.draft.quoteView,
    videoConfirmAccepted: undefined,
  });
}

/**
 * Submit gate with optional video confirm acceptance.
 * On success freezes lens + revisions (phase → frozen).
 */
export function submitComposer(
  state: ComposerLensState,
  options?: {
    videoConfirmAccepted?: boolean;
    confirmPriceMatchesCharge?: boolean;
    now?: string;
  }
):
  | { ok: true; state: FrozenState; videoConfirm: VideoConfirmZone | null }
  | { ok: false; gate: SubmitGateResult; state: ComposerLensState } {
  if (state.phase !== 'selected') {
    const gate = canSubmit(state);
    return { ok: false, gate, state };
  }

  const gate = evaluateSubmitGate({
    lensId: state.lensId,
    quote: state.draft.quoteView,
    videoConfirmAccepted: options?.videoConfirmAccepted,
    confirmPriceMatchesCharge: options?.confirmPriceMatchesCharge,
  });

  if (!gate.allowed) {
    return { ok: false, gate, state };
  }

  const frozen: FrozenRevisions = {
    lensId: state.lensId,
    surfaceRevisionId: state.draft.surfaceRevisionId,
    recipeRevisionId: state.draft.recipeRevisionId,
    modelRevisionId: state.draft.settings.catalogModelRevision,
    quoteRevisionId: state.draft.quoteRevisionId,
    frozenAt: options?.now ?? new Date(0).toISOString(),
  };

  const next: FrozenState = {
    phase: 'frozen',
    lensId: state.lensId,
    source: 'user_explicit',
    draft: state.draft,
    frozen,
    stashByLens: state.stashByLens,
    undoStack: state.undoStack,
  };

  return {
    ok: true,
    state: next,
    videoConfirm: gate.videoConfirm,
  };
}

/**
 * Thaw a submitted composer back into an editable draft (W03 可恢复入口).
 *
 * The freeze exists so a delivered run cannot be silently re-submitted under
 * the same revisions. A declared failure is the opposite situation: nothing was
 * delivered, and the merchant is being invited to act. So reopening keeps the
 * draft they wrote (their sentence, sources, settings) and drops only the
 * frozen revision pins, putting the state back where `canSubmit` allows a fresh
 * run. Any other phase is already editable and passes through untouched.
 */
export function reopenComposer(state: ComposerLensState): ComposerLensState {
  if (state.phase !== 'frozen') return state;
  return {
    phase: 'selected',
    lensId: state.lensId,
    source: state.source,
    draft: state.draft,
    stashByLens: state.stashByLens,
    undoStack: state.undoStack,
  };
}

export function videoConfirmForState(
  state: ComposerLensState
): VideoConfirmZone {
  return buildVideoConfirmZone({
    lensId: state.lensId,
    quote: state.draft.quoteView,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withDraft(
  state: ComposerLensState,
  draft: ComposerDraft
): ComposerLensState {
  switch (state.phase) {
    case 'unselected':
      return { ...state, draft };
    case 'selected':
      return { ...state, draft };
    case 'switch_preview':
      return { ...state, draft };
    case 'frozen':
      return state;
  }
}

function assertLensId(lensId: string): asserts lensId is CreationLensId {
  if (!(creationLensIds as readonly string[]).includes(lensId)) {
    throw new Error(`invalid lens id: ${lensId}`);
  }
}

/** Read-only projection for UI binding. */
export function lensStateView(state: ComposerLensState) {
  return {
    phase: state.phase,
    lensId: state.lensId,
    source: state.source,
    submitBlocked:
      state.phase === 'unselected' ||
      state.phase === 'switch_preview' ||
      state.phase === 'frozen',
    submitHint: state.phase === 'unselected' ? LENS_REQUIRED_SUBMIT_HINT : null,
    canUndo: state.phase === 'selected' && state.undoStack.length > 0,
    preview: state.phase === 'switch_preview' ? state.preview : null,
    delivery: state.draft.delivery,
    userText: state.draft.userText,
    settings: state.draft.settings,
    quoteView: state.draft.quoteView,
    frozen: state.phase === 'frozen' ? state.frozen : null,
  };
}

/** Bind a raw ProductQuoteSnapshot revision id after server re-quote. */
export function bindQuoteSnapshotRevision(
  state: ComposerLensState,
  snapshot: Pick<ProductQuoteSnapshot, 'revision'> | null
): ComposerLensState {
  if (state.phase === 'frozen') return state;
  return withDraft(state, {
    ...state.draft,
    quoteRevisionId: snapshot?.revision ?? null,
  });
}
