/**
 * GL-23 quota-exhausted blocking card model (C4 / #98, ledger §7.7).
 *
 * Inline redemption code input reuses the existing redemptions CAS seam
 * (commandP1 module 'redemptions' / action 'redeem'). Success unlocks
 * continue-creation in place — no navigation to settings.
 */

export const QUOTA_BLOCK_TITLE = '额度不足';
export const QUOTA_BLOCK_DESCRIPTION =
  '当前额度不足，无法继续创作。可在此输入兑换码立即解锁。';
export const QUOTA_BLOCK_CODE_LABEL = '兑换码';
export const QUOTA_BLOCK_CODE_PLACEHOLDER = '输入兑换码';
export const QUOTA_BLOCK_SUBMIT_LABEL = '兑换并继续';
export const QUOTA_BLOCK_SUCCESS_LABEL = '兑换成功，可继续创作';
export const QUOTA_BLOCK_FAILED_LABEL = '兑换失败，请检查兑换码';
export const QUOTA_BLOCK_OPEN_PLANS_LABEL = '查看套餐';

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
    title: QUOTA_BLOCK_TITLE,
    description: QUOTA_BLOCK_DESCRIPTION,
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
