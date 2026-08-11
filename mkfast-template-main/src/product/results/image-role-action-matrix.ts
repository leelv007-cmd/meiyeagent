/**
 * Image role-action matrix + exact feedback (D-087 / D-095 / WT-D2 / #100).
 *
 * Pure projection: one adoption primary per situation; exact completion
 * feedback strings; a11y names with role / order / adopted state.
 * Server writes are authorized and applied by the canonical visual-adoption port.
 * Local working-selection actions never hit the write chain.
 */

import type { VisualAdoptionRoleAction } from '@meiye/contracts';

// ---------------------------------------------------------------------------
// Recipe / deliverable adoption context
// ---------------------------------------------------------------------------

/** Recipe image output type (D-095). */
export type ImageOutputType = 'single_image' | 'ordered_image_set';

/** Adoption target slot (D-095). Not a separate entity. */
export type ImageAdoptionSlot = 'standalone' | 'primary' | 'cover' | 'gallery';

/** Whether the image is still a candidate or already written. */
export type ImageAdoptionLifecycle = 'candidate' | 'adopted' | 'delivered';

/**
 * Facts that resolve which single adoption primary is shown.
 * Recipe/deliverable must provide enough to disambiguate; otherwise the
 * UI must ask the merchant to pick a role (never default to slot 0).
 */
export type ImageRoleContext = {
  outputType: ImageOutputType;
  /** Resolved slot for the focused image / set. */
  slot: ImageAdoptionSlot;
  lifecycle: ImageAdoptionLifecycle;
  /**
   * Working-selection mode: user is assembling a set (or default for ≥2).
   * Independent of outputType so single_image can still enter set mode.
   */
  setMode: boolean;
  /** Count of images currently in the working selection (0 when not assembling). */
  workingSelectionCount: number;
  /** Whether the focused asset is already in the working selection. */
  focusedInWorkingSelection: boolean;
  /** Whether a ContentPackage already exists for this work. */
  hasContentPackage: boolean;
  /** Whether the focused image currently occupies the adopted slot. */
  focusedIsCurrentSlot?: boolean;
  /**
   * Full frozen candidate set is ready (recipe slots complete).
   * Enables direct "采用这组" without forcing per-image join.
   */
  fullCandidateSetReady?: boolean;
  /** Size of the full candidate set when fullCandidateSetReady. */
  fullCandidateSetCount?: number;
};

// ---------------------------------------------------------------------------
// Action dictionary (D-087 exact labels)
// ---------------------------------------------------------------------------

export type ImageRoleActionKind =
  | 'adopt_one'
  | 'set_primary'
  | 'set_cover'
  | 'add_to_set'
  | 'adopt_set'
  | 'replace_item'
  | 'set_working_cover';

export type ImageRoleAction = {
  kind: ImageRoleActionKind;
  /** Product-facing primary label. */
  label: string;
  /** Whether this action writes canonical ContentPackage (false = local). */
  writesCanonical: boolean;
  /** B1 VisualAdoptionRoleAction kind when writesCanonical; local otherwise. */
  roleActionKind:
    | VisualAdoptionRoleAction['kind']
    | 'set_working_cover'
    | 'replace_item';
};

/** Exact completion feedback (D-087). Must match character-for-character in RTL. */
export const IMAGE_ROLE_FEEDBACK = {
  adopt_one: '已采用这张图片',
  set_primary: '已设为主图',
  set_cover: '已设为封面',
  /** N is 1-based position after join. */
  add_to_set: (n: number) => `已加入套图，第 ${n} 张`,
  adopt_set: (n: number) => `已采用这组，共 ${n} 张`,
  replace_item: '已替换，原版本仍可恢复',
  /** Working-selection cover is not canonical until adopt_set. */
  set_working_cover: '已设为本组封面，采用这组后生效',
  save_to_library: '已在素材库',
  save_selected_to_library: '已在素材库',
} as const;

export type ImageRoleFeedbackKind = keyof typeof IMAGE_ROLE_FEEDBACK;

/**
 * Resolve the single adoption primary for the current image situation.
 * Same situation never shows multiple near-synonym adopt buttons.
 */
export function projectImageRolePrimaryAction(
  ctx: ImageRoleContext
): ImageRoleAction | null {
  // After delivery the shell primary is create_from_this; no adopt primary.
  if (ctx.lifecycle === 'delivered') return null;

  // Replacing an already-adopted slot with a different candidate.
  if (
    ctx.lifecycle === 'adopted' &&
    ctx.hasContentPackage &&
    ctx.focusedIsCurrentSlot === false
  ) {
    return {
      kind: 'replace_item',
      label: '替换当前图片',
      writesCanonical: true,
      roleActionKind: 'replace_item',
    };
  }

  // Set assembly mode: join or adopt whole set.
  if (ctx.setMode || ctx.outputType === 'ordered_image_set') {
    // Complete frozen candidate set → direct whole-set adopt (no per-image join).
    if (
      ctx.fullCandidateSetReady &&
      (ctx.fullCandidateSetCount ?? 0) >= 2 &&
      ctx.workingSelectionCount === 0
    ) {
      return {
        kind: 'adopt_set',
        label: '采用这组',
        writesCanonical: true,
        roleActionKind: 'adopt_set',
      };
    }
    if (ctx.workingSelectionCount >= 2 && !ctx.focusedInWorkingSelection) {
      // Focused candidate not yet in set → join.
      return {
        kind: 'add_to_set',
        label: '加入套图',
        writesCanonical: false,
        roleActionKind: 'add_to_set',
      };
    }
    if (ctx.workingSelectionCount >= 2) {
      return {
        kind: 'adopt_set',
        label: '采用这组',
        writesCanonical: true,
        roleActionKind: 'adopt_set',
      };
    }
    // Fewer than 2 in selection: join first.
    if (!ctx.focusedInWorkingSelection) {
      return {
        kind: 'add_to_set',
        label: '加入套图',
        writesCanonical: false,
        roleActionKind: 'add_to_set',
      };
    }
    // Only one in selection — still assembling.
    return {
      kind: 'add_to_set',
      label: '加入套图',
      writesCanonical: false,
      roleActionKind: 'add_to_set',
    };
  }

  // Single-image paths by slot.
  switch (ctx.slot) {
    case 'primary':
      return {
        kind: 'set_primary',
        label: '选为主图',
        writesCanonical: true,
        roleActionKind: 'set_primary',
      };
    case 'cover':
      return {
        kind: 'set_cover',
        label: '设为封面',
        writesCanonical: true,
        roleActionKind: 'set_cover',
      };
    case 'gallery':
      // Gallery slot without set mode still adopts as one image into package.
      return {
        kind: 'adopt_one',
        label: '采用这张',
        writesCanonical: true,
        roleActionKind: 'adopt_one',
      };
    case 'standalone':
      return {
        kind: 'adopt_one',
        label: '采用这张',
        writesCanonical: true,
        roleActionKind: 'adopt_one',
      };
    default: {
      const _exhaustive: never = ctx.slot;
      return _exhaustive;
    }
  }
}

/**
 * Exact feedback string after a successful role action.
 * `position` is 1-based for add_to_set / adopt_set.
 */
export function imageRoleFeedback(
  kind: ImageRoleActionKind,
  options?: { position?: number; count?: number }
): string {
  switch (kind) {
    case 'adopt_one':
      return IMAGE_ROLE_FEEDBACK.adopt_one;
    case 'set_primary':
      return IMAGE_ROLE_FEEDBACK.set_primary;
    case 'set_cover':
      return IMAGE_ROLE_FEEDBACK.set_cover;
    case 'add_to_set':
      return IMAGE_ROLE_FEEDBACK.add_to_set(options?.position ?? 1);
    case 'adopt_set':
      return IMAGE_ROLE_FEEDBACK.adopt_set(
        options?.count ?? options?.position ?? 1
      );
    case 'replace_item':
      return IMAGE_ROLE_FEEDBACK.replace_item;
    case 'set_working_cover':
      return IMAGE_ROLE_FEEDBACK.set_working_cover;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** Slot role label used in a11y names. */
export function imageSlotRoleLabel(slot: ImageAdoptionSlot): string {
  switch (slot) {
    case 'standalone':
      return '单图';
    case 'primary':
      return '主图';
    case 'cover':
      return '封面';
    case 'gallery':
      return '套图';
    default: {
      const _exhaustive: never = slot;
      return _exhaustive;
    }
  }
}

/**
 * Screen-reader accessible name.
 * Example: "第 2 张，候选，加入套图" / "第 1 张，封面，已采用".
 */
export function imageA11yName(input: {
  /** 1-based order in the current set / gallery. */
  order: number;
  slot: ImageAdoptionSlot;
  lifecycle: ImageAdoptionLifecycle;
  /** Optional pending action label (e.g. 加入套图). */
  pendingActionLabel?: string;
  /** Whether this item is cover/main in working selection (not yet adopted). */
  isWorkingCover?: boolean;
}): string {
  const orderPart = `第 ${input.order} 张`;
  const rolePart = input.isWorkingCover
    ? '本组封面'
    : imageSlotRoleLabel(input.slot);
  const statePart =
    input.lifecycle === 'adopted' || input.lifecycle === 'delivered'
      ? '已采用'
      : '候选';
  const actionPart = input.pendingActionLabel
    ? `，${input.pendingActionLabel}`
    : '';
  return `${orderPart}，${rolePart}，${statePart}${actionPart}`;
}

// ---------------------------------------------------------------------------
// Set-mode threshold (D-095: ≥2 default set mode, switchable to single)
// ---------------------------------------------------------------------------

/** Default set-mode when expected or available image count ≥ this. */
export const IMAGE_SET_MODE_THRESHOLD = 2;

export function defaultImageSetMode(input: {
  outputType: ImageOutputType;
  /** Recipe-expected count or currently available candidate count. */
  expectedOrAvailableCount: number;
  /** Explicit merchant override; wins over default. */
  explicitMode?: 'single' | 'set';
}): 'single' | 'set' {
  if (input.explicitMode) return input.explicitMode;
  if (input.outputType === 'ordered_image_set') return 'set';
  if (input.expectedOrAvailableCount >= IMAGE_SET_MODE_THRESHOLD) return 'set';
  return 'single';
}

// ---------------------------------------------------------------------------
// Adopt vs save-to-library independence (D-087 §5)
// ---------------------------------------------------------------------------

export type ImageLibraryAction =
  | { kind: 'save_one'; label: '保存到素材库'; assetId: string }
  | {
      kind: 'save_selected';
      label: '保存选中图片到素材库';
      assetIds: string[];
    };

/**
 * Library actions never change ContentPackage; adopt never auto-promotes
 * to reusable library assets.
 */
export function projectImageLibraryActions(input: {
  focusedAssetId?: string;
  selectedAssetIds: readonly string[];
  /** Media version + rights lineage must exist before formal shelf. */
  mediaVersionReady: boolean;
}): ImageLibraryAction[] {
  if (!input.mediaVersionReady) return [];
  const actions: ImageLibraryAction[] = [];
  if (input.focusedAssetId) {
    actions.push({
      kind: 'save_one',
      label: '保存到素材库',
      assetId: input.focusedAssetId,
    });
  }
  if (input.selectedAssetIds.length > 1) {
    actions.push({
      kind: 'save_selected',
      label: '保存选中图片到素材库',
      assetIds: [...input.selectedAssetIds],
    });
  }
  return actions;
}

export function libraryActionFeedback(
  kind: ImageLibraryAction['kind']
): string {
  return kind === 'save_one' || kind === 'save_selected'
    ? IMAGE_ROLE_FEEDBACK.save_to_library
    : IMAGE_ROLE_FEEDBACK.save_to_library;
}

// ---------------------------------------------------------------------------
// Map role action → B1 VisualAdoptionRoleAction (for write path)
// ---------------------------------------------------------------------------

/**
 * Compile a writable role action into the B1 VisualAdoptionRoleAction shape.
 * Local-only kinds return null (working-selection reducer owns them).
 */
export function toVisualAdoptionRoleAction(
  kind: ImageRoleActionKind,
  assetId: string,
  orderedAssetIds?: readonly string[]
): VisualAdoptionRoleAction | null {
  switch (kind) {
    case 'adopt_one':
      return { kind: 'adopt_one', assetId };
    case 'set_primary':
      return { kind: 'set_primary', assetId };
    case 'set_cover':
      return { kind: 'set_cover', assetId };
    case 'add_to_set':
      return { kind: 'add_to_set', assetId };
    case 'adopt_set':
      return {
        kind: 'adopt_set',
        assetIds: orderedAssetIds ? [...orderedAssetIds] : [assetId],
      };
    case 'replace_item':
      // replace_item maps to replace_set with single-id list for one-slot replace;
      // whole-set replace uses adopt_set / replace_set with full ordered list.
      return {
        kind: 'replace_set',
        assetIds: orderedAssetIds ? [...orderedAssetIds] : [assetId],
      };
    case 'set_working_cover':
      return null;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
