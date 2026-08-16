/**
 * Static lens labels (D-081) — no publish lifecycle.
 *
 * This used to hold its own copy of the three words, with a comment saying the
 * browser must not depend on core internals. That constraint still holds and
 * is still satisfied: the words moved to @meiye/contracts, the seam both sides
 * already share, not to core. What ends is the mirroring — there were four of
 * these maps, and "mirror of core static seeds" was a claim no check enforced.
 */
import {
  CREATION_LENS_LABELS,
  creationLensIds,
  type CreationLensId,
} from '@meiye/contracts';

export const COMPOSER_LENS_LABELS: Record<CreationLensId, string> =
  CREATION_LENS_LABELS;

export const COMPOSER_LENS_OPTIONS = creationLensIds.map((id) => ({
  id,
  label: COMPOSER_LENS_LABELS[id],
}));

export const LENS_GROUP_LABEL = '创作类型';
/** Rendered beside the group label so 必选 reads before the first press, not after. */
export const LENS_GROUP_REQUIRED_SUFFIX = '（必选）';
export const LENS_REQUIRED_SUBMIT_HINT = '选择创作类型后继续';

export function lensLabel(id: CreationLensId): string {
  return COMPOSER_LENS_LABELS[id];
}
