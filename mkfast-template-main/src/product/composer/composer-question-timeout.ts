/**
 * 确认卡超时放行 — the D-116 timeout contract as a pure model (T31 / #225).
 *
 * D-116: 「意图确认卡＝建议性补充＋默认值＋超时自动继续 … 引导永不变成新阻断」,
 * with two safety edges: ① the countdown pauses the moment the merchant starts
 * editing, ② it never auto-continues when the run would exceed available quota
 * or carry an external side effect — those fall back to the D-112 hard gates.
 *
 * What the default *is* is not invented here. `decision.state === 'ignored'`
 * already means「不补充也继续」in the harness (workflow-core.ts routes it to
 * freeRouteDeclaration), and the merchant's own 「这次先跳过」 posts exactly that.
 * So auto-continue posts a real structured decision through the same seam: the
 * ledger records it, DBOS leaves PENDING for real. The front end never fakes
 * continuation — that would be the second state truth ADR-0014 forbids.
 */

/**
 * The operating parameter, D-116: 「超时秒数为运营参数（绘文实测 30s 倒计时为参考
 * 基线），不硬编码」. Single exit on purpose — the value belongs in the core
 * admin-config key `harness.confirmation_card.timeout_seconds` (registered with
 * the coordinator, default 30), and moving to it should change this line only.
 */
export const COMPOSER_QUESTION_TIMEOUT_SECONDS = 30;

/** What 「继续」 and the expiring countdown both mean. */
export const COMPOSER_QUESTION_DEFAULT_LABEL = '不补充，本次按通用模式生成';

/** Why an auto-release is being withheld (D-116 safety edge ②). */
export type ComposerQuestionHold = 'quota' | 'external_effect';

/** How the card stopped being open, once it has. */
export type ComposerQuestionSettlement = 'answered' | 'skipped' | 'timed_out';

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

const SETTLEMENT_NOTICES: Record<ComposerQuestionSettlement, string> = {
  answered: '已按你的回答继续',
  skipped: '已跳过，本次按通用模式生成',
  timed_out: '没有收到补充，已按通用模式继续',
};

export type ComposerQuestionCardView = {
  /** Whether the countdown may still reach zero and release the card. */
  autoContinueEnabled: boolean;
  /** Countdown copy, or null when there is no live countdown to show. */
  countdownNotice: string | null;
  /** Why auto-release is withheld, in merchant language. */
  holdNotice: string | null;
  /** Terminal line once the card has settled, in merchant language. */
  settledNotice: string | null;
  /** The value 「继续」 and a timeout both apply. */
  defaultLabel: string;
};

export function projectComposerQuestionCard(input: {
  remainingSeconds: number;
  hold: ComposerQuestionHold | null;
  /** True once the merchant has touched the answer — D-116 safety edge ①. */
  editing: boolean;
  settlement: ComposerQuestionSettlement | null;
}): ComposerQuestionCardView {
  const autoContinueEnabled =
    !input.hold && !input.editing && input.settlement === null;
  return {
    autoContinueEnabled,
    countdownNotice: autoContinueEnabled
      ? `${Math.max(0, input.remainingSeconds)} 秒后按默认继续，不用管也不会卡住`
      : null,
    holdNotice: input.hold ? HOLD_NOTICES[input.hold] : null,
    settledNotice: input.settlement
      ? SETTLEMENT_NOTICES[input.settlement]
      : null,
    defaultLabel: COMPOSER_QUESTION_DEFAULT_LABEL,
  };
}
