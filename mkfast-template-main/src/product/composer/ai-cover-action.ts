/**
 * P2-11 / #323 — AI cover product affordances (Delivered secondary + workspace tool).
 *
 * Browser mirror of core `xhs-cover` size/preset enums — no core import.
 * Idle must not expose a first-class primary entry (§4.2 / §4.10).
 */

/** Product ratios (§4.2). */
export const AI_COVER_ASPECT_RATIOS = ['3:4', '1:1', '9:16'] as const;
export type AiCoverAspectRatio = (typeof AI_COVER_ASPECT_RATIOS)[number];

/** Beauty presets (#315 / §4.2). */
export const AI_COVER_BEAUTY_PRESETS = [
  'beauty_soft',
  'beauty_editorial',
  'before_after',
  'spa_minimal',
  'salon_photo',
] as const;
export type AiCoverBeautyPreset = (typeof AI_COVER_BEAUTY_PRESETS)[number];

export const DEFAULT_AI_COVER_ASPECT_RATIO: AiCoverAspectRatio = '3:4';
export const DEFAULT_AI_COVER_PRESET: AiCoverBeautyPreset = 'beauty_soft';

/**
 * Size mapping — 实施时定 (#323). Keep in lockstep with
 * `apps/core/src/p1/harness/xhs-cover.ts` `XHS_COVER_SIZE_MAP`.
 */
export const AI_COVER_SIZE_MAP = {
  '3:4': '1536x2048',
  '1:1': '2048x2048',
  '9:16': '1152x2048',
} as const satisfies Record<AiCoverAspectRatio, string>;

export const AI_COVER_PRESET_LABELS: Record<AiCoverBeautyPreset, string> = {
  beauty_soft: '美业柔光',
  beauty_editorial: '杂志质感',
  before_after: '前后对比',
  spa_minimal: 'SPA 极简',
  salon_photo: '门店实拍感',
};

export const AI_COVER_RATIO_LABELS: Record<AiCoverAspectRatio, string> = {
  '3:4': '3:4 竖版',
  '1:1': '1:1 方图',
  '9:16': '9:16 全屏',
};

/** Spec: Idle 不单独一级入口. */
export const AI_COVER_IDLE_PRIMARY_ENTRY = false as const;

export type AiCoverActionSeed = {
  id: 'ai_cover';
  /** Chip label on Delivered / object workspace. */
  label: string;
  /** Prefill Composer intent (merchant language). */
  intent: string;
  aspectRatio: AiCoverAspectRatio;
  style: AiCoverBeautyPreset;
  /** Mapped provider size string (实施时定). */
  size: string;
};

export type AiCoverSurface =
  | 'delivered_secondary'
  | 'object_workspace_tool'
  | 'idle_primary';

/**
 * Whether AI cover may hang on this surface.
 * Idle primary is always false; Delivered + object workspace are true for
 * image_text (note/图文). Copy-only stays off (no media cover).
 */
export function aiCoverAllowedOnSurface(input: {
  surface: AiCoverSurface;
  lensId?: 'copy' | 'image_text' | 'video' | null;
}): boolean {
  if (input.surface === 'idle_primary') return false;
  if (AI_COVER_IDLE_PRIMARY_ENTRY) return false;
  // Video cover is out of this ticket's semantic lock (image cover path).
  return input.lensId === 'image_text';
}

/** Build a prefill seed for the selected ratio + beauty preset. */
export function buildAiCoverActionSeed(input?: {
  aspectRatio?: AiCoverAspectRatio;
  style?: AiCoverBeautyPreset;
  topicHint?: string;
}): AiCoverActionSeed {
  const aspectRatio = input?.aspectRatio ?? DEFAULT_AI_COVER_ASPECT_RATIO;
  const style = input?.style ?? DEFAULT_AI_COVER_PRESET;
  const size = AI_COVER_SIZE_MAP[aspectRatio];
  const topic = input?.topicHint?.trim() || '这一版成品';
  const presetLabel = AI_COVER_PRESET_LABELS[style];
  const ratioLabel = AI_COVER_RATIO_LABELS[aspectRatio];
  return {
    id: 'ai_cover',
    label: '生成 AI 封面',
    intent: `为${topic}生成一张小红书 AI 封面，风格用${presetLabel}，比例${ratioLabel}（${size}）`,
    aspectRatio,
    style,
    size,
  };
}

/** All three ratios as selectable seeds (acceptance: 三比例可选). */
export function listAiCoverRatioOptions(input?: {
  style?: AiCoverBeautyPreset;
  topicHint?: string;
}): readonly AiCoverActionSeed[] {
  const style = input?.style ?? DEFAULT_AI_COVER_PRESET;
  return AI_COVER_ASPECT_RATIOS.map((aspectRatio) =>
    buildAiCoverActionSeed({
      aspectRatio,
      style,
      topicHint: input?.topicHint,
    })
  );
}

/** Object-workspace tool chip projection. */
export function projectAiCoverWorkspaceTool(input: {
  lensId?: 'copy' | 'image_text' | 'video' | null;
}): { id: 'ai_cover'; label: string; enabled: boolean } | null {
  if (
    !aiCoverAllowedOnSurface({
      surface: 'object_workspace_tool',
      lensId: input.lensId,
    })
  ) {
    return null;
  }
  return {
    id: 'ai_cover',
    label: '生成 AI 封面',
    enabled: true,
  };
}

/** Signed AI cover payload that freezes with the submission. */
export type SignedAiCover = {
  aspectRatio: AiCoverAspectRatio;
  style: AiCoverBeautyPreset;
  size: string;
};

/**
 * Resolve the signed AI cover for submission. Requires free mode, generate
 * operation, promotion_poster recipe, poster deliverable, xiaohongshu, and a
 * matching aspect ratio. Any mismatch returns undefined (submission still
 * allowed as plain intent — surface a mismatch notice instead of failing).
 */
export function resolveSignedAiCover(input: {
  activeAiCover: AiCoverActionSeed | null | undefined;
  creationMode: 'free' | 'customized' | string;
  imageOperation?: string | null;
  recipeId?: string | null;
  deliverableKind?: string | null;
  platform?: string | null;
  aspectRatio?: string | null;
}): SignedAiCover | undefined {
  const active = input.activeAiCover;
  if (!active) return undefined;
  if (input.creationMode !== 'free') return undefined;
  if (input.imageOperation !== 'image.generate') return undefined;
  if (input.recipeId !== 'recipe.promotion_poster') return undefined;
  if (input.deliverableKind !== 'poster') return undefined;
  if (input.platform !== 'xiaohongshu') return undefined;
  if (input.aspectRatio !== active.aspectRatio) return undefined;
  return {
    aspectRatio: active.aspectRatio,
    style: active.style,
    size: active.size,
  };
}

/**
 * When the merchant still has an AI cover seed but the current form no longer
 * matches its signature (ratio / recipe / platform / operation), show a notice
 * so the silent drop is visible. Submission remains allowed.
 */
export function shouldShowAiCoverSignatureMismatchNotice(input: {
  activeAiCover: AiCoverActionSeed | null | undefined;
  signedAiCover: SignedAiCover | undefined;
}): boolean {
  return Boolean(input.activeAiCover) && input.signedAiCover === undefined;
}
