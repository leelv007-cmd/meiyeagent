/**
 * Product-quote consumption for Composer (B2 / #92 → C1 / #95).
 *
 * Param changes (model / quantity / duration) re-quote and bump quote revision.
 * Confirm price MUST equal charge price (confirmedAmount === settled ceiling path).
 * Browser contract never embeds Provider / Deployment / Credential / fallback.
 */

import {
  type ProductBillingMode,
  type ProductQuoteSnapshot,
} from '@meiye/contracts';

import {
  findForbiddenBrowserComposerKey,
  projectBrowserComposerPayload,
} from './browser-contract';

export type ComposerQuoteView = {
  quoteId: string;
  revision: string;
  catalogModelId: string;
  billingMode: ProductBillingMode;
  /** Confirmed / estimated product amount (credit units). */
  amount: number;
  quantity: number;
  quotedSeconds?: number;
  targetSeconds?: number;
  /** Server-published merchant credit cost; never inferred from formula fields. */
  creditCost: number | null;
  /** Server-published credit refund policy for this quoted operation. */
  failureRefundsCredits: boolean | null;
  /** Merchant-facing billing note (e.g. 按生成成片 N 秒计费). */
  billingNote: string | null;
  lifecycleStatus: ProductQuoteSnapshot['lifecycleStatus'];
  formulaExpression: string;
};

/** Project a ProductQuoteSnapshot into a merchant-facing Composer view. */
export function projectComposerQuoteView(
  snapshot: ProductQuoteSnapshot,
  quantity = 1
): ComposerQuoteView {
  const creditCost =
    typeof snapshot.creditCost === 'number' &&
    Number.isSafeInteger(snapshot.creditCost) &&
    snapshot.creditCost > 0
      ? snapshot.creditCost
      : null;
  const amount = creditCost ?? snapshot.confirmedAmount ?? 0;
  const billingNote =
    snapshot.billingMode === 'per_output_second' &&
    snapshot.quotedSeconds != null
      ? `按生成成片 ${snapshot.quotedSeconds} 秒计费`
      : null;

  return {
    quoteId: snapshot.quoteId,
    revision: snapshot.revision,
    catalogModelId: snapshot.catalogModelId,
    billingMode: snapshot.billingMode,
    amount,
    quantity,
    quotedSeconds: snapshot.quotedSeconds,
    targetSeconds: snapshot.targetSeconds,
    creditCost,
    failureRefundsCredits:
      typeof snapshot.failureRefundsCredits === 'boolean'
        ? snapshot.failureRefundsCredits
        : null,
    billingNote,
    lifecycleStatus: snapshot.lifecycleStatus,
    formulaExpression: snapshot.formula.expression,
  };
}

/**
 * Confirm path: the amount the user accepts MUST equal the charge amount
 * frozen on the snapshot (confirmedAmount === authorizedCeiling for simple path).
 */
export function confirmQuotePrice(snapshot: ProductQuoteSnapshot): {
  confirmPrice: number;
  chargePrice: number;
  matches: boolean;
  revision: string;
} {
  const confirmPrice = snapshot.confirmedAmount ?? 0;
  const chargePrice = snapshot.authorizedCeiling ?? confirmPrice;
  return {
    confirmPrice,
    chargePrice,
    matches: confirmPrice === chargePrice,
    revision: snapshot.revision,
  };
}

/** Browser-safe quote view — strips any accidental channel fields. */
export function serializeComposerQuoteForBrowser(
  view: ComposerQuoteView
): Record<string, unknown> {
  const projected = projectBrowserComposerPayload({ ...view });
  const forbidden = findForbiddenBrowserComposerKey(projected);
  if (forbidden) {
    throw new Error(`composer quote browser leak: ${forbidden}`);
  }
  return projected;
}
