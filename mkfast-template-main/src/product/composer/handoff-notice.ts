/**
 * What a suggestion chip just did to the Composer, in one sentence (D-C1).
 *
 * A chip either fills an empty box or attaches a 配方/创作类型 to a box the
 * merchant already wrote in. Both are visible changes to the thing they are
 * about to pay for, so both say what happened and both can be taken back.
 */

import type {
  RecommendationHandoff,
  RecommendationHandoffTextOutcome,
} from '@/product/recommendation-handoff';

import { lensLabel } from './lens-labels';

const CHIP_LABELS: Record<
  NonNullable<RecommendationHandoff['recipeChipId']>,
  string
> = {
  xhs_image_text: '小红书图文',
  viral_adapt: '爆款复刻',
};

export const COMPOSER_HANDOFF_UNDO_LABEL = '撤销';

export type ComposerHandoffNoticeView = {
  message: string;
  undoLabel: string;
};

/** Merchant word for what the chip attached; null when it has no name to give. */
export function handoffChipLabel(
  handoff: RecommendationHandoff
): string | null {
  if (handoff.recipeChipId) return CHIP_LABELS[handoff.recipeChipId];
  return handoff.outputHint ? lensLabel(handoff.outputHint) : null;
}

export function projectComposerHandoffNotice(input: {
  handoff: RecommendationHandoff;
  text: RecommendationHandoffTextOutcome;
}): ComposerHandoffNoticeView {
  const label = handoffChipLabel(input.handoff);
  const message =
    input.text === 'prefilled'
      ? label
        ? `已按「${label}」写好一句开头，你可以直接改。`
        : '已把这条建议写进输入框，你可以直接改。'
      : label
        ? `已挂上「${label}」，你写的那句一个字没动。`
        : '已按这条建议配好这次创作，你写的那句一个字没动。';
  return { message, undoLabel: COMPOSER_HANDOFF_UNDO_LABEL };
}
