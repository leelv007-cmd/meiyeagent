/**
 * Static lens labels (D-081). Mirror of core static seeds — no publish lifecycle.
 * Frontend keeps its own copy so the browser never depends on core internals.
 */
import { creationLensIds, type CreationLensId } from '@meiye/contracts';

export const COMPOSER_LENS_LABELS: Record<CreationLensId, string> = {
  copy: '文案',
  image_text: '图文',
  video: '视频',
};

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
