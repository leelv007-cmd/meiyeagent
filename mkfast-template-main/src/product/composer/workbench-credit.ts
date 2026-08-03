import type { PublicCreditBalance } from '@meiye/contracts';

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

/** Published merchant-safe credit fields from the current quote projection. */
type MerchantCreditQuoteInput = {
  creditCost?: number | null;
  failureRefundsCredits?: boolean | null;
};

export type FreshCreditProjection = {
  credits?: PublicCreditBalance | null;
};

export type FreshCreditAdmission =
  | { kind: 'admitted' }
  | { kind: 'shortfall'; missingCredits: number }
  | { kind: 'unavailable' };

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

/**
 * Final browser admission reads Core's current merchant-safe projection before
 * allowing a quoted run. The Core reservation transaction remains authoritative
 * for concurrent spends after this read.
 */
export async function admitFreshCreditRun({
  loadProjection,
  quote,
}: {
  loadProjection: () => Promise<FreshCreditProjection>;
  quote: MerchantCreditQuoteInput | null | undefined;
}): Promise<FreshCreditAdmission> {
  const currentQuote = projectWorkbenchCreditQuote(quote);
  if (!currentQuote.visible || currentQuote.creditCost === null) {
    return { kind: 'unavailable' };
  }

  let projection: FreshCreditProjection;
  try {
    projection = await loadProjection();
  } catch {
    return { kind: 'unavailable' };
  }

  const balance = projection?.credits;
  if (
    !balance ||
    !Number.isSafeInteger(balance.availableCredits) ||
    balance.availableCredits < 0
  ) {
    return { kind: 'unavailable' };
  }

  const missingCredits = Math.max(
    0,
    currentQuote.creditCost - balance.availableCredits
  );
  return missingCredits > 0
    ? { kind: 'shortfall', missingCredits }
    : { kind: 'admitted' };
}

/**
 * Renders only the merchant-safe balance contract from `entitlements`.
 * The date stays an output hint; balance authority remains the Core ledger.
 */
export function projectWorkbenchCreditBalance(
  balance: PublicCreditBalance | null | undefined,
  now: Date
): WorkbenchCreditBalanceView {
  if (
    !balance ||
    !Number.isSafeInteger(balance.availableCredits) ||
    balance.availableCredits < 0
  ) {
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
  quote: MerchantCreditQuoteInput | null | undefined
): WorkbenchCreditQuoteView {
  if (
    !quote ||
    typeof quote.creditCost !== 'number' ||
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
