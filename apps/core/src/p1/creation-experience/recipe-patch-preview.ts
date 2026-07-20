/**
 * RecipePatchPreview pure function (A2 / #89, D-083).
 *
 * (draftFields, recipe, currentLens) → RecipePatchPreview + CTA labels.
 * Diffs are actual — no fixed "will change X" copy when values match.
 * Base revision ids freeze the apply target at preview time.
 */

import type {
  CreationLensId,
  CreationRecipeVersion,
  RecipeDeliveryDefaults,
  RecipeDraftFields,
  RecipeModelPolicy,
  RecipePatchConflictKind,
  RecipePatchFieldDiff,
  RecipePatchPreview,
  RecipeRevisionId,
  SurfaceRevisionId,
} from '@meiye/contracts';
import { LENS_LABELS } from './launch-seeds.js';

/** CTA locked to D-083. */
export const CTA_APPLY_AND_UPDATE_SETTINGS = '套用并更新设置';
export const CTA_CANCEL = '取消';

export function ctaSwitchToLensAndApply(lensId: CreationLensId): string {
  return `切换到${LENS_LABELS[lensId]}并套用`;
}

/** Minimal recipe shape accepted by the pure preview (browser or server record). */
export type RecipePatchTarget = Pick<
  CreationRecipeVersion,
  | 'recipeId'
  | 'revisionId'
  | 'lensId'
  | 'delivery'
  | 'modelPolicy'
  | 'settingsPatches'
  | 'presentation'
  | 'quotePolicyRevisionRef'
> & {
  revisionId: RecipeRevisionId;
  lensId: CreationLensId;
};

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
  to: RecipeDeliveryDefaults,
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
  to: RecipeModelPolicy,
): RecipePatchFieldDiff | null {
  if (from && stableEqual(from, to)) return null;
  if (!from && to.mode === 'auto' && !to.catalogModelId) {
    // Cold draft with no model yet applying auto — still a change for tracking,
    // but not a dirty conflict by itself.
  }
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
  recipe: RecipePatchTarget,
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
      draft.dirtySettings &&
        Object.prototype.hasOwnProperty.call(draft.dirtySettings, key),
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

export interface BuildRecipePatchPreviewInput {
  draft: RecipeDraftFields;
  recipe: RecipePatchTarget;
  /**
   * Explicit current lens override. When omitted, uses draft.lensId.
   * Pass null to force cold (no selection).
   */
  currentLens?: CreationLensId | null;
  /** Optional surface revision freeze (session). */
  surfaceRevisionId?: SurfaceRevisionId;
}

/**
 * Build a server RecipePatchPreview from draft fields + target recipe.
 *
 * Rules (D-083):
 * - userText / sources always preserve (never conflict triggers)
 * - same lens + dirty model/params/template/quote → same_lens_dirty + 「套用并更新设置」
 * - different selected lens → cross_lens + 「切换到{对口}并套用」
 * - otherwise → none (passthrough, no confirmation)
 */
export function buildRecipePatchPreview(
  input: BuildRecipePatchPreviewInput,
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

  // —— always-preserve user-owned content ——
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

  // —— lens ——
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

  // —— recipe revision apply ——
  if (baseRecipeRevisionId !== recipe.revisionId) {
    change.push('recipeRevisionId');
    conflicts.push({
      field: 'recipeRevisionId',
      action: 'change',
      from: baseRecipeRevisionId,
      to: recipe.revisionId,
    });
  }

  // —— delivery ——
  const dDiff = deliveryDiff(draft.delivery, recipe.delivery ?? {});
  if (dDiff) {
    change.push(dDiff.field);
    conflicts.push(dDiff);
  }

  // —— model policy ——
  const dirty = dirtyKeys(draft);
  const modelIsDirty =
    dirty.includes('modelPolicy') ||
    dirty.includes('model') ||
    Boolean(
      draft.dirtySettings &&
        (Object.prototype.hasOwnProperty.call(
          draft.dirtySettings,
          'modelPolicy',
        ) ||
          Object.prototype.hasOwnProperty.call(draft.dirtySettings, 'model')),
    );
  const mDiff = modelPolicyDiff(draft.modelPolicy, recipe.modelPolicy);
  if (mDiff) {
    if (modelIsDirty) {
      // Stash user-owned model, then change to recipe policy.
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

  // —— settings (params / template / variant etc.) ——
  for (const sDiff of settingsDiff(draft, recipe)) {
    if (sDiff.action === 'stash') {
      stash.push(sDiff.field);
      change.push(sDiff.field);
    } else {
      change.push(sDiff.field);
    }
    conflicts.push(sDiff);
  }

  // —— confirmed quote ——
  const recipeQuote = recipe.quotePolicyRevisionRef ?? null;
  if (draft.confirmedQuoteRef) {
    const quoteChanges =
      recipeQuote !== null && draft.confirmedQuoteRef !== recipeQuote;
    // Re-applying a recipe always invalidates a confirmed quote snapshot.
    stash.push('confirmedQuoteRef');
    change.push('confirmedQuoteRef');
    conflicts.push({
      field: 'confirmedQuoteRef',
      action: 'stash',
      from: draft.confirmedQuoteRef,
      to: recipeQuote,
    });
    void quoteChanges;
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

  // —— conflict class ——
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
        key === 'modelPolicy',
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
    recipeRevisionId: recipe.revisionId,
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
    preview.baseRecipeRevisionId = baseRecipeRevisionId;
  }

  return preview;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
