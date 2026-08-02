import type {
  CreationLensId,
  PublicCreditBalance,
  PublicProductQuoteSnapshot,
} from '@meiye/contracts';

export type WorkbenchCreditBalanceView = {
  availableCredits: number;
  expiringLot: {
    remainingCredits: number;
    expiresAt: string;
    daysUntilExpiry: number;
  } | null;
  visible: boolean;
};

export type WorkbenchCreditQuoteView = {
  creditCost: number | null;
  failureRefundsCredits: boolean | null;
  visible: boolean;
};

export type WorkbenchCreditShortfallView = {
  missingCredits: number;
  visible: boolean;
};

export type CreditGuardedComposerRun = {
  briefConfirmationId?: string;
  lensId: CreationLensId;
  videoConfirmAccepted?: boolean;
};

const HIDDEN_BALANCE: WorkbenchCreditBalanceView = {
  availableCredits: 0,
  expiringLot: null,
  visible: false,
};

const HIDDEN_QUOTE: WorkbenchCreditQuoteView = {
  creditCost: null,
  failureRefundsCredits: null,
  visible: false,
};

const HIDDEN_SHORTFALL: WorkbenchCreditShortfallView = {
  missingCredits: 0,
  visible: false,
};

/** Runs a confirmation only after rechecking the latest credit projection. */
export function confirmCreditGuardedRun({
  quotaBlocked,
  run,
  onBlocked,
  onConfirmed,
}: {
  quotaBlocked: boolean;
  run: CreditGuardedComposerRun | null;
  onBlocked: () => void;
  onConfirmed: (run: CreditGuardedComposerRun | null) => void;
}) {
  if (quotaBlocked) {
    onBlocked();
    return;
  }
  onConfirmed(run);
}

/**
 * Renders only the merchant-safe balance contract from `entitlements`.
 * The date stays an output hint; balance authority remains the Core ledger.
 */
export function projectWorkbenchCreditBalance(
  balance: PublicCreditBalance | null | undefined,
  now: Date
): WorkbenchCreditBalanceView {
  if (!balance || !Number.isSafeInteger(balance.availableCredits)) {
    return HIDDEN_BALANCE;
  }
  const lot = balance.soonestExpiringLot;
  if (!lot) {
    return {
      availableCredits: balance.availableCredits,
      expiringLot: null,
      visible: true,
    };
  }
  const expiresAtMs = Date.parse(lot.expiresAt);
  if (
    !Number.isSafeInteger(lot.remainingCredits) ||
    lot.remainingCredits <= 0 ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= now.getTime()
  ) {
    return {
      availableCredits: balance.availableCredits,
      expiringLot: null,
      visible: true,
    };
  }
  return {
    availableCredits: balance.availableCredits,
    expiringLot: {
      remainingCredits: lot.remainingCredits,
      expiresAt: lot.expiresAt,
      daysUntilExpiry: Math.ceil((expiresAtMs - now.getTime()) / 86_400_000),
    },
    visible: true,
  };
}

/** Uses the published credit quote; legacy monetary fields cannot enter this view. */
export function projectWorkbenchCreditQuote(
  quote:
    | Pick<PublicProductQuoteSnapshot, 'creditCost' | 'failureRefundsCredits'>
    | null
    | undefined
): WorkbenchCreditQuoteView {
  if (
    !quote ||
    !Number.isSafeInteger(quote.creditCost) ||
    quote.creditCost <= 0 ||
    typeof quote.failureRefundsCredits !== 'boolean'
  ) {
    return HIDDEN_QUOTE;
  }
  return {
    creditCost: quote.creditCost,
    failureRefundsCredits: quote.failureRefundsCredits,
    visible: true,
  };
}

/** The client blocks only a known server-quoted credit shortfall. */
export function projectWorkbenchCreditShortfall(
  balance: Pick<PublicCreditBalance, 'availableCredits'> | null | undefined,
  quote: WorkbenchCreditQuoteView
): WorkbenchCreditShortfallView {
  if (
    !quote.visible ||
    quote.creditCost === null ||
    !balance ||
    !Number.isSafeInteger(balance.availableCredits)
  ) {
    return HIDDEN_SHORTFALL;
  }
  const missingCredits = Math.max(
    0,
    quote.creditCost - balance.availableCredits
  );
  return {
    missingCredits,
    visible: missingCredits > 0,
  };
}
