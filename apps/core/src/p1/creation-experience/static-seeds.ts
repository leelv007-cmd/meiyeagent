/**
 * Static Creation Experience seeds (D-098 C3).
 *
 * Lens = frozen enum projection (no publish lifecycle).
 * Standalone CreativeToolEntry seeds retired (D-177 / #419).
 * First-ship Recipe + Surface seeds live in `launch-seeds.ts` (A2 / #89).
 */

import type { CreationLensSeed } from '@meiye/contracts';
import { CREATION_LENS_LABELS, creationLensIds } from '@meiye/contracts';

const LENS_LABELS = CREATION_LENS_LABELS;

/** Static lens enum seeds — three user-facing creation lenses (D-081). */
export const CREATION_LENS_SEEDS: readonly CreationLensSeed[] =
  creationLensIds.map((id) => ({
    id,
    label: LENS_LABELS[id],
  }));

export function listCreationLensSeeds(): CreationLensSeed[] {
  return CREATION_LENS_SEEDS.map((seed) => ({ ...seed }));
}
