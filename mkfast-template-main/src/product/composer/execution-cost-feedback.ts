/**
 * 成本即时反馈 — D-164⑥ 决定 B, in the form ratified as D3 (message tail line).
 *
 * The whole point is that the merchant is never left guessing what a run cost,
 * including the run she declined. The wording is produced here as data
 * (`{tone, text}`) and rendered as one `<p>`; if the form is ever re-litigated
 * — corner badge, toast — only those few render lines move, and the projection,
 * the data sources and the tests stay put.
 *
 * On the rejected branch the honest answer is that nothing was spent. D-164⑥C
 * requires that a decline not read as free when it was not, and it cites Miora,
 * where declining still moved the merchant's balance. That failure mode cannot
 * occur here: by D-109 the planner's own cost goes to the ProviderCost ledger
 * and never to the merchant's bucket, so declining genuinely costs her zero.
 * Printing a charge would be inventing one. (Ratified 2026-07-29; if billing is
 * ever split so planning does debit the merchant, that is a change to D-109 and
 * a new decision, not a change here.)
 */

import {
  composer_run_cancelled_no_spend,
  composer_run_credits_settled,
  composer_run_failed_credits_returned,
} from '@/locale/paraglide/messages';

export type ExecutionOutcome = 'rejected' | 'settled' | 'failed';

export type ExecutionCostFeedback = {
  readonly tone: 'neutral' | 'positive';
  readonly text: string;
  /** Stable handle for tests and telemetry; never shown. */
  readonly outcome: ExecutionOutcome;
};

export type ExecutionCostFeedbackInput = {
  readonly outcome: ExecutionOutcome;
  /**
   * What settlement actually committed, in credits — not what was reserved.
   * Only read on the 'settled' branch.
   */
  readonly settledCredits?: number | null;
};

/**
 * Returns null when there is nothing honest to say — a settled run whose
 * committed credits have not come back yet. Saying「本次用了 0 分」there would
 * be a claim about the merchant's balance made from missing data, which is the
 * one thing this line exists to prevent.
 */
export function projectExecutionCostFeedback(
  input: ExecutionCostFeedbackInput
): ExecutionCostFeedback | null {
  if (input.outcome === 'rejected') {
    return {
      outcome: 'rejected',
      text: composer_run_cancelled_no_spend(),
      tone: 'neutral',
    };
  }
  if (input.outcome === 'failed') {
    // D-109 already commits to refunding an unaccepted or failed run in full,
    // and the ledger already implements it. This only says so out loud.
    return {
      outcome: 'failed',
      text: composer_run_failed_credits_returned(),
      tone: 'neutral',
    };
  }
  const settledCredits = input.settledCredits;
  if (
    typeof settledCredits !== 'number' ||
    !Number.isSafeInteger(settledCredits) ||
    settledCredits <= 0
  ) {
    return null;
  }
  return {
    outcome: 'settled',
    // Same sentence the card promised before the run, now in the past tense —
    // one run described one way.
    text: composer_run_credits_settled({ count: settledCredits }),
    tone: 'positive',
  };
}
