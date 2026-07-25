/**
 * Client-side RecipePatchPreview builder (C2 / #96, D-083).
 *
 * Mirrors core `buildRecipePatchPreview` pure rules so the Composer can
 * decide local passthrough vs confirmation without a server round-trip for
 * the no-conflict path. Conflict UI always consumes the RecipePatchPreview
 * contract shape (server-preferred when provided by caller).
 *
 * Diffs are actual — never fixed "will change X" copy when values match.
 */

import {
  composerContentPackagePlatformSchema,
  composerDeliverableKindSchema,
} from '@meiye/contracts';
import type {
  CreationLensId,
  RecipeDeliveryDefaults,
  RecipeDraftFields,
  RecipeModelPolicy,
  RecipePatchConflictKind,
  RecipePatchFieldDiff,
  RecipePatchPreview,
  RecipeRevisionId,
  SurfaceRevisionId,
} from '@meiye/contracts';

import {
  CTA_APPLY_AND_UPDATE_SETTINGS,
  CTA_CANCEL,
  ctaSwitchToLensAndApply,
  type RecipeCardTarget,
} from './launch-card-seeds';
import type { ComposerDraft, ComposerLensState } from './lens-state-machine';

function stableEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    return a === b;
  }
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  try {
    return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
  } catch {
    return false;
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) {
    if (object[key] !== undefined) {
      out[key] = canonicalize(object[key]);
    }
  }
  return out;
}

function hasUserText(draft: RecipeDraftFields): boolean {
  return typeof draft.userText === 'string' && draft.userText.length > 0;
}

function hasSources(draft: RecipeDraftFields): boolean {
  return Array.isArray(draft.sources) && draft.sources.length > 0;
}

function dirtyKeys(draft: RecipeDraftFields): string[] {
  if (!draft.dirtySettings || typeof draft.dirtySettings !== 'object') {
    return [];
  }
  return Object.keys(draft.dirtySettings);
}

function deliveryDiff(
  from: RecipeDeliveryDefaults | null | undefined,
  to: RecipeDeliveryDefaults
): RecipePatchFieldDiff | null {
  const left = from ?? {};
  if (stableEqual(left, to)) return null;
  return {
    field: 'delivery',
    action: 'change',
    from: left,
    to: { ...to },
  };
}

function modelPolicyDiff(
  from: RecipeModelPolicy | null | undefined,
  to: RecipeModelPolicy
): RecipePatchFieldDiff | null {
  if (from && stableEqual(from, to)) return null;
  return {
    field: 'modelPolicy',
    action: 'change',
    from: from ?? null,
    to: { ...to },
  };
}

function settingsDiff(
  draft: RecipeDraftFields,
  recipe: RecipeCardTarget
): RecipePatchFieldDiff[] {
  const diffs: RecipePatchFieldDiff[] = [];
  const recipeSettings = recipe.settingsPatches ?? {};
  const currentSettings = draft.settings ?? {};
  const keys = new Set([
    ...Object.keys(recipeSettings),
    ...Object.keys(currentSettings),
    ...dirtyKeys(draft),
  ]);
  for (const key of keys) {
    const from = currentSettings[key];
    const to = recipeSettings[key];
    if (stableEqual(from, to)) continue;
    const isDirty = Boolean(
      draft.dirtySettings && Object.hasOwn(draft.dirtySettings, key)
    );
    diffs.push({
      field: `settings.${key}`,
      action: isDirty ? 'stash' : 'change',
      from,
      to,
    });
  }
  return diffs;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export type BuildClientPatchPreviewInput = {
  draft: RecipeDraftFields;
  recipe: RecipeCardTarget;
  currentLens?: CreationLensId | null;
  surfaceRevisionId?: SurfaceRevisionId;
};

/**
 * Build RecipePatchPreview from draft + target recipe (D-083 rules).
 * - userText / sources always preserve
 * - same lens + dirty protected → same_lens_dirty + 「套用并更新设置」
 * - different selected lens → cross_lens + 「切换到{对口}并套用」
 * - otherwise → none (passthrough)
 */
export function buildClientRecipePatchPreview(
  input: BuildClientPatchPreviewInput
): RecipePatchPreview {
  const { draft, recipe } = input;
  const currentLensId: CreationLensId | null =
    input.currentLens !== undefined
      ? input.currentLens
      : (draft.lensId ?? null);

  const surfaceRevisionId =
    input.surfaceRevisionId ?? draft.surfaceRevisionId ?? undefined;
  const baseRecipeRevisionId = draft.recipeRevisionId ?? null;

  const preserve: string[] = [];
  const stash: string[] = [];
  const change: string[] = [];
  const conflicts: RecipePatchFieldDiff[] = [];

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

  const lensChanging =
    currentLensId !== null && currentLensId !== recipe.lensId;
  const lensSelecting = currentLensId === null;
  if (lensChanging || lensSelecting || currentLensId !== recipe.lensId) {
    if (currentLensId !== recipe.lensId) {
      change.push('lensId');
      conflicts.push({
        field: 'lensId',
        action: 'change',
        from: currentLensId,
        to: recipe.lensId,
      });
    }
  }

  if (baseRecipeRevisionId !== recipe.revisionId) {
    change.push('recipeRevisionId');
    conflicts.push({
      field: 'recipeRevisionId',
      action: 'change',
      from: baseRecipeRevisionId,
      to: recipe.revisionId,
    });
  }

  const dDiff = deliveryDiff(draft.delivery, recipe.delivery ?? {});
  if (dDiff) {
    change.push(dDiff.field);
    conflicts.push(dDiff);
  }

  const dirty = dirtyKeys(draft);
  const modelIsDirty =
    dirty.includes('modelPolicy') ||
    dirty.includes('model') ||
    Boolean(
      draft.dirtySettings &&
        (Object.hasOwn(draft.dirtySettings, 'modelPolicy') ||
          Object.hasOwn(draft.dirtySettings, 'model'))
    );
  const mDiff = modelPolicyDiff(
    draft.modelPolicy,
    recipe.modelPolicy ?? { mode: 'auto' }
  );
  if (mDiff) {
    if (modelIsDirty) {
      stash.push('modelPolicy');
      conflicts.push({
        field: 'modelPolicy',
        action: 'stash',
        from: draft.modelPolicy ?? null,
        to: recipe.modelPolicy,
      });
      change.push('modelPolicy');
    } else {
      change.push('modelPolicy');
      conflicts.push(mDiff);
    }
  }

  for (const sDiff of settingsDiff(draft, recipe)) {
    if (sDiff.action === 'stash') {
      stash.push(sDiff.field);
      change.push(sDiff.field);
    } else {
      change.push(sDiff.field);
    }
    conflicts.push(sDiff);
  }

  const recipeQuote = recipe.quotePolicyRevisionRef ?? null;
  if (draft.confirmedQuoteRef) {
    stash.push('confirmedQuoteRef');
    change.push('confirmedQuoteRef');
    conflicts.push({
      field: 'confirmedQuoteRef',
      action: 'stash',
      from: draft.confirmedQuoteRef,
      to: recipeQuote,
    });
  } else if (
    recipeQuote &&
    draft.confirmedQuoteRef !== recipeQuote &&
    dirty.includes('quote')
  ) {
    change.push('confirmedQuoteRef');
    conflicts.push({
      field: 'confirmedQuoteRef',
      action: 'change',
      from: null,
      to: recipeQuote,
    });
  }

  const hasProtectedDirty =
    modelIsDirty ||
    dirty.some(
      (key) =>
        key === 'params' ||
        key === 'template' ||
        key === 'quote' ||
        key === 'settings' ||
        key.startsWith('settings.') ||
        key === 'model' ||
        key === 'modelPolicy'
    ) ||
    Boolean(draft.confirmedQuoteRef) ||
    stash.length > 0;

  let conflictKind: RecipePatchConflictKind = 'none';
  if (lensChanging) {
    conflictKind = 'cross_lens';
  } else if (currentLensId === recipe.lensId && hasProtectedDirty) {
    conflictKind = 'same_lens_dirty';
  }

  const requiresConfirmation = conflictKind !== 'none';

  let primaryCtaLabel: string | null = null;
  let cancelCtaLabel: string | null = null;
  if (conflictKind === 'same_lens_dirty') {
    primaryCtaLabel = CTA_APPLY_AND_UPDATE_SETTINGS;
    cancelCtaLabel = CTA_CANCEL;
  } else if (conflictKind === 'cross_lens') {
    primaryCtaLabel = ctaSwitchToLensAndApply(recipe.lensId);
    cancelCtaLabel = CTA_CANCEL;
  }

  const preview: RecipePatchPreview = {
    recipeRevisionId: recipe.revisionId as RecipeRevisionId,
    lensId: recipe.lensId,
    currentLensId,
    conflictKind,
    requiresConfirmation,
    conflicts,
    preserve: unique(preserve),
    stash: unique(stash),
    change: unique(change),
    primaryCtaLabel,
    cancelCtaLabel,
  };

  if (surfaceRevisionId) {
    preview.surfaceRevisionId = surfaceRevisionId;
    preview.baseSurfaceRevisionId = surfaceRevisionId;
  }
  if (baseRecipeRevisionId !== undefined) {
    preview.baseRecipeRevisionId =
      baseRecipeRevisionId as RecipeRevisionId | null;
  }

  return preview;
}

// ---------------------------------------------------------------------------
// Composer draft → RecipeDraftFields
// ---------------------------------------------------------------------------

export function composerDraftToRecipeFields(
  state: ComposerLensState
): RecipeDraftFields {
  const draft = state.draft;
  const contentPackagePlatform = composerContentPackagePlatformSchema.safeParse(
    draft.delivery.platform
  );
  const deliverableKind = composerDeliverableKindSchema.safeParse(
    draft.delivery.deliverableKind
  );
  return {
    userText: draft.userText,
    sources: draft.sources,
    lensId: state.lensId,
    recipeRevisionId: draft.recipeRevisionId as RecipeRevisionId | null,
    surfaceRevisionId: draft.surfaceRevisionId as SurfaceRevisionId | null,
    delivery: {
      ...(contentPackagePlatform.success
        ? { contentPackagePlatform: contentPackagePlatform.data }
        : {}),
      ...(deliverableKind.success
        ? { deliverableKind: deliverableKind.data }
        : {}),
      quantity: draft.settings.quantity ?? undefined,
      aspectRatio: draft.settings.aspectRatio ?? undefined,
      durationSeconds: draft.settings.durationSeconds ?? undefined,
    },
    modelPolicy: {
      mode: draft.modelPolicyMode,
      ...(draft.settings.catalogModelId
        ? { catalogModelId: draft.settings.catalogModelId }
        : {}),
    },
    dirtySettings: { ...draft.dirtySettings },
    settings: {
      ...draft.settings.params,
      ...(draft.settings.catalogModelId
        ? { catalogModelId: draft.settings.catalogModelId }
        : {}),
      ...(draft.settings.aspectRatio
        ? { aspectRatio: draft.settings.aspectRatio }
        : {}),
      ...(draft.settings.quantity != null
        ? { quantity: draft.settings.quantity }
        : {}),
    },
    confirmedQuoteRef: draft.quoteRevisionId,
  };
}

/** Snapshot helper for tests / apply baseline. */
export function snapshotComposerDraft(draft: ComposerDraft): ComposerDraft {
  return structuredClone(draft);
}
