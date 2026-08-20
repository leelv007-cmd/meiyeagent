/**
 * Composer quote precondition states (#240 baseline-red triage §2).
 *
 * The Composer used to collapse "a query is still in flight" and "a
 * precondition never came together, so the quote request was never sent" into
 * one line of copy — 正在读取模型与报价…. Everything below hid behind it: a
 * failed surface read, a pending or failed preferences read, a platform default
 * model that is absent / unavailable / unpriced in the catalog, a missing
 * destination, a signed-submission schema failure, and the disabled quote query
 * those produce. None of them resolve on their own, so the merchant sat in a
 * loading state that could never end and had nothing to act on.
 *
 * This module is the state machine that separates them. It is deliberately pure
 * and takes only phases and booleans: the host owns the queries, this owns what
 * the merchant is told and what they can do about it.
 */

export type ComposerQueryPhase = 'pending' | 'error' | 'success';

export type ComposerQuoteReadinessState =
  | 'idle'
  | 'loading'
  | 'no_recipe'
  | 'no_model'
  | 'invalid_submission'
  | 'settling'
  | 'requesting'
  | 'failed'
  | 'ready';

/** Which reads a retry should re-issue; `null` means retrying cannot help. */
export type ComposerQuoteRetryTarget = 'surface' | 'catalog' | 'quote' | null;

export interface ComposerQuoteReadiness {
  state: ComposerQuoteReadinessState;
  /** Merchant-facing line; `null` when the host renders the quote instead. */
  message: string | null;
  retry: ComposerQuoteRetryTarget;
}

export interface ComposerQuoteReadinessInput {
  lensSelected: boolean;
  surface: ComposerQueryPhase;
  catalog: ComposerQueryPhase;
  preferences: ComposerQueryPhase;
  /** `disabled` when the quote input never formed, so the query never fires. */
  quote: ComposerQueryPhase | 'disabled';
  /**
   * The billable payload is still moving, so the request is deliberately held
   * back. Not the same as in flight — nothing has been sent yet, and saying
   * 正在算 here would be a request state the merchant cannot verify.
   */
  settling: boolean;
  hasRecipe: boolean;
  hasModel: boolean;
  /** A destination the merchant picked, or the one the recipe carries. */
  hasDestination: boolean;
  hasSignedSubmission: boolean;
  hasQuoteView: boolean;
}

const MESSAGES = {
  failed: '刚才没能算出这次要花多少。',
  loading: '正在读取模型与报价…',
  no_model: '这个方向暂时没有可用的模型，先算不出花多少。',
  no_recipe: '这个方向暂时没有可用的模板，换个方向或稍后再试。',
  needs_destination: '先选一个要发去的平台，才能算这次花多少。',
  needs_more: '还差一点信息才能算这次花多少，补齐后会自动更新。',
  requesting: '正在算这次大概花多少…',
  settling: '等你改完这句就去算这次花多少。',
} as const;

/**
 * Resolve what the Composer should say about the quote, and whether a retry is
 * on offer. Order matters: an errored precondition outranks a pending one
 * because it will never settle by waiting, and a missing precondition outranks
 * "requesting" because the request cannot have been sent.
 */
export function resolveComposerQuoteReadiness(
  input: ComposerQuoteReadinessInput
): ComposerQuoteReadiness {
  if (!input.lensSelected) {
    return { state: 'idle', message: null, retry: null };
  }
  if (input.hasQuoteView) {
    return { state: 'ready', message: null, retry: null };
  }
  if (input.surface === 'error') {
    return { state: 'failed', message: MESSAGES.failed, retry: 'surface' };
  }
  if (input.catalog === 'error' || input.preferences === 'error') {
    return { state: 'failed', message: MESSAGES.failed, retry: 'catalog' };
  }
  if (input.quote === 'error') {
    return { state: 'failed', message: MESSAGES.failed, retry: 'quote' };
  }
  if (
    input.surface === 'pending' ||
    input.catalog === 'pending' ||
    input.preferences === 'pending'
  ) {
    return { state: 'loading', message: MESSAGES.loading, retry: null };
  }
  if (!input.hasRecipe) {
    return {
      state: 'no_recipe',
      message: MESSAGES.no_recipe,
      retry: 'surface',
    };
  }
  if (!input.hasModel) {
    return { state: 'no_model', message: MESSAGES.no_model, retry: 'catalog' };
  }
  if (!input.hasSignedSubmission) {
    return {
      state: 'invalid_submission',
      message: input.hasDestination
        ? MESSAGES.needs_more
        : MESSAGES.needs_destination,
      retry: null,
    };
  }
  if (input.settling) {
    // Held, not in flight. Every other waiting state here is something the
    // merchant is waiting *on*; this one is waiting *for them*, and it ends by
    // itself the moment they stop typing — so no retry, and above all not the
    // 正在算 line, which would claim a request that was never sent.
    return { state: 'settling', message: MESSAGES.settling, retry: null };
  }
  // No retry here on purpose: the request is genuinely in flight and is
  // deadline-bounded (`COMPOSER_QUOTE_TIMEOUT_MS`), so a stuck one becomes
  // `failed` on its own rather than inviting a second identical POST.
  return { state: 'requesting', message: MESSAGES.requesting, retry: null };
}

/**
 * The bound quote view, but only while it still belongs to the input on screen.
 *
 * The view lives in the draft and nothing clears it when the merchant keeps
 * typing, so after an edit the old price would otherwise keep rendering as a
 * settled number while the new quote is still in flight — or has conflicted, or
 * timed out — and the submit gate would happily admit a run against it. Quote
 * identity is a digest of the whole billable payload, so "same quoteId" is
 * exactly "still the quote for what is on screen" (#240 P1).
 */
export function currentComposerQuoteView<View extends { quoteId: string }>(
  view: View | null | undefined,
  quoteId: string | null | undefined
): View | null {
  if (!view || !quoteId) return null;
  return view.quoteId === quoteId ? view : null;
}

/** Phase of a TanStack query, narrowed to what this state machine reads. */
export function composerQueryPhase(query: {
  isError: boolean;
  isSuccess: boolean;
}): ComposerQueryPhase {
  if (query.isError) return 'error';
  return query.isSuccess ? 'success' : 'pending';
}

/** Settled-usage sentence when the bound quote has no extra billing note. */
export const COMPOSER_QUOTE_CONFIRMED_MESSAGE = '本次用量已确认';

export type ComposerQuoteUsageLine =
  | { kind: 'confirmed'; text: string }
  | { kind: 'hidden' }
  | { kind: 'status'; readiness: ComposerQuoteReadiness };

/**
 * One usage sentence for the Composer quote strip (V31-74).
 *
 * 「还差一点信息才能算这次花多少」and 「本次用量已确认」used to be chosen by
 * two independent render branches, so both could land on screen. This is the
 * single decision: a bound quote owns the confirmed line (unless a required
 * source slot is still open — V31-73), and only a missing quote may speak
 * the readiness line.
 */
export function resolveComposerQuoteUsageLine(input: {
  billingNote: string | null;
  hasQuoteView: boolean;
  readiness: ComposerQuoteReadiness;
  showConfirmed: boolean;
}): ComposerQuoteUsageLine {
  if (input.hasQuoteView) {
    if (!input.showConfirmed) return { kind: 'hidden' };
    return {
      kind: 'confirmed',
      text: input.billingNote ?? COMPOSER_QUOTE_CONFIRMED_MESSAGE,
    };
  }
  if (input.readiness.message) {
    return { kind: 'status', readiness: input.readiness };
  }
  return { kind: 'hidden' };
}

/**
 * FREE is model-direct. Recipe source slots belong to customized recipes, so a
 * bound FREE quote may confirm without a slot fill (Day-0 FREE / explicit
 * fact-selector). Customized still hides confirmation while a required slot is
 * open (V31-73).
 */
export function composerQuoteConfirmedForMode(input: {
  creationMode: 'customized' | 'free';
  unsatisfiedRequiredSlotCount: number;
}): boolean {
  return (
    input.creationMode === 'free' || input.unsatisfiedRequiredSlotCount === 0
  );
}

export type ComposerQuoteStrip = {
  showCreditQuote: boolean;
  showQuoteLine: boolean;
  showStatus: boolean;
};

/**
 * Bound-quote chrome on the Composer usage strip.
 *
 * Confirmed usage is `composer-quote-line` only — mounting the credit chip
 * next to it makes Playwright `.or()` locators strict-fail (two matches).
 * The credit chip is the pre-confirm cost line. Status is only for a missing
 * quote.
 */
export function resolveComposerQuoteStrip(input: {
  creditQuoteVisible: boolean;
  hasQuoteView: boolean;
  usage: ComposerQuoteUsageLine;
}): ComposerQuoteStrip {
  if (input.hasQuoteView) {
    const confirmed = input.usage.kind === 'confirmed';
    return {
      showCreditQuote: input.creditQuoteVisible && !confirmed,
      showQuoteLine: confirmed,
      showStatus: false,
    };
  }
  return {
    showCreditQuote: false,
    showQuoteLine: false,
    showStatus: input.usage.kind === 'status',
  };
}
