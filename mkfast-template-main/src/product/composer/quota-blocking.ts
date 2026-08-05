/**
 * GL-23 credit-exhausted blocking card model (C4 / #98, ledger §7.7).
 *
 * Inline redemption code input reuses the existing redemptions CAS seam
 * (commandP1 module 'redemptions' / action 'redeem'). Success unlocks
 * continue-creation in place — no navigation to settings.
 *
 * The passive half of this card used to print what a run would spend and what
 * was left, per resource bucket. Its only balance source was the retired
 * three-bucket entitlement projection (#336 AC3), and credit billing already
 * shows the same two facts in the unit that now settles them — the workbench
 * prints `workbench_credit_balance` beside the composer and
 * `workbench_credit_quote` on the quote line. So the passive display is not
 * gone; it moved to credits, and this module no longer counts buckets.
 */

import {
  composer_credit_block_description,
  composer_credit_block_title,
} from '@/locale/paraglide/messages';

export const QUOTA_BLOCK_CODE_LABEL = '兑换码';
export const QUOTA_BLOCK_CODE_PLACEHOLDER = '输入兑换码';
export const QUOTA_BLOCK_SUBMIT_LABEL = '兑换并继续';
export const QUOTA_BLOCK_SUCCESS_LABEL = '兑换成功，可继续创作';
export const QUOTA_BLOCK_FAILED_LABEL = '兑换失败，请检查兑换码';
/**
 * D-141 死链修复：原「查看套餐」指向 `/settings/credits`，而该地址被
 * `navigation.ts` 重定向到只读的用量页——积分不足的商家点过去看到的是同一
 * 个「你没积分了」，没有任何出路。真实出路只有两条：卡内兑换码当场解锁，
 * 或者找运营开通。这里保留后者，指向真实存在、真的有人看的联系表单。
 */
export const QUOTA_BLOCK_CONTACT_LABEL = '联系运营开通';

export type QuotaRedeemStatus = 'idle' | 'pending' | 'success' | 'error';

export type QuotaBlockingState = {
  /** True when creation is blocked by exhausted quota. */
  blocked: boolean;
  /** True after a successful redeem — host may continue creation. */
  unlocked: boolean;
  code: string;
  status: QuotaRedeemStatus;
  errorMessage: string | null;
  successMessage: string | null;
};

export type QuotaBlockingView = {
  visible: boolean;
  title: string;
  description: string;
  code: string;
  codeLabel: string;
  codePlaceholder: string;
  submitLabel: string;
  canSubmit: boolean;
  status: QuotaRedeemStatus;
  errorMessage: string | null;
  successMessage: string | null;
  unlocked: boolean;
  /** Host continues creation when this is true. */
  canContinueCreation: boolean;
};

export function createQuotaBlockingState(blocked = false): QuotaBlockingState {
  return {
    blocked,
    unlocked: false,
    code: '',
    status: 'idle',
    errorMessage: null,
    successMessage: null,
  };
}

export function showQuotaBlocking(
  state: QuotaBlockingState
): QuotaBlockingState {
  return {
    ...state,
    blocked: true,
    unlocked: false,
    status: 'idle',
    errorMessage: null,
    successMessage: null,
  };
}

export function setQuotaRedeemCode(
  state: QuotaBlockingState,
  code: string
): QuotaBlockingState {
  return {
    ...state,
    code: code.trim().toUpperCase(),
    // Typing resets prior error so the merchant can retry.
    status: state.status === 'error' ? 'idle' : state.status,
    errorMessage: state.status === 'error' ? null : state.errorMessage,
  };
}

export function beginQuotaRedeem(
  state: QuotaBlockingState
): QuotaBlockingState {
  if (!state.blocked || state.unlocked) return state;
  if (state.code.trim().length < 4) return state;
  return {
    ...state,
    status: 'pending',
    errorMessage: null,
    successMessage: null,
  };
}

/**
 * Apply redeem result. Success unlocks continue-creation in place.
 */
export function completeQuotaRedeem(
  state: QuotaBlockingState,
  result: { ok: true } | { ok: false; message?: string }
): QuotaBlockingState {
  if (state.status !== 'pending' && state.status !== 'idle') {
    // Allow complete from idle when host calls redeem directly.
  }
  if (result.ok) {
    return {
      ...state,
      blocked: false,
      unlocked: true,
      status: 'success',
      code: '',
      errorMessage: null,
      successMessage: QUOTA_BLOCK_SUCCESS_LABEL,
    };
  }
  return {
    ...state,
    blocked: true,
    unlocked: false,
    status: 'error',
    errorMessage: result.message ?? QUOTA_BLOCK_FAILED_LABEL,
    successMessage: null,
  };
}

/** Clear success banner after host continues creation. */
export function dismissQuotaUnlock(
  state: QuotaBlockingState
): QuotaBlockingState {
  return {
    ...state,
    status: 'idle',
    successMessage: null,
  };
}

export function projectQuotaBlockingView(
  state: QuotaBlockingState
): QuotaBlockingView {
  const code = state.code;
  const canSubmit =
    state.blocked &&
    !state.unlocked &&
    state.status !== 'pending' &&
    code.trim().length >= 4;

  return {
    visible: state.blocked || state.unlocked,
    title: composer_credit_block_title(),
    description: composer_credit_block_description(),
    code,
    codeLabel: QUOTA_BLOCK_CODE_LABEL,
    codePlaceholder: QUOTA_BLOCK_CODE_PLACEHOLDER,
    submitLabel: QUOTA_BLOCK_SUBMIT_LABEL,
    canSubmit,
    status: state.status,
    errorMessage: state.errorMessage,
    successMessage: state.successMessage,
    unlocked: state.unlocked,
    canContinueCreation: state.unlocked && !state.blocked,
  };
}

/**
 * Which output a run produces. Still a real distinction — the server debit
 * contract mirrored below is keyed by it — but no longer a billing unit: what
 * a run costs is one credit price for the whole run (D-172).
 */
export type ComposerQuotaResource = 'copy' | 'image' | 'video';

export type ComposerCreditRedemptionReceipt = {
  creditGrant?: {
    originalCredits: number;
    transactionType: string;
  };
};

export type ComposerCreditQuote = {
  quoteId: string;
  revision: string;
  amount: number;
};

/**
 * A redemption command is not an unlock receipt. Credit mode unlocks only
 * after the command proves it wrote a credit lot and a fresh authoritative
 * projection proves that the balance covers this quote. The cached balance is
 * not an unlock authority because a replay can observe the granted balance
 * before this helper runs.
 */
export async function recoverComposerCredits(input: {
  quote: ComposerCreditQuote | null | undefined;
  currentQuote: () => ComposerCreditQuote | null | undefined;
  redeem: () => Promise<ComposerCreditRedemptionReceipt>;
  refreshCredits: () => Promise<
    { credits?: { availableCredits: number } } | null | undefined
  >;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const receipt = await input.redeem();
  const projection = await input.refreshCredits();
  const after = projection?.credits?.availableCredits;
  const creditGrant = receipt.creditGrant;
  if (
    !creditGrant ||
    creditGrant.transactionType !== 'REDEMPTION_CODE' ||
    !Number.isSafeInteger(creditGrant.originalCredits) ||
    creditGrant.originalCredits <= 0 ||
    !Number.isSafeInteger(after)
  ) {
    return { ok: false, message: '兑换后积分未到账，请重试' };
  }
  const acceptedQuote = input.quote;
  const currentQuote = input.currentQuote();
  if (
    !acceptedQuote ||
    !currentQuote ||
    acceptedQuote.quoteId !== currentQuote.quoteId ||
    acceptedQuote.revision !== currentQuote.revision
  ) {
    return { ok: false, message: '报价已更新，请按最新报价重试' };
  }
  if (
    !Number.isSafeInteger(currentQuote.amount) ||
    currentQuote.amount <= 0 ||
    after! < currentQuote.amount
  ) {
    return { ok: false, message: '积分已到账，但仍不足以完成本次创作' };
  }
  return { ok: true };
}

/** One output kind this run produces, and how many of it. */
export type QuotaRequirement = {
  resource: ComposerQuotaResource;
  cost: number;
};

/**
 * The front-end mirror of the server's debit contract.
 *
 * Authority: `apps/core/src/p1/product-billing/server-quote-authority.ts`
 * (`debitUnitsFor`) and `apps/core/src/p1/execution-spine/composer-submission-
 * gate.ts` (`noteUsageUnits`). An 图文 note debits **two** buckets — one copy
 * item plus one image per bound page — so a merchant with images to spare but
 * no copy left used to sail past the front-end check and collect a rejection
 * from the server (P0-5). Keep this in step with the server or that returns.
 */
export function composerQuotaRequirements(input: {
  lensId: 'copy' | 'image_text' | 'video' | null;
  /** ComposerDelivery.deliverableKind — decides the image-text sub-shape. */
  deliverableKind: string | null;
  /** Deliverables this run asks for. */
  quantity: number;
  /** Bound page count for an image-text note, when the recipe declares one. */
  notePageBound?: number | null;
}): QuotaRequirement[] {
  const quantity = Math.max(1, Math.trunc(input.quantity) || 1);
  if (!input.lensId) return [];
  if (input.lensId === 'copy') return [{ resource: 'copy', cost: quantity }];
  if (input.lensId === 'video') return [{ resource: 'video', cost: quantity }];
  if (
    input.deliverableKind === 'note' ||
    input.deliverableKind === 'image_text_package'
  ) {
    const pages =
      input.notePageBound && input.notePageBound > 0
        ? Math.trunc(input.notePageBound)
        : quantity;
    return [
      { resource: 'copy', cost: 1 },
      { resource: 'image', cost: pages },
    ];
  }
  return [{ resource: 'image', cost: quantity }];
}

/**
 * Build the redemptions CAS command payload used by RedemptionCard.
 * Host wires this into commandP1('redemptions', …, idempotencyKey).
 */
export function buildQuotaRedeemCommand(code: string): {
  action: 'redeem';
  payload: { code: string };
} {
  return {
    action: 'redeem',
    payload: { code: code.trim().toUpperCase() },
  };
}

export function isQuotaRedeemCodeValid(code: string): boolean {
  return code.trim().length >= 4;
}
