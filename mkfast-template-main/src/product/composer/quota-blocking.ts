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
 * 被动展示 — the other half of the quota card (D-043 决定②/③, T31 / #225).
 *
 * 「模型/额度从主路径移除…额度按钮旁被动展示，不足才阻塞」: on the main path the
 * merchant reads what this run will use and what is left, and taps 生成 — that
 * tap *is* the confirmation (确认与执行合并一击). Nothing here gates anything.
 *
 * Deliberately no cost, no unit price and no internal baseline: the merchant
 * unit is 条数, never money (D-109 / D-123).
 */
export const QUOTA_RESOURCE_LABELS = {
  copy: '文案',
  image: '图片',
  video: '视频',
  audio: '语音',
} as const;

export type QuotaPassiveView = {
  visible: boolean;
  /** e.g. 「本次用 1 条文案额度 · 还剩 4 条」 */
  notice: string;
  /** True when this run would exceed what is left — 缺额提醒, not a gate. */
  short: boolean;
  shortNotice: string | null;
};

export function projectQuotaPassiveView(input: {
  resource: keyof typeof QUOTA_RESOURCE_LABELS;
  /** Remaining balance from the entitlements projection. */
  available: number | null | undefined;
  /** What this run is estimated to use. */
  cost: number;
}): QuotaPassiveView {
  const label = QUOTA_RESOURCE_LABELS[input.resource];
  if (input.available === null || input.available === undefined) {
    return { visible: false, notice: '', short: false, shortNotice: null };
  }
  const short = input.available < input.cost;
  return {
    visible: true,
    notice: `本次用 ${input.cost} 条${label}额度 · 还剩 ${input.available} 条`,
    short,
    shortNotice: short ? `${label}额度不够这次生成了，可以补充后再来` : null,
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
