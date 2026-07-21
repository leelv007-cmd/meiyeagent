/**
 * Image worksurface pure projection (D-087 / D-095 / WT-D2 / #100).
 *
 * Large preview / set tray · role-action matrix · working selection ·
 * adopt vs library independence · create-from-this reinjects store facts.
 * Mobile P0 full actions — never "请到桌面继续".
 */

import {
  defaultImageSetMode,
  imageA11yName,
  imageRoleFeedback,
  projectImageLibraryActions,
  projectImageRolePrimaryAction,
  type ImageAdoptionLifecycle,
  type ImageAdoptionSlot,
  type ImageLibraryAction,
  type ImageOutputType,
  type ImageRoleAction,
  type ImageRoleContext,
} from './image-role-action-matrix';
import {
  createEmptyWorkingSelection,
  projectWorkingSelectionSlots,
  type WorkingSelectionState,
} from './working-selection-reducer';
import {
  validateWholeSetAdopt,
  type WholeSetAdoptCandidate,
  type WholeSetAdoptValidation,
} from './whole-set-adopt';

// ---------------------------------------------------------------------------
// Candidate / facts
// ---------------------------------------------------------------------------

export type ImageCandidate = {
  assetId: string;
  /** Optional display URL (already authorized / durable). */
  previewUrl?: string;
  persisted: boolean;
  rightsOk: boolean;
  generationOk?: boolean;
  /** 1-based recipe slot order when known. */
  recipeOrder?: number;
};

export type ImageWorksurfaceFacts = {
  workId: string;
  baseRevisionId: string;
  outputType: ImageOutputType;
  slot: ImageAdoptionSlot;
  lifecycle: ImageAdoptionLifecycle;
  candidates: readonly ImageCandidate[];
  focusedAssetId?: string;
  /** Explicit mode override; default uses 2-image threshold. */
  explicitMode?: 'single' | 'set';
  workingSelection?: WorkingSelectionState;
  hasContentPackage: boolean;
  /** Adopted ordered asset ids when package exists. */
  adoptedOrderedAssetIds?: readonly string[];
  /** Media version lineage ready for library shelf. */
  mediaVersionReady: boolean;
  /** Current store facts + quote for create-from-this. */
  storeFactsSnapshotId?: string;
  productQuoteSnapshotId?: string;
  viewport?: 'desktop' | 'mobile';
};

// ---------------------------------------------------------------------------
// Create-from-this (D-085): reinject current store facts + quote
// ---------------------------------------------------------------------------

export type CreateFromThisCommand = {
  kind: 'create_from_this';
  label: '基于此再创作';
  sourceWorkId: string;
  sourceRevisionId: string;
  /** Structure / style / slots reused — not old prices or customer facts. */
  reuse: {
    structure: true;
    style: true;
    slots: true;
    selectedAssetRoles: true;
  };
  /** Fresh injections — never copy stale store facts from the source package. */
  reinject: {
    storeFactsSnapshotId: string | null;
    productQuoteSnapshotId: string | null;
  };
  /** Forbidden: mutating source or copying old price/deadline/customer facts. */
  constraints: {
    mutateSource: false;
    copyOldPrices: false;
    copyOldDeadlines: false;
    copyCustomerFacts: false;
  };
};

export function buildCreateFromThisCommand(input: {
  sourceWorkId: string;
  sourceRevisionId: string;
  storeFactsSnapshotId?: string | null;
  productQuoteSnapshotId?: string | null;
}): CreateFromThisCommand {
  return {
    kind: 'create_from_this',
    label: '基于此再创作',
    sourceWorkId: input.sourceWorkId,
    sourceRevisionId: input.sourceRevisionId,
    reuse: {
      structure: true,
      style: true,
      slots: true,
      selectedAssetRoles: true,
    },
    reinject: {
      storeFactsSnapshotId: input.storeFactsSnapshotId ?? null,
      productQuoteSnapshotId: input.productQuoteSnapshotId ?? null,
    },
    constraints: {
      mutateSource: false,
      copyOldPrices: false,
      copyOldDeadlines: false,
      copyCustomerFacts: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Mobile P0
// ---------------------------------------------------------------------------

export const IMAGE_MOBILE_P0_ACTIONS = [
  'view',
  'adopt',
  'free_text_adjust',
  'copy_download',
  'share_or_fallback',
  'save_revision',
  'save_to_library',
  'create_from_this',
  'version_restore',
  'async_recover_retry_cancel',
  'set_sort',
  'set_cover',
  'set_remove',
  'adopt_set',
] as const;

export type ImageMobileP0Action = (typeof IMAGE_MOBILE_P0_ACTIONS)[number];

/** Forbidden desktop-gate copy — must never appear on mobile P0. */
export const FORBIDDEN_DESKTOP_GATE_MESSAGES = [
  '请到桌面继续',
  '请在桌面端继续',
  'please continue on desktop',
] as const;

export function projectImageMobileP0Actions(): {
  actions: readonly ImageMobileP0Action[];
  desktopOnlyMessage: null;
  forbiddenMessages: readonly string[];
} {
  return {
    actions: IMAGE_MOBILE_P0_ACTIONS,
    desktopOnlyMessage: null,
    forbiddenMessages: FORBIDDEN_DESKTOP_GATE_MESSAGES,
  };
}

// ---------------------------------------------------------------------------
// Surface projection
// ---------------------------------------------------------------------------

export type ImageCandidateView = {
  assetId: string;
  order: number;
  a11yName: string;
  previewUrl?: string;
  inWorkingSelection: boolean;
  isWorkingCover: boolean;
  isFocused: boolean;
  isAdopted: boolean;
};

export type ImageWorksurfaceView = {
  mode: 'single' | 'set';
  modeSwitchable: boolean;
  primaryAction: ImageRoleAction | null;
  libraryActions: ImageLibraryAction[];
  candidates: ImageCandidateView[];
  workingSelection: WorkingSelectionState;
  workingSlots: ReturnType<typeof projectWorkingSelectionSlots>;
  /** Whole-set adopt validation when mode is set and selection non-empty. */
  wholeSetAdopt: WholeSetAdoptValidation | null;
  adjustPrompt: {
    placeholder: '还想怎么改？';
    submitLabel: '提交调整';
    persistent: true;
    scopeActions: { id: 'adjust_one' | 'adjust_set'; label: string }[];
  };
  createFromThis: CreateFromThisCommand | null;
  mobileDesktopGate: null;
  feedback: string | null;
};

function buildRoleContext(
  facts: ImageWorksurfaceFacts,
  mode: 'single' | 'set',
  selection: WorkingSelectionState,
  focusedAssetId: string | undefined
): ImageRoleContext {
  const focusedInWorkingSelection = focusedAssetId
    ? selection.orderedAssetIds.includes(focusedAssetId)
    : false;
  const focusedIsCurrentSlot =
    focusedAssetId && facts.adoptedOrderedAssetIds
      ? facts.adoptedOrderedAssetIds[0] === focusedAssetId
        ? true
        : facts.adoptedOrderedAssetIds.includes(focusedAssetId)
          ? true
          : false
      : undefined;

  const allGenerationOk = facts.candidates.every(
    (c) => c.generationOk !== false && c.persisted && c.rightsOk
  );
  const fullCandidateSetReady =
    mode === 'set' && facts.candidates.length >= 2 && allGenerationOk;

  return {
    outputType: facts.outputType,
    slot: facts.slot,
    lifecycle: facts.lifecycle,
    setMode: mode === 'set',
    workingSelectionCount: selection.orderedAssetIds.length,
    focusedInWorkingSelection,
    hasContentPackage: facts.hasContentPackage,
    focusedIsCurrentSlot:
      facts.lifecycle === 'adopted' && focusedAssetId
        ? facts.adoptedOrderedAssetIds?.includes(focusedAssetId)
          ? true
          : false
        : focusedIsCurrentSlot,
    fullCandidateSetReady,
    fullCandidateSetCount: facts.candidates.length,
  };
}

export function projectImageWorksurface(
  facts: ImageWorksurfaceFacts,
  options?: { lastFeedback?: string | null }
): ImageWorksurfaceView {
  const mode = defaultImageSetMode({
    outputType: facts.outputType,
    expectedOrAvailableCount: facts.candidates.length,
    explicitMode: facts.explicitMode,
  });
  const modeSwitchable =
    facts.candidates.length >= 2 || facts.outputType === 'ordered_image_set';

  const selection =
    facts.workingSelection ??
    createEmptyWorkingSelection({
      workId: facts.workId,
      baseRevisionId: facts.baseRevisionId,
      now: new Date(0).toISOString(),
    });

  const focusedAssetId =
    facts.focusedAssetId ??
    selection.focusAssetId ??
    facts.candidates[0]?.assetId;

  const roleCtx = buildRoleContext(facts, mode, selection, focusedAssetId);
  const primaryAction = projectImageRolePrimaryAction(roleCtx);

  const libraryActions = projectImageLibraryActions({
    focusedAssetId,
    selectedAssetIds: selection.orderedAssetIds,
    mediaVersionReady: facts.mediaVersionReady,
  });

  const candidates: ImageCandidateView[] = facts.candidates.map(
    (candidate, index) => {
      const order = candidate.recipeOrder ?? index + 1;
      const inWorkingSelection = selection.orderedAssetIds.includes(
        candidate.assetId
      );
      const isWorkingCover = selection.coverAssetId === candidate.assetId;
      const isAdopted =
        facts.lifecycle === 'adopted' || facts.lifecycle === 'delivered'
          ? Boolean(facts.adoptedOrderedAssetIds?.includes(candidate.assetId))
          : false;
      const pendingLabel =
        primaryAction &&
        focusedAssetId === candidate.assetId &&
        primaryAction.kind === 'add_to_set'
          ? primaryAction.label
          : undefined;
      return {
        assetId: candidate.assetId,
        order,
        a11yName: imageA11yName({
          order,
          slot: facts.slot,
          lifecycle: isAdopted ? 'adopted' : 'candidate',
          pendingActionLabel: pendingLabel,
          isWorkingCover,
        }),
        ...(candidate.previewUrl ? { previewUrl: candidate.previewUrl } : {}),
        inWorkingSelection,
        isWorkingCover,
        isFocused: focusedAssetId === candidate.assetId,
        isAdopted,
      };
    }
  );

  let wholeSetAdopt: WholeSetAdoptValidation | null = null;
  if (mode === 'set' && selection.orderedAssetIds.length > 0) {
    const adoptCandidates: WholeSetAdoptCandidate[] = facts.candidates.map(
      (c) => ({
        assetId: c.assetId,
        persisted: c.persisted,
        rightsOk: c.rightsOk,
        generationOk: c.generationOk,
      })
    );
    wholeSetAdopt = validateWholeSetAdopt({
      selection,
      candidates: adoptCandidates,
      currentRevisionId: facts.baseRevisionId,
      requireRevisionMatch: facts.hasContentPackage,
    });
  }

  const createFromThis =
    facts.lifecycle === 'delivered' || facts.lifecycle === 'adopted'
      ? buildCreateFromThisCommand({
          sourceWorkId: facts.workId,
          sourceRevisionId: facts.baseRevisionId,
          storeFactsSnapshotId: facts.storeFactsSnapshotId,
          productQuoteSnapshotId: facts.productQuoteSnapshotId,
        })
      : null;

  return {
    mode,
    modeSwitchable,
    primaryAction,
    libraryActions,
    candidates,
    workingSelection: selection,
    workingSlots: projectWorkingSelectionSlots(selection),
    wholeSetAdopt,
    adjustPrompt: {
      placeholder: '还想怎么改？',
      submitLabel: '提交调整',
      persistent: true,
      scopeActions: [
        { id: 'adjust_one', label: '调整这张' },
        { id: 'adjust_set', label: '调整整组' },
      ],
    },
    createFromThis,
    mobileDesktopGate: null,
    feedback: options?.lastFeedback ?? null,
  };
}

/** Re-export feedback helper for UI after local intents. */
export { imageRoleFeedback };
