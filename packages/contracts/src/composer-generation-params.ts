import { z } from 'zod';

import type { CreationMode } from './harness.js';

/**
 * P2-09 generation parameters exposed on Composer.
 *
 * beautyVoiceRole — beauty-context persona for note/copy generation.
 * thinkingLevel — free-mode control mapped onto existing model tier / thinking
 * params (no separate thinkingPointsCost switch).
 */

export const beautyVoiceRoleIds = [
  'beautician',
  'owner',
  'customer',
] as const;

export const beautyVoiceRoleSchema = z.enum(beautyVoiceRoleIds);

export type BeautyVoiceRole = z.infer<typeof beautyVoiceRoleSchema>;

/** Default option for surfaces that need an explicit beauty-role selection. */
export const DEFAULT_BEAUTY_VOICE_ROLE: BeautyVoiceRole = 'owner';

/**
 * Merchant-facing generation persona. Each role carries a tone string and a
 * roleBlock line for `xhsNoteGen` placeholders `{tone}` / `{roleBlock}`.
 */
export const BEAUTY_VOICE_ROLE_DEFINITIONS = {
  beautician: {
    id: 'beautician',
    label: '美容师口吻',
    tone: '专业干货',
    roleBlock: '创作角色：资深美容师，以专业护理经验分享，清楚说明步骤与注意事项',
  },
  owner: {
    id: 'owner',
    label: '店主口吻',
    tone: '温暖治愈',
    roleBlock: '创作角色：美业门店店主，真诚推荐本店服务，引导到店预约',
  },
  customer: {
    id: 'customer',
    label: '顾客口吻',
    tone: '闺蜜聊天',
    roleBlock: '创作角色：到店体验顾客，真实分享使用感受，保持可核对的事实边界',
  },
} as const satisfies Record<
  BeautyVoiceRole,
  {
    id: BeautyVoiceRole;
    label: string;
    tone: string;
    roleBlock: string;
  }
>;

export const thinkingLevelIds = ['standard', 'deep'] as const;

export const thinkingLevelSchema = z.enum(thinkingLevelIds);

export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

/** Free-mode default; customized always uses this and never exposes the control. */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'standard';

/**
 * Existing model-route quality profile vocabulary (route-contracts /
 * supply-registry). Deep thinking maps onto these tiers rather than inventing
 * a parallel billing switch.
 */
export type ModelRouteProfile = 'balanced' | 'quality';

export type ThinkingProviderOptions = {
  /** Mapped route profile for auto-style selection consumers. */
  routeProfile: ModelRouteProfile;
  /**
   * Provider thinking mirror (DeepSeek / Doubao-class). When the model does not
   * support thinking, callers may ignore these fields.
   */
  thinking: { type: 'enabled' | 'disabled' };
  reasoningEffort?: 'high';
};

/**
 * Map a merchant thinking level onto existing model-tier / thinking params.
 *
 * - standard → quality profile (aligned with the global auto default); disable
 *   thinking when the model supports it
 * - deep → quality profile; enable thinking + high reasoning effort on top
 *
 * No separate thinkingPointsCost / entitlement bucket is introduced.
 * R-2: standard must not silently demote XHS notes from quality → balanced.
 */
export function mapThinkingLevelToModelOptions(
  level: ThinkingLevel,
): ThinkingProviderOptions {
  if (level === 'deep') {
    return {
      routeProfile: 'quality',
      thinking: { type: 'enabled' },
      reasoningEffort: 'high',
    };
  }
  return {
    routeProfile: 'quality',
    thinking: { type: 'disabled' },
  };
}

export function resolveBeautyVoiceInjection(role: BeautyVoiceRole): {
  tone: string;
  roleBlock: string;
  label: string;
} {
  const definition = BEAUTY_VOICE_ROLE_DEFINITIONS[role];
  return {
    tone: definition.tone,
    roleBlock: definition.roleBlock,
    label: definition.label,
  };
}

/**
 * C5 visibility: customized injects defaults without exposing deep-thinking;
 * free creation surfaces both selectors for explicit choice.
 */
export function generationParamsVisibility(creationMode: CreationMode): {
  beautyVoiceRole: 'default_inject' | 'explicit';
  thinkingLevel: 'hidden' | 'visible';
} {
  if (creationMode === 'free') {
    return {
      beautyVoiceRole: 'explicit',
      thinkingLevel: 'visible',
    };
  }
  return {
    beautyVoiceRole: 'default_inject',
    thinkingLevel: 'hidden',
  };
}

/**
 * Resolve what the submission should carry given creation mode + UI state.
 *
 * - customized: keep MarketingIdentity as the voice, ignore hidden free-mode
 *   state, and pin standard thinking
 * - free: pass merchant selection; unselected beauty role stays undefined so
 *   MarketingIdentity remains the default voice (selector = explicit override)
 */
export function resolveComposerGenerationParams(input: {
  creationMode: CreationMode;
  beautyVoiceRole?: BeautyVoiceRole | null;
  thinkingLevel?: ThinkingLevel | null;
}): {
  beautyVoiceRole?: BeautyVoiceRole;
  thinkingLevel: ThinkingLevel;
} {
  const visibility = generationParamsVisibility(input.creationMode);
  if (visibility.beautyVoiceRole === 'default_inject') {
    return {
      thinkingLevel: DEFAULT_THINKING_LEVEL,
    };
  }
  return {
    ...(input.beautyVoiceRole
      ? { beautyVoiceRole: input.beautyVoiceRole }
      : {}),
    thinkingLevel: input.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
  };
}

export const composerGenerationParamsSchema = z
  .object({
    beautyVoiceRole: beautyVoiceRoleSchema.optional(),
    thinkingLevel: thinkingLevelSchema.optional(),
  })
  .strict();

export type ComposerGenerationParams = z.infer<
  typeof composerGenerationParamsSchema
>;
