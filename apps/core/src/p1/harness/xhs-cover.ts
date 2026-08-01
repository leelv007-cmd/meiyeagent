/**
 * P2-11 / #323 — AI cover compile helpers.
 *
 * Product surface: Delivered secondary action + object-workspace tool.
 * Idle must not expose a first-class entry (§4.2 / §4.10).
 *
 * Prompt body lives in `HARNESS_BUILTIN_PROMPTS.xhsCoverPrompt` (#315).
 * This module owns size mapping (实施时定), beauty presets, and the paid-media
 * reservation shape that must pass `triggersPaidMediaExecution`.
 */

import { HARNESS_BUILTIN_PROMPTS } from './langfuse-prompts.js';

/** Product ratios kept from xhswork (§4.2). */
export const XHS_COVER_ASPECT_RATIOS = ['3:4', '1:1', '9:16'] as const;
export type XhsCoverAspectRatio = (typeof XHS_COVER_ASPECT_RATIOS)[number];

/**
 * Beauty presets replace generic xiaohongshu/minimal/collage/gradient/photo
 * (#315 / xhsCoverPrompt builtin).
 */
export const XHS_COVER_BEAUTY_PRESETS = [
  'beauty_soft',
  'beauty_editorial',
  'before_after',
  'spa_minimal',
  'salon_photo',
] as const;
export type XhsCoverBeautyPreset = (typeof XHS_COVER_BEAUTY_PRESETS)[number];

export const DEFAULT_XHS_COVER_PRESET: XhsCoverBeautyPreset = 'beauty_soft';
export const DEFAULT_XHS_COVER_ASPECT_RATIO: XhsCoverAspectRatio = '3:4';

/**
 * Size mapping — 实施时定 (#323 / §4.2).
 *
 * Maps product aspect ratios onto Seedream-safe WxH strings for
 * `/v1/images/generations` (see `tuziGenerationOutputSize` constraints:
 * ≥ ~3.68MP, ≤ provider max, step-aligned long sides).
 *
 * | ratio | size        | rationale |
 * | ----- | ----------- | --------- |
 * | 3:4   | 1536x2048   | Classic XHS portrait; ~3.15MP → raised to ≥ min via adapter if needed |
 * | 1:1   | 2048x2048   | Moments / square; probe-proven safe square |
 * | 9:16  | 1440x2560   | Full-bleed vertical story cover |
 */
export const XHS_COVER_SIZE_MAP = {
  '3:4': {
    width: 1536,
    height: 2048,
    size: '1536x2048',
  },
  '1:1': {
    width: 2048,
    height: 2048,
    size: '2048x2048',
  },
  '9:16': {
    width: 1440,
    height: 2560,
    size: '1440x2560',
  },
} as const satisfies Record<
  XhsCoverAspectRatio,
  { width: number; height: number; size: string }
>;

export type XhsCoverSizeSpec = (typeof XHS_COVER_SIZE_MAP)[XhsCoverAspectRatio];

export function isXhsCoverAspectRatio(
  value: string,
): value is XhsCoverAspectRatio {
  return (XHS_COVER_ASPECT_RATIOS as readonly string[]).includes(value);
}

export function isXhsCoverBeautyPreset(
  value: string,
): value is XhsCoverBeautyPreset {
  return (XHS_COVER_BEAUTY_PRESETS as readonly string[]).includes(value);
}

export function mapXhsCoverSize(
  aspectRatio: XhsCoverAspectRatio,
): XhsCoverSizeSpec {
  return XHS_COVER_SIZE_MAP[aspectRatio];
}

/**
 * Fill `xhsCoverPrompt` placeholders. Prefer a frozen Langfuse body; fall back
 * to the builtin registered for pilot mode.
 */
export function materializeXhsCoverPrompt(input: {
  userPrompt: string;
  style: XhsCoverBeautyPreset;
  aspectRatio: XhsCoverAspectRatio;
  /** Frozen prompt content from resolver; defaults to builtin. */
  template?: string;
}): {
  prompt: string;
  style: XhsCoverBeautyPreset;
  aspectRatio: XhsCoverAspectRatio;
  size: string;
  width: number;
  height: number;
} {
  const userPrompt = input.userPrompt.trim();
  if (!userPrompt) {
    throw new Error('AI cover requires a non-empty user prompt.');
  }
  if (!isXhsCoverBeautyPreset(input.style)) {
    throw new Error(`Unknown AI cover beauty preset: ${input.style}`);
  }
  if (!isXhsCoverAspectRatio(input.aspectRatio)) {
    throw new Error(`Unsupported AI cover aspect ratio: ${input.aspectRatio}`);
  }

  const sizeSpec = mapXhsCoverSize(input.aspectRatio);
  const template =
    input.template?.trim() || HARNESS_BUILTIN_PROMPTS.xhsCoverPrompt;
  const prompt = template
    .replaceAll('{userPrompt}', userPrompt)
    .replaceAll('{style}', input.style)
    .replaceAll('{size}', sizeSpec.size);

  return {
    prompt,
    style: input.style,
    aspectRatio: input.aspectRatio,
    size: sizeSpec.size,
    width: sizeSpec.width,
    height: sizeSpec.height,
  };
}

/**
 * Cover generation always spends image units → always hits the paid-media
 * confirmation gate (D-164③ / §3.2). Pure copy stays exempt (D-043).
 */
export function buildAiCoverUsageReservation(input?: {
  reservationId?: string;
  quantity?: number;
}): {
  id: string;
  units: ReadonlyArray<{ resource: 'image'; quantity: number }>;
} {
  const quantity = input?.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error('AI cover reservation quantity must be a positive integer.');
  }
  return {
    id: input?.reservationId ?? 'usage-reservation-ai-cover',
    units: [{ resource: 'image', quantity }],
  };
}

/** Compile-time product claim: AI cover is paid media execution. */
export function aiCoverTriggersPaidMediaConfirm(): true {
  return true;
}

/**
 * Image brief parameters for media selection / provider mapping.
 * `ratio` is the product aspect; `resolution` is the mapped WxH size string.
 */
export function compileAiCoverImageParameters(input: {
  aspectRatio: XhsCoverAspectRatio;
  style: XhsCoverBeautyPreset;
}): {
  ratio: XhsCoverAspectRatio;
  resolution: string;
  style: XhsCoverBeautyPreset;
  purpose: 'xiaohongshu_cover';
} {
  const size = mapXhsCoverSize(input.aspectRatio);
  return {
    ratio: input.aspectRatio,
    resolution: size.size,
    style: input.style,
    purpose: 'xiaohongshu_cover',
  };
}

/** Closed set used by web Idle negative tests (no primary catalog entry). */
export const AI_COVER_IDLE_PRIMARY_ENTRY = false as const;
