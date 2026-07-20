/**
 * Video submit confirm zone (cons-global P1 assigned to WT-C / #95).
 *
 * Shown at submit for video lens. Includes "按生成成片 N 秒计费" from
 * ProductQuoteSnapshot.quotedSeconds (D-088).
 */

import type { CreationLensId } from '@meiye/contracts';
import type { ComposerQuoteView } from './quote-wiring';
import { LENS_REQUIRED_SUBMIT_HINT } from './lens-labels';

export type VideoConfirmZone = {
  visible: boolean;
  title: string;
  billingNote: string | null;
  amountLabel: string | null;
  quotedSeconds: number | null;
  targetSeconds: number | null;
  catalogModelId: string | null;
  requiresExplicitConfirm: boolean;
};

export type SubmitGateResult =
  | {
      allowed: false;
      reason: 'lens_unselected' | 'video_confirm_required' | 'quote_mismatch';
      message: string;
      focusTarget: 'lens_group' | 'video_confirm' | 'quote';
    }
  | {
      allowed: true;
      videoConfirm: VideoConfirmZone | null;
    };

/**
 * Build the video confirm zone model from lens + quote view.
 * Non-video lenses return a hidden zone.
 */
export function buildVideoConfirmZone(input: {
  lensId: CreationLensId | null;
  quote: ComposerQuoteView | null;
  amountFormatter?: (amount: number) => string;
}): VideoConfirmZone {
  if (input.lensId !== 'video') {
    return {
      visible: false,
      title: '',
      billingNote: null,
      amountLabel: null,
      quotedSeconds: null,
      targetSeconds: null,
      catalogModelId: null,
      requiresExplicitConfirm: false,
    };
  }

  const quote = input.quote;
  const quotedSeconds = quote?.quotedSeconds ?? null;
  const billingNote =
    quote?.billingNote ??
    (quotedSeconds != null ? `按生成成片 ${quotedSeconds} 秒计费` : null);
  const format =
    input.amountFormatter ?? ((n: number) => `${n}`);

  return {
    visible: true,
    title: '确认视频生成',
    billingNote,
    amountLabel:
      quote != null ? format(quote.amount) : null,
    quotedSeconds,
    targetSeconds: quote?.targetSeconds ?? null,
    catalogModelId: quote?.catalogModelId ?? null,
    requiresExplicitConfirm: true,
  };
}

/**
 * Submit gate for the Composer lens state machine.
 * - unselected → blocked with "选择创作类型后继续"
 * - video without confirm → blocked
 * - otherwise allowed
 */
export function evaluateSubmitGate(input: {
  lensId: CreationLensId | null;
  videoConfirmAccepted?: boolean;
  quote?: ComposerQuoteView | null;
  confirmPriceMatchesCharge?: boolean;
}): SubmitGateResult {
  if (!input.lensId) {
    return {
      allowed: false,
      reason: 'lens_unselected',
      message: LENS_REQUIRED_SUBMIT_HINT,
      focusTarget: 'lens_group',
    };
  }

  if (input.confirmPriceMatchesCharge === false) {
    return {
      allowed: false,
      reason: 'quote_mismatch',
      message: '确认价与扣费价不一致，请重新报价',
      focusTarget: 'quote',
    };
  }

  const videoConfirm = buildVideoConfirmZone({
    lensId: input.lensId,
    quote: input.quote ?? null,
  });

  if (
    videoConfirm.requiresExplicitConfirm &&
    input.videoConfirmAccepted !== true
  ) {
    return {
      allowed: false,
      reason: 'video_confirm_required',
      message: videoConfirm.billingNote
        ? `请确认视频生成（${videoConfirm.billingNote}）`
        : '请确认视频生成',
      focusTarget: 'video_confirm',
    };
  }

  return { allowed: true, videoConfirm: videoConfirm.visible ? videoConfirm : null };
}
