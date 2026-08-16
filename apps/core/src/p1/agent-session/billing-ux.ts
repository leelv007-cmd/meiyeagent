/**
 * Session Harness billing UX three rules (V31-08 / V3.1 §3 R5 / A5).
 *
 * On Level 0/1 confirmation-exempt paths:
 * 1. Quote chip always visible: 「本次约消耗 N 分」+ refund dual-state copy
 * 2. Balance shortfall blocks submit with dual exits (买加油包 / 升级套餐)
 * 3. Failure-refund state is visible on chip (and later on ledger — Make path)
 *
 * Data authority = product quote + credit balance ports (no invented prices).
 * Dual-truth (D-061): only merchant credits — never tokens/USD/provider cost.
 */
import {
  BALANCE_BLOCK_EXITS,
  BILLING_UX_COPY,
  formatQuoteCostLabel,
  formatRefundDualState,
  formatShortfallLabel,
} from '@meiye/contracts';

/** Merchant-safe quote facts from product quote authority / frozen snapshot. */
export type SessionBillingQuoteFacts = {
  creditCost: number;
  failureRefundsCredits: boolean;
};

/** Merchant-safe balance facts from credit ledger projection. */
export type SessionBillingBalanceFacts = {
  availableCredits: number;
};

export type SessionBillingQuoteChip = {
  visible: true;
  creditCost: number;
  failureRefundsCredits: boolean;
  /** 「本次约消耗 N 分」 */
  costLabel: string;
  /**
   * Dual-state refund copy (A5 / credit-billing §6.2):
   * true  → 「失败自动退回」
   * false → 「该模型失败不退回」
   */
  refundLabel: string;
};

export type SessionBillingBalanceBlock = {
  blocked: true;
  missingCredits: number;
  /** 「还差 N 分」 */
  shortfallLabel: string;
  exits: readonly [
    { id: 'buy_booster'; label: string },
    { id: 'upgrade_plan'; label: string },
  ];
};

export type SessionBillingUxProjection = {
  quoteChip: SessionBillingQuoteChip | { visible: false; reason: string };
  balanceBlock: SessionBillingBalanceBlock | null;
  /** True when submit must be blocked (shortfall or missing quote). */
  submitBlocked: boolean;
};

// The words moved to @meiye/contracts so the three web surfaces that also say
// them stop spelling them out again. Re-exported here because this module's
// existing importers ask this file for them.
export {
  BALANCE_BLOCK_EXITS,
  BILLING_UX_COPY,
  formatQuoteCostLabel,
  formatRefundDualState,
  formatShortfallLabel,
};

/**
 * Project merchant-facing billing UX for confirmation-exempt paths (A5).
 * Fail closed: invalid quote → chip hidden + submit blocked.
 */
export function projectSessionBillingUx(input: {
  quote: SessionBillingQuoteFacts | null | undefined;
  balance: SessionBillingBalanceFacts | null | undefined;
}): SessionBillingUxProjection {
  const quote = input.quote;
  if (
    !quote ||
    !Number.isSafeInteger(quote.creditCost) ||
    quote.creditCost <= 0 ||
    typeof quote.failureRefundsCredits !== 'boolean'
  ) {
    return {
      quoteChip: {
        visible: false,
        reason: quote ? BILLING_UX_COPY.invalidQuote : BILLING_UX_COPY.missingQuote,
      },
      balanceBlock: null,
      submitBlocked: true,
    };
  }

  const quoteChip: SessionBillingQuoteChip = {
    visible: true,
    creditCost: quote.creditCost,
    failureRefundsCredits: quote.failureRefundsCredits,
    costLabel: formatQuoteCostLabel(quote.creditCost),
    refundLabel: formatRefundDualState(quote.failureRefundsCredits),
  };

  const available = input.balance?.availableCredits;
  if (
    available === undefined ||
    !Number.isSafeInteger(available) ||
    available < 0
  ) {
    // Balance unknown: still show chip; block submit fail-closed.
    return {
      quoteChip,
      balanceBlock: null,
      submitBlocked: true,
    };
  }

  const missingCredits = Math.max(0, quote.creditCost - available);
  if (missingCredits > 0) {
    return {
      quoteChip,
      balanceBlock: {
        blocked: true,
        missingCredits,
        shortfallLabel: formatShortfallLabel(missingCredits),
        exits: BALANCE_BLOCK_EXITS,
      },
      submitBlocked: true,
    };
  }

  return {
    quoteChip,
    balanceBlock: null,
    submitBlocked: false,
  };
}

/** Port for turn runner: resolve quote facts without inventing prices. */
export type SessionBillingQuotePort = {
  resolveQuote: (input: {
    workspaceId: string;
    runId: string;
    merchantMessage: string;
    level: 0 | 1 | 2 | 3;
    isPureCopy: boolean;
  }) => Promise<SessionBillingQuoteFacts | null>;
};

export type SessionBillingBalancePort = {
  resolveBalance: (input: {
    workspaceId: string;
  }) => Promise<SessionBillingBalanceFacts | null>;
};
