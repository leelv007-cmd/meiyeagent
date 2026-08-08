/**
 * Merchant-facing copy for confirmation wait / decide / hold-expiry (V31-11).
 * Aligns refund dual-state with V31-08 A5 billing-ux assets.
 */

import {
  formatQuoteCostLabel,
  formatRefundDualState,
  BILLING_UX_COPY,
} from './billing-ux.js';

export const CONFIRMATION_MERCHANT_COPY = {
  held: (n: number) => `已预留 ${n} 分`,
  balance: (n: number) => `当前可用 ${n} 分`,
  rejectedRefund: (n: number) => `已拒绝执行，预留的 ${n} 分已全额退回`,
  holdExpiredRefund: (n: number) =>
    `超时未确认，本次任务已取消，预留的 ${n} 分已退回`,
  /** Matches existing DBOS hold-expired merchant string when N is unknown. */
  holdExpiredGeneric: '超时未选择，本次任务已取消，积分已退回',
  confirmed: '已确认，将按本方案执行',
  rightsMissing: '授权信息待核对',
  factsMissing: '事实信息待核对',
  planOnlyNoCharge: '本确认只批准计划排期，不含扣费',
} as const;

export type ConfirmationCardProjection = {
  /** 「本次约消耗 N 分」 */
  costLabel: string;
  /** 「已预留 N 分」 while pending */
  heldLabel: string;
  /** A5 dual-state refund line */
  refundLabel: string;
  failureRefundsCredits: boolean;
  reservedCredits: number;
  balanceLabel: string | null;
  rightsSummary: string;
  factSummary: string;
  /** plan_only campaign banner */
  planOnlyNotice: string | null;
  /** Only reject / confirm — never settings controls */
  actions: readonly ['reject', 'confirm'];
  readOnly: true;
};

export function projectHeldCreditsLabel(reservedCredits: number): string {
  return CONFIRMATION_MERCHANT_COPY.held(reservedCredits);
}

export function projectConfirmationCard(input: {
  reservedCredits: number;
  failureRefundsCredits: boolean;
  availableCredits?: number | null;
  rightsSummary?: string | null;
  factSummary?: string | null;
  approvalScope?: 'plan_only' | 'single_work' | null;
}): ConfirmationCardProjection {
  const reservedCredits =
    Number.isSafeInteger(input.reservedCredits) && input.reservedCredits > 0
      ? input.reservedCredits
      : 0;
  return {
    costLabel: reservedCredits > 0 ? formatQuoteCostLabel(reservedCredits) : '',
    heldLabel:
      reservedCredits > 0 ? projectHeldCreditsLabel(reservedCredits) : '',
    refundLabel: formatRefundDualState(input.failureRefundsCredits),
    failureRefundsCredits: input.failureRefundsCredits,
    reservedCredits,
    balanceLabel:
      typeof input.availableCredits === 'number' &&
      Number.isSafeInteger(input.availableCredits) &&
      input.availableCredits >= 0
        ? CONFIRMATION_MERCHANT_COPY.balance(input.availableCredits)
        : null,
    rightsSummary:
      input.rightsSummary?.trim() || CONFIRMATION_MERCHANT_COPY.rightsMissing,
    factSummary:
      input.factSummary?.trim() || CONFIRMATION_MERCHANT_COPY.factsMissing,
    planOnlyNotice:
      input.approvalScope === 'plan_only'
        ? CONFIRMATION_MERCHANT_COPY.planOnlyNoCharge
        : null,
    actions: ['reject', 'confirm'],
    readOnly: true,
  };
}

export function projectRejectRefundMessage(reservedCredits: number): string {
  return CONFIRMATION_MERCHANT_COPY.rejectedRefund(Math.max(0, reservedCredits));
}

export function projectHoldExpiredMessage(reservedCredits: number): string {
  if (
    !Number.isSafeInteger(reservedCredits) ||
    reservedCredits <= 0
  ) {
    return CONFIRMATION_MERCHANT_COPY.holdExpiredGeneric;
  }
  return CONFIRMATION_MERCHANT_COPY.holdExpiredRefund(reservedCredits);
}

export { formatRefundDualState, BILLING_UX_COPY };
