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
  // No retry here on purpose: the request is genuinely in flight and is
  // deadline-bounded (`COMPOSER_QUOTE_TIMEOUT_MS`), so a stuck one becomes
  // `failed` on its own rather than inviting a second identical POST.
  return { state: 'requesting', message: MESSAGES.requesting, retry: null };
}

/** Phase of a TanStack query, narrowed to what this state machine reads. */
export function composerQueryPhase(query: {
  isError: boolean;
  isSuccess: boolean;
}): ComposerQueryPhase {
  if (query.isError) return 'error';
  return query.isSuccess ? 'success' : 'pending';
}
