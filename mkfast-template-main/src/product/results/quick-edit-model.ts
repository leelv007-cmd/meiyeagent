/**
 * Quick edit front-end producer (W07 / S5).
 *
 * The 13-action QuickEditIntent contract and its server lifecycle have existed
 * since `marketing-package.ts`; what never existed was a browser that builds
 * one. This module is that producer: it turns a worksurface gesture — a
 * promotion shortcut the merchant just previewed, or 「做成海报」 — into the exact
 * intent `edit_content_package_version` accepts, frozen fact/rights refs and
 * all.
 *
 * Pure. The page owns the write; this module owns the shape of it.
 */

import {
  QUICK_EDIT_EXPORT_USE_BY_ACTION,
  QUICK_EDIT_TARGET_BY_ACTION,
  quickEditIntentSchema,
  type PublicContentPackage,
  type QuickEditAction,
  type QuickEditIntent,
} from '@meiye/contracts';

import {
  result_quick_edit_adopt,
  result_quick_edit_discard,
  result_quick_edit_export_appointment_card,
  result_quick_edit_export_heading,
  result_quick_edit_export_hint,
  result_quick_edit_export_image_set,
  result_quick_edit_export_poster,
  result_quick_edit_export_spoken_script,
  result_quick_edit_failed,
  result_quick_edit_pending,
  result_quick_edit_preview_after,
  result_quick_edit_preview_before,
  result_quick_edit_preview_heading,
} from '@/locale/paraglide/messages';

import type { SelectionRewriteAction } from './copy-image-text-worksurface-model';

/** Editable version fields a quick edit may rewrite. */
export type QuickEditChanges = {
  body: string;
  conversionHook: string;
  title: string;
};

/** What the worksurface hands the page when a quick edit is confirmed. */
export type QuickEditRequest = {
  action: QuickEditAction;
  instruction: string;
  changes: QuickEditChanges;
};

/**
 * The export-use first batch (W07). `wechat_moments_export` and
 * `offline_material_export` stay out of this row: 朋友圈 already owns a delivery
 * target of its own, and 线下物料 belongs with the offline material surface.
 */
export const QUICK_EDIT_EXPORT_USE_ACTIONS = [
  'poster',
  'image_set',
  'spoken_script',
  'appointment_card',
] as const satisfies readonly QuickEditAction[];

export type QuickEditExportUseAction =
  (typeof QUICK_EDIT_EXPORT_USE_ACTIONS)[number];

export function quickEditExportUseLabel(action: QuickEditExportUseAction) {
  switch (action) {
    case 'poster':
      return result_quick_edit_export_poster();
    case 'image_set':
      return result_quick_edit_export_image_set();
    case 'spoken_script':
      return result_quick_edit_export_spoken_script();
    case 'appointment_card':
      return result_quick_edit_export_appointment_card();
  }
}

export function quickEditText() {
  return {
    adopt: result_quick_edit_adopt(),
    discard: result_quick_edit_discard(),
    exportHeading: result_quick_edit_export_heading(),
    exportHint: result_quick_edit_export_hint(),
    failed: result_quick_edit_failed(),
    pending: result_quick_edit_pending(),
    previewAfter: result_quick_edit_preview_after(),
    previewBefore: result_quick_edit_preview_before(),
    previewHeading: result_quick_edit_preview_heading(),
  };
}

/**
 * Map a deterministic promotion chip onto its QuickEditIntent action.
 * Open-ended selection AI uses the model-backed Result adjustment boundary.
 */
export function quickEditActionForSelectionRewrite(
  action: SelectionRewriteAction
): QuickEditAction {
  switch (action) {
    case 'weaker_promo':
      return 'promotion_weaker';
    case 'stronger_cta':
      return 'promotion_stronger';
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/**
 * Build the intent for a quick edit against a live package.
 *
 * The frozen fact/rights refs are copied verbatim from the package: core
 * rejects the write (`CONTENT_PACKAGE_CONTEXT_REFS_CHANGED`) when they drift,
 * which is the whole point — a quick edit may change words, never evidence.
 */
export function buildQuickEditIntent(input: {
  action: QuickEditAction;
  baseVersionId: string;
  contentPackage: Pick<PublicContentPackage, 'marketing'>;
  instruction: string;
}): QuickEditIntent {
  const exportUse =
    input.action in QUICK_EDIT_EXPORT_USE_BY_ACTION
      ? QUICK_EDIT_EXPORT_USE_BY_ACTION[
          input.action as keyof typeof QUICK_EDIT_EXPORT_USE_BY_ACTION
        ]
      : undefined;
  return quickEditIntentSchema.parse({
    action: input.action,
    baseVersionId: input.baseVersionId,
    ...(exportUse ? { exportUse } : {}),
    instruction: input.instruction,
    preservedFactRefs: [...(input.contentPackage.marketing?.factRefs ?? [])],
    preservedRightsRefs: [
      ...(input.contentPackage.marketing?.rightsRefs ?? []),
    ],
    scope: 'current_task',
    target: QUICK_EDIT_TARGET_BY_ACTION[input.action],
  });
}
