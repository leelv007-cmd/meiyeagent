import type { CreativeGroundingRequirement } from '@/product/creative-brief-editor';

/**
 * Which grounding gap the Composer names when a submission cannot ground.
 *
 * `qualification` exists because a regulated store carries a gap the five-step
 * store intake cannot close — its admission record lives on the store page, so
 * the merchant has to be sent there by name rather than left on a submit that
 * keeps failing (W01 post-merge P0-1).
 */
export type ComposerGroundingBlocker = 'qualification' | 'source' | 'store';

export function groundingBlockerFromMissing(
  missing: readonly CreativeGroundingRequirement[]
): ComposerGroundingBlocker | null {
  if (missing.includes('real_authorized_asset')) return 'source';
  if (missing.includes('confirmed_qualification')) return 'qualification';
  return null;
}
