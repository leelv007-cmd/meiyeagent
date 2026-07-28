/**
 * 确认卡超时放行 — the D-116 timeout contract as a pure model (T31 / #225).
 *
 * D-116: 「意图确认卡＝建议性补充＋默认值＋超时自动继续 … 引导永不变成新阻断」,
 * Core owns the durable countdown and the terminal transition. The browser may
 * display Core's projected timeout, but it never posts a competing timed-out
 * decision. `unattended=hold` carries no countdown at all.
 *
 * What the default *is* is not invented here. `decision.state === 'ignored'`
 * already means「不补充也继续」in the harness (workflow-core.ts routes it to
 * freeRouteDeclaration), and the merchant's own 「这次先跳过」 posts exactly that.
 * Core records the timeout through the durable decision seam and leaves PENDING
 * for real. The front end never fakes continuation — that would be the second
 * state truth ADR-0014 forbids.
 */

/** What 「继续」 and the expiring countdown both mean. */
export const COMPOSER_QUESTION_DEFAULT_LABEL = '不补充，本次按通用模式生成';

/** Why an auto-release is being withheld (D-116 safety edge ②). */
export type ComposerQuestionHold = 'quota' | 'external_effect';

/** How the card stopped being open, once it has. */
export type ComposerQuestionSettlement =
  | 'answered'
  | 'skipped'
  | 'continued_elsewhere'
  | 'late_answered';

export function composerQuestionHold(input: {
  quotaBlocked: boolean;
  /**
   * True when this run would publish or hand off externally. v1's composer only
   * ever signs `export` / `assisted_handoff`, so this is normally false; the
   * edge exists because D-112 owns the boundary, not this card.
   */
  externalEffect: boolean;
}): ComposerQuestionHold | null {
  if (input.quotaBlocked) return 'quota';
  if (input.externalEffect) return 'external_effect';
  return null;
}

const HOLD_NOTICES: Record<ComposerQuestionHold, string> = {
  quota: '这次的额度不够自动继续了，需要你确认一下再往下走。',
  external_effect: '这次会对外发布，需要你确认一下再往下走。',
};
const UNATTENDED_HOLD_NOTICE = '需要你选择后继续，这张卡不会自动放行。';
const RELEASED_RESERVATION_NOTICE =
  '之前占用的额度已经放回，现在回答会重新排队占用额度。';
const RELEASED_LATE_ANSWER_NOTICE =
  '之前占用的额度已经放回。你的回答已保存，但新版本还没开始；请再次提交，系统会重新排队占用额度。';

const SETTLEMENT_NOTICES: Record<ComposerQuestionSettlement, string> = {
  answered: '已按你的回答继续',
  skipped: '已跳过，本次按通用模式生成',
  continued_elsewhere: '系统已先一步处理，正在同步最新状态',
  late_answered: '已收到补充，正在生成精修版本',
};

export type ComposerQuestionResolutionSource =
  | 'core_timeout'
  | 'core_hold_expired'
  | 'late_answer'
  | null;

const RESOLUTION_NOTICES: Record<
  Exclude<ComposerQuestionResolutionSource, null>,
  string
> = {
  core_timeout: '系统已按通用模式继续，你仍可回答并生成精修版本。',
  core_hold_expired: '本次任务已取消，额度已退回。你仍可回答并生成新版本。',
  late_answer: '你的回答已保存；如果新版本还没开始，可以再次提交重试。',
};

/**
 * The decision never reached the ledger. The card must say so rather than keep
 * a settled notice up: claiming「已按…继续」when nothing was posted is the one
 * lie this surface can tell, and the run is genuinely still waiting.
 */
export const COMPOSER_QUESTION_FAILURE_NOTICE = '刚才没提交成功，请再试一次';

export type ComposerQuestionCardView = {
  /** Whether the countdown may still reach zero and release the card. */
  autoContinueEnabled: boolean;
  /** Countdown copy, or null when there is no live countdown to show. */
  countdownNotice: string | null;
  /** Why auto-release is withheld, in merchant language. */
  holdNotice: string | null;
  /** Terminal line once the card has settled, in merchant language. */
  settledNotice: string | null;
  /** Set when the last attempt failed to reach the ledger. */
  failureNotice: string | null;
  /** The value 「继续」 and a timeout both apply. */
  defaultLabel: string;
};

export function projectComposerQuestionCard(input: {
  remainingSeconds: number;
  hold: ComposerQuestionHold | null;
  unattended: 'continue' | 'hold';
  timeoutSeconds: number | null;
  reservationReleased?: boolean;
  resolutionSource: ComposerQuestionResolutionSource;
  settlement: ComposerQuestionSettlement | null;
  /** The last submit attempt was rejected and rolled back. */
  failed?: boolean;
}): ComposerQuestionCardView {
  const autoContinueEnabled =
    input.unattended === 'continue' &&
    input.timeoutSeconds !== null &&
    !input.hold &&
    !input.resolutionSource &&
    input.settlement === null;
  return {
    autoContinueEnabled,
    countdownNotice: autoContinueEnabled
      ? `${Math.max(0, input.remainingSeconds)} 秒后按默认继续，不用管也不会卡住`
      : null,
    holdNotice:
      input.reservationReleased && !input.resolutionSource
        ? RELEASED_RESERVATION_NOTICE
        : input.hold
          ? HOLD_NOTICES[input.hold]
          : input.unattended === 'hold' && !input.resolutionSource
            ? UNATTENDED_HOLD_NOTICE
            : null,
    settledNotice: input.settlement
      ? SETTLEMENT_NOTICES[input.settlement]
      : input.resolutionSource === 'late_answer' && input.reservationReleased
        ? RELEASED_LATE_ANSWER_NOTICE
        : input.resolutionSource
          ? RESOLUTION_NOTICES[input.resolutionSource]
          : null,
    failureNotice: input.failed ? COMPOSER_QUESTION_FAILURE_NOTICE : null,
    defaultLabel: COMPOSER_QUESTION_DEFAULT_LABEL,
  };
}
