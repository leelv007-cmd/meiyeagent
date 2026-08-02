/**
 * Product-quote consumption for Composer (B2 / #92 → C1 / #95).
 *
 * Param changes (model / quantity / duration) re-quote and bump quote revision.
 * Confirm price MUST equal charge price (confirmedAmount === settled ceiling path).
 * Browser contract never embeds Provider / Deployment / Credential / fallback.
 */

import {
  applyBillableSecondsRules,
  computeProductAmount,
  type BuildProductQuoteInput,
  type ProductBillingMode,
  type ProductQuoteSnapshot,
} from '@meiye/contracts';

import {
  findForbiddenBrowserComposerKey,
  projectBrowserComposerPayload,
} from './browser-contract';

export type ComposerQuoteRequest = {
  quoteId: string;
  catalogModelId: string;
  catalogModelRevision?: string;
  quotePolicyRevision: string;
  billingMode: ProductBillingMode;
  unitRate: number;
  currency?: string;
  /** Output quantity for per_request multi-output (copy packages, image sets). */
  quantity?: number;
  targetSeconds?: number;
  minChargeSeconds?: number;
  roundingStepSeconds?: number;
  workspaceId?: string;
};

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

/**
 * Pure local quote builder used by the Composer before/without a live server.
 * Mirrors product-quote formula rules so unit tests can assert re-quote wiring.
 */
export function buildComposerQuote(
  request: ComposerQuoteRequest
): ProductQuoteSnapshot {
  const quantity = Math.max(1, request.quantity ?? 1);
  const quotedSeconds =
    request.billingMode === 'per_output_second'
      ? applyBillableSecondsRules({
          rawSeconds: request.targetSeconds ?? 0,
          minChargeSeconds: request.minChargeSeconds,
          roundingStepSeconds: request.roundingStepSeconds,
        })
      : undefined;

  const unitAmount = computeProductAmount({
    billingMode: request.billingMode,
    unitRate: request.unitRate,
    billableSeconds: quotedSeconds,
  });
  const amount =
    request.billingMode === 'per_request' ? unitAmount * quantity : unitAmount;

  const revision = composeQuoteRevision({
    catalogModelId: request.catalogModelId,
    catalogModelRevision: request.catalogModelRevision,
    quotePolicyRevision: request.quotePolicyRevision,
    billingMode: request.billingMode,
    unitRate: request.unitRate,
    quantity,
    targetSeconds: request.targetSeconds,
    minChargeSeconds: request.minChargeSeconds,
    roundingStepSeconds: request.roundingStepSeconds,
  });

  const formulaExpression =
    request.billingMode === 'per_output_second'
      ? `${request.unitRate} × ${quotedSeconds ?? 0}s`
      : `${request.unitRate} × ${quantity}`;

  return {
    quoteId: request.quoteId,
    revision,
    catalogModelId: request.catalogModelId,
    catalogModelRevision: request.catalogModelRevision,
    quotePolicyRevision: request.quotePolicyRevision,
    billingMode: request.billingMode,
    formula: {
      unitRate: request.unitRate,
      currency: request.currency,
      expression: formulaExpression,
    },
    targetSeconds: request.targetSeconds,
    quotedSeconds,
    minChargeSeconds: request.minChargeSeconds,
    roundingStepSeconds: request.roundingStepSeconds,
    confirmedAmount: amount,
    authorizedCeiling: amount,
    lifecycleStatus: 'quoted',
    workspaceId: request.workspaceId,
  };
}

export function composeQuoteRevision(input: {
  catalogModelId: string;
  catalogModelRevision?: string;
  quotePolicyRevision: string;
  billingMode: ProductBillingMode;
  unitRate: number;
  quantity: number;
  targetSeconds?: number;
  minChargeSeconds?: number;
  roundingStepSeconds?: number;
}): string {
  return [
    input.catalogModelId,
    input.catalogModelRevision ?? '0',
    input.quotePolicyRevision,
    input.billingMode,
    String(input.unitRate),
    String(input.quantity),
    String(input.targetSeconds ?? ''),
    String(input.minChargeSeconds ?? ''),
    String(input.roundingStepSeconds ?? ''),
  ].join(':');
}

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
 * Re-quote when model / quantity / duration changes.
 * Returns a new snapshot with a new revision (never mutates previous).
 */
export function requoteOnParamChange(
  previous: ProductQuoteSnapshot | null,
  request: ComposerQuoteRequest
): { snapshot: ProductQuoteSnapshot; revisionChanged: boolean } {
  const snapshot = buildComposerQuote(request);
  const revisionChanged = !previous || previous.revision !== snapshot.revision;
  return { snapshot, revisionChanged };
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

/** Map a BuildProductQuoteInput (server shape) into ComposerQuoteRequest. */
export function composerRequestFromBuildInput(
  input: BuildProductQuoteInput,
  quantity = 1
): ComposerQuoteRequest {
  return {
    quoteId: input.quoteId,
    catalogModelId: input.catalogModelId,
    catalogModelRevision: input.catalogModelRevision,
    quotePolicyRevision: input.quotePolicyRevision,
    billingMode: input.billingMode,
    unitRate: input.unitRate,
    currency: input.currency,
    quantity,
    targetSeconds: input.targetSeconds,
    minChargeSeconds: input.minChargeSeconds,
    roundingStepSeconds: input.roundingStepSeconds,
    workspaceId: input.workspaceId,
  };
}
