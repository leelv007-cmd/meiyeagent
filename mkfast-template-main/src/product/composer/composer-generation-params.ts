/**
 * P2-09 Composer generation params — visibility, defaults, and injection.
 *
 * Pure module (no React). UI mounts the panel; submission resolves params
 * through `resolveComposerGenerationParams` before the body is posted.
 */

import {
  BEAUTY_VOICE_ROLE_DEFINITIONS,
  DEFAULT_BEAUTY_VOICE_ROLE,
  DEFAULT_THINKING_LEVEL,
  generationParamsVisibility,
  resolveComposerGenerationParams,
  type BeautyVoiceRole,
  type CreationMode,
  type ThinkingLevel,
} from '@meiye/contracts';

export type ComposerGenerationParamsState = {
  beautyVoiceRole: BeautyVoiceRole | null;
  thinkingLevel: ThinkingLevel;
};

export const BEAUTY_VOICE_ROLE_OPTIONS = (
  Object.values(BEAUTY_VOICE_ROLE_DEFINITIONS) as Array<
    (typeof BEAUTY_VOICE_ROLE_DEFINITIONS)[BeautyVoiceRole]
  >
).map((definition) => ({
  id: definition.id,
  label: definition.label,
}));

export const THINKING_LEVEL_OPTIONS: ReadonlyArray<{
  id: ThinkingLevel;
  label: string;
  description: string;
}> = [
  {
    id: 'standard',
    label: '标准',
    description: '常规生成，对应均衡档位',
  },
  {
    id: 'deep',
    label: '深度思考',
    description: '更充分推理，对应高质量档位',
  },
];

export function initialGenerationParamsState(): ComposerGenerationParamsState {
  return {
    beautyVoiceRole: null,
    thinkingLevel: DEFAULT_THINKING_LEVEL,
  };
}

/** Whether free-mode expand should mount the thinking control. */
export function shouldShowThinkingLevel(creationMode: CreationMode): boolean {
  return generationParamsVisibility(creationMode).thinkingLevel === 'visible';
}

/** Whether free-mode should mount the explicit beauty voice selector. */
export function shouldShowBeautyVoiceRole(creationMode: CreationMode): boolean {
  return (
    generationParamsVisibility(creationMode).beautyVoiceRole === 'explicit'
  );
}

/** P2-09 belongs to the XHS image-text note route, not every Composer lens. */
export function isComposerGenerationParamsSupported(input: {
  deliverableKind: string | null;
  lensId: string | null;
  platform: string | null;
}): boolean {
  return (
    input.lensId === 'image_text' &&
    input.deliverableKind === 'note' &&
    input.platform === 'xiaohongshu'
  );
}

/**
 * Build the optional generation-param fields for the Composer submission body.
 * Customized always injects owner + standard; free only sends an explicit role.
 */
export function buildSubmissionGenerationParams(input: {
  creationMode: CreationMode;
  state: ComposerGenerationParamsState;
}): {
  beautyVoiceRole?: BeautyVoiceRole;
  thinkingLevel: ThinkingLevel;
} {
  return resolveComposerGenerationParams({
    creationMode: input.creationMode,
    beautyVoiceRole: input.state.beautyVoiceRole,
    thinkingLevel: input.state.thinkingLevel,
  });
}

export {
  DEFAULT_BEAUTY_VOICE_ROLE,
  DEFAULT_THINKING_LEVEL,
  generationParamsVisibility,
  resolveComposerGenerationParams,
};
