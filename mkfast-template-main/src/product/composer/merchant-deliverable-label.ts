/**
 * Single merchant-facing label for Brief / confirm-card deliverable kinds.
 * Unknown values stay as-is so a newer Core enum cannot leak a blank cell.
 */
import { composerDeliverableKindIds } from '@meiye/contracts';

import {
  composer_deliverable_copy,
  composer_deliverable_image,
  composer_deliverable_image_text,
  composer_deliverable_video,
} from '@/locale/paraglide/messages';

const COPY_KINDS = new Set(['copy', 'text', 'copy_document']);
const VIDEO_KINDS = new Set(['video', 'video_package']);
const IMAGE_TEXT_KINDS = new Set(['note', 'image_text', 'image_text_package']);
const IMAGE_KINDS = new Set(['image', 'image_set', 'poster', 'media']);

/** Closed set the mapper covers — Core kinds plus the aliases Brief still leaks. */
export const MERCHANT_DELIVERABLE_KIND_IDS = [
  ...composerDeliverableKindIds,
  'copy',
  'image',
  'image_text',
  'media',
  'text',
  'video',
] as const;

export type MerchantDeliverableKindId =
  (typeof MERCHANT_DELIVERABLE_KIND_IDS)[number];

export function merchantDeliverableLabel(
  kind: string,
  lensId?: string | null
): string {
  const key = kind.trim();
  if (!key) return kind;
  const normalized = key.toLowerCase();
  if (COPY_KINDS.has(normalized)) return composer_deliverable_copy();
  if (VIDEO_KINDS.has(normalized)) return composer_deliverable_video();
  if (IMAGE_TEXT_KINDS.has(normalized)) {
    return composer_deliverable_image_text();
  }
  if (IMAGE_KINDS.has(normalized)) {
    return lensId === 'image_text'
      ? composer_deliverable_image_text()
      : composer_deliverable_image();
  }
  return kind;
}
