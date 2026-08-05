import type { ModelExecutionRuntimeMode } from '../p1/model-supply/adapters.js';
import {
  configuredNotePlanEnhancementJudgeResolver,
  type NotePlanEnhancementJudgeResolver,
  unconfiguredNotePlanEnhancementJudgeResolver,
} from '../p1/harness/note-plan-structured-port.js';

/**
 * Production selection table for note enhancement judge (xcheck B2 / #331).
 *
 * Explicit per-mode mapping — no default branch so new enum members fail at compile time.
 * - disabled / recorded / fixture → unconfigured (honest signal, delivery continues)
 * - gateway / direct → configured (quality self-correction evaluation available)
 */
export const NOTE_ENHANCEMENT_JUDGE_BY_MODE: Record<
  ModelExecutionRuntimeMode,
  NotePlanEnhancementJudgeResolver
> = {
  disabled: unconfiguredNotePlanEnhancementJudgeResolver,
  recorded: unconfiguredNotePlanEnhancementJudgeResolver,
  fixture: unconfiguredNotePlanEnhancementJudgeResolver,
  gateway: configuredNotePlanEnhancementJudgeResolver,
  direct: configuredNotePlanEnhancementJudgeResolver,
};

export function noteEnhancementJudgeResolverForMode(
  mode: ModelExecutionRuntimeMode
): NotePlanEnhancementJudgeResolver {
  return NOTE_ENHANCEMENT_JUDGE_BY_MODE[mode];
}
