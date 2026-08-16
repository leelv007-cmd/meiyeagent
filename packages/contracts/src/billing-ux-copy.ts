/**
 * The merchant-facing words for credit billing UX (A5 / credit-billing §6.2).
 *
 * They live in contracts because both sides say them. Core projects them into
 * the session turn payload (p1/agent-session/billing-ux.ts). The web renders
 * them on three surfaces fed by other endpoints — the composer execution
 * confirm card, the workbench commit strip, and the living plan — and each of
 * those three used to spell the refund dual-state out as literals. Four copies
 * of one sentence that agreed only because someone had read all four.
 *
 * What this removes is the second wording, not the second number: each side
 * still formats whatever facts it was handed, so the two can still show
 * different credit costs if they are fed differently. The threshold policies
 * also stay where they are — Core fails closed when the balance is unknown and
 * the commit strip fails open — because those are product decisions, not
 * duplicated spelling.
 */
export const BILLING_UX_COPY = {
  costLabel: (n: number) => `本次约消耗 ${n} 分`,
  refundOn: '失败自动退回',
  refundOff: '该模型失败不退回',
  shortfall: (n: number) => `还差 ${n} 分`,
  buyBooster: '购买加油包',
  upgradePlan: '升级套餐',
  missingQuote: '报价未就绪',
  invalidQuote: '报价无效'
} as const;

export function formatQuoteCostLabel(creditCost: number): string {
  return BILLING_UX_COPY.costLabel(creditCost);
}

export function formatRefundDualState(failureRefundsCredits: boolean): string {
  return failureRefundsCredits
    ? BILLING_UX_COPY.refundOn
    : BILLING_UX_COPY.refundOff;
}

export function formatShortfallLabel(missingCredits: number): string {
  return BILLING_UX_COPY.shortfall(missingCredits);
}

export const BALANCE_BLOCK_EXITS = [
  { id: 'buy_booster' as const, label: BILLING_UX_COPY.buyBooster },
  { id: 'upgrade_plan' as const, label: BILLING_UX_COPY.upgradePlan }
] as const;
