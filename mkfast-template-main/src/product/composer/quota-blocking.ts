/**
 * GL-23 quota-exhausted blocking card model (C4 / #98, ledger §7.7).
 *
 * Inline redemption code input reuses the existing redemptions CAS seam
 * (commandP1 module 'redemptions' / action 'redeem'). Success unlocks
 * continue-creation in place — no navigation to settings.
 */

import type { AccountUsageProjection } from '../account-usage';

export const QUOTA_BLOCK_TITLE = '额度不足';
export const QUOTA_BLOCK_DESCRIPTION =
  '当前额度不足，无法继续创作。可在此输入兑换码立即解锁。';
export const QUOTA_BLOCK_CODE_LABEL = '兑换码';
export const QUOTA_BLOCK_CODE_PLACEHOLDER = '输入兑换码';
export const QUOTA_BLOCK_SUBMIT_LABEL = '兑换并继续';
export const QUOTA_BLOCK_SUCCESS_LABEL = '兑换成功，可继续创作';
export const QUOTA_BLOCK_FAILED_LABEL = '兑换失败，请检查兑换码';
/**
 * D-141 死链修复：原「查看套餐」指向 `/settings/credits`，而该地址被
 * `navigation.ts` 重定向到只读的用量页——额度不足的商家点过去看到的是同一
 * 个「你没额度了」，没有任何出路。真实出路只有两条：卡内兑换码当场解锁，
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

/**
 * The merchant-facing unit each bucket is counted in.
 *
 * Not cosmetic. The ledger stores 「whole merchant entitlement units (copy,
 * image, or video tickets)」 (product-billing/product-usage-ledger.ts) and the
 * server reserves video by clip (`server-quote-authority.ts` debitUnitsFor →
 * `{ resource: 'video', quantity }`), so all three buckets are now counted in
 * the same denomination the composer draft's `quantity` counts. The earlier
 * seconds-vs-clips split that forced video to stay silent is gone (T21/G-11),
 * which is why 视频 gets a 「条」 line like everything else (W05 ③).
 */
const QUOTA_UNITS = {
  copy: '条',
  image: '张',
  video: '条',
} as const;

export type ComposerQuotaResource = keyof typeof QUOTA_UNITS;

export type ComposerCreditRedemptionReceipt = {
  creditGrant?: {
    originalCredits: number;
    transactionType: string;
  };
};

/**
 * A redemption command is not an unlock receipt. Credit mode unlocks only
 * after the command proves it wrote a credit lot and a fresh authoritative
 * projection proves that the balance both increased and covers this quote.
 */
export async function recoverComposerCredits(input: {
  beforeCredits: number | null | undefined;
  requiredCredits: number | null | undefined;
  redeem: () => Promise<ComposerCreditRedemptionReceipt>;
  refreshCredits: () => Promise<
    { credits?: { availableCredits: number } } | null | undefined
  >;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const receipt = await input.redeem();
  const projection = await input.refreshCredits();
  const before = input.beforeCredits;
  const after = projection?.credits?.availableCredits;
  const required = input.requiredCredits;
  const creditGrant = receipt.creditGrant;
  if (
    !creditGrant ||
    creditGrant.transactionType !== 'REDEMPTION_CODE' ||
    !Number.isSafeInteger(creditGrant.originalCredits) ||
    creditGrant.originalCredits <= 0 ||
    !Number.isSafeInteger(before) ||
    !Number.isSafeInteger(after) ||
    after! <= before!
  ) {
    return { ok: false, message: '兑换后积分未到账，请重试' };
  }
  if (!Number.isSafeInteger(required) || required! <= 0 || after! < required!) {
    return { ok: false, message: '积分已到账，但仍不足以完成本次创作' };
  }
  return { ok: true };
}

/**
 * Read the legacy balance only for the retired resource-bucket path. Credit
 * billing deliberately returns an optional `credits` projection: once present,
 * server quote + reservation own admission and this passive bucket check must
 * stay silent instead of guessing a credits-to-output conversion.
 */
export function composerQuotaAvailability(
  projection:
    | Pick<AccountUsageProjection, 'usage' | 'credits'>
    | null
    | undefined
): Partial<Record<ComposerQuotaResource, number | null>> {
  if (!projection || projection.credits) {
    return { copy: null, image: null, video: null };
  }
  return {
    copy: projection.usage.copy.available,
    image: projection.usage.image.available,
    video: projection.usage.video.available,
  };
}

/** One bucket this run will debit, in that bucket's own unit. */
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

export type QuotaPassiveView = {
  visible: boolean;
  /** e.g. 「本次用 1 条文案额度 · 还剩 4 条」 */
  notice: string;
  /** True when this run would exceed what is left — 缺额提醒, not a gate. */
  short: boolean;
  shortNotice: string | null;
  /** Exactly which buckets fall short, in requirement order. */
  shortResources: ComposerQuotaResource[];
};

const HIDDEN: QuotaPassiveView = {
  visible: false,
  notice: '',
  short: false,
  shortNotice: null,
  shortResources: [],
};

function amount(resource: ComposerQuotaResource, value: number) {
  return `${value} ${QUOTA_UNITS[resource]}`;
}

/**
 * 「1 条文案额度和 3 张图片额度」— what this run spends, in each bucket's own
 * unit and never in money (D-109「供应细节不可见」). Exported because more than
 * one surface has to say this, and two hand-rolled versions would drift into
 * describing one run two ways.
 */
export function quotaSpendLabel(
  requirements: readonly QuotaRequirement[]
): string {
  return (
    requirements
      .map(
        (row) =>
          `${amount(row.resource, row.cost)}${QUOTA_RESOURCE_LABELS[row.resource]}额度`
      )
      // 「和 」 not 「和」: every item opens with a numeral, which needs the space.
      .join('和 ')
  );
}

export function projectQuotaPassiveView(input: {
  requirements: QuotaRequirement[];
  /** Remaining balances from the entitlements projection, in bucket units. */
  available: Partial<Record<ComposerQuotaResource, number | null | undefined>>;
}): QuotaPassiveView {
  if (input.requirements.length === 0) return HIDDEN;
  const rows = input.requirements.map((requirement) => ({
    ...requirement,
    available: input.available[requirement.resource],
  }));
  // Say nothing until every bucket this run touches has a balance. A partial
  // sentence would read as a complete one.
  if (rows.some((row) => row.available === null || row.available === undefined))
    return HIDDEN;
  const loaded = rows as Array<(typeof rows)[number] & { available: number }>;
  const shortRows = loaded.filter((row) => row.available < row.cost);
  const spend = quotaSpendLabel(loaded);
  const left =
    loaded.length === 1
      ? `还剩 ${amount(loaded[0].resource, loaded[0].available)}`
      : loaded
          .map(
            (row) =>
              `${QUOTA_RESOURCE_LABELS[row.resource]}还剩 ${amount(row.resource, row.available)}`
          )
          .join('、');
  return {
    visible: true,
    notice: `本次用 ${spend} · ${left}`,
    short: shortRows.length > 0,
    shortNotice:
      shortRows.length > 0
        ? quotaShortNotice(shortRows.map((r) => r.resource))
        : null,
    shortResources: shortRows.map((row) => row.resource),
  };
}

/** 缺额提醒 that names the bucket instead of a generic「额度不足」(D-116). */
export function quotaShortNotice(resources: ComposerQuotaResource[]): string {
  if (resources.length === 0) return '';
  const names = resources
    .map((resource) => `${QUOTA_RESOURCE_LABELS[resource]}额度`)
    .join('和');
  return `${names}不够这次生成了，可以补充后再来`;
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
