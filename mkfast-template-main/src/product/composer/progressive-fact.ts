/**
 * Day-0 progressive store fact questions (P1-A1 / #148).
 *
 * One blocking fact at a time from Recipe/snapshot readiness gaps.
 * Non-critical facts may be skipped with an explicit safe fallback and
 * impact note. Confirms through the same confirm_store contract — no
 * onboarding-only creation path.
 */

import type { ProductCommand, StoreProfile } from '@meiye/contracts';

export type ProgressiveFactId =
  | 'name'
  | 'city'
  | 'projectName'
  | 'projectPrice'
  | 'district'
  | 'address'
  | 'booking'
  | 'brandVoice';

export type ProgressiveFactCriticality = 'blocking' | 'skippable';

export type ProgressiveFactDraft = {
  name: string;
  city: string;
  district: string;
  address: string;
  booking: string;
  brandVoice: string;
  projectName: string;
  projectPrice: string;
  /** Facts the merchant chose to skip (only skippable ids). */
  skipped: ProgressiveFactId[];
};

export type ProgressiveFactQuestion = {
  id: ProgressiveFactId;
  criticality: ProgressiveFactCriticality;
  /** Why this fact is asked for the current delivery. */
  why: string;
  /** Impact if answered / skipped. */
  impact: string;
  /** Safe fallback applied when skippable and skipped. */
  safeFallback?: string;
  inputKind: 'text' | 'number';
};

export type ProgressiveFactView = {
  draft: ProgressiveFactDraft;
  current: ProgressiveFactQuestion | null;
  answeredIds: ProgressiveFactId[];
  readyToConfirm: boolean;
  /** Human-readable impact of all current skips. */
  skipImpacts: string[];
};

const FACT_ORDER: ProgressiveFactId[] = [
  'name',
  'city',
  'projectName',
  'projectPrice',
  'district',
  'address',
  'booking',
  'brandVoice',
];

const BLOCKING = new Set<ProgressiveFactId>([
  'name',
  'city',
  'projectName',
  'projectPrice',
]);

const FALLBACKS: Record<
  Extract<ProgressiveFactId, 'district' | 'address' | 'booking' | 'brandVoice'>,
  string
> = {
  district: '本区',
  address: '门店地址待补充',
  booking: '到店咨询预约',
  brandVoice: '真实、克制、像熟客推荐',
};

const WHY: Record<ProgressiveFactId, string> = {
  name: '成品文案需要可引用的门店名称，避免示例店名混入商家内容。',
  city: '同城曝光与平台投放表述依赖城市，缺失时无法写出可信到店引导。',
  projectName: '本次交付需要至少一个已确认项目，作为主推与价格锚点。',
  projectPrice: '价格进入事实账本后才能引用；未确认价格不会被编造。',
  district: '区县帮助同城检索，但不阻塞基础文案生成。',
  address: '详细地址用于到店指引，可先跳过并用安全占位。',
  booking: '预约方式影响 CTA，可先用通用到店咨询回退。',
  brandVoice: '语气偏好可稍后完善；跳过时使用克制默认语气。',
};

const IMPACT: Record<ProgressiveFactId, string> = {
  name: '回答后，本次及后续创作会复用该店名。',
  city: '回答后，同城与到店表述会绑定此城市。',
  projectName: '回答后，主推项目会写入已确认项目列表。',
  projectPrice: '回答后，报价与促销表述可引用此价格。',
  district: '跳过将使用“本区”占位，同城精度下降。',
  address: '跳过将使用“门店地址待补充”，成品不写具体导航。',
  booking: '跳过将使用“到店咨询预约”，不写具体预约渠道。',
  brandVoice: '跳过将使用默认克制语气，可稍后在门店资料改。',
};

export function createProgressiveFactDraft(
  partial?: Partial<ProgressiveFactDraft>
): ProgressiveFactDraft {
  return {
    name: partial?.name ?? '',
    city: partial?.city ?? '',
    district: partial?.district ?? '',
    address: partial?.address ?? '',
    booking: partial?.booking ?? '',
    brandVoice: partial?.brandVoice ?? '',
    projectName: partial?.projectName ?? '',
    projectPrice: partial?.projectPrice ?? '',
    skipped: partial?.skipped ? [...partial.skipped] : [],
  };
}

function fieldValue(draft: ProgressiveFactDraft, id: ProgressiveFactId) {
  return draft[id].trim();
}

function isAnswered(draft: ProgressiveFactDraft, id: ProgressiveFactId) {
  if (draft.skipped.includes(id)) return true;
  if (id === 'projectPrice') {
    const price = Number(draft.projectPrice);
    return (
      draft.projectPrice.trim().length > 0 &&
      Number.isFinite(price) &&
      price >= 0
    );
  }
  return fieldValue(draft, id).length > 0;
}

export function progressiveFactQuestion(
  id: ProgressiveFactId
): ProgressiveFactQuestion {
  const criticality: ProgressiveFactCriticality = BLOCKING.has(id)
    ? 'blocking'
    : 'skippable';
  return {
    id,
    criticality,
    why: WHY[id],
    impact: IMPACT[id],
    ...(criticality === 'skippable'
      ? {
          safeFallback:
            FALLBACKS[id as 'district' | 'address' | 'booking' | 'brandVoice'],
        }
      : {}),
    inputKind: id === 'projectPrice' ? 'number' : 'text',
  };
}

export function projectProgressiveFactView(
  draft: ProgressiveFactDraft
): ProgressiveFactView {
  const answeredIds = FACT_ORDER.filter((id) => isAnswered(draft, id));
  const currentId = FACT_ORDER.find((id) => !isAnswered(draft, id)) ?? null;
  const readyToConfirm = [...BLOCKING].every((id) => isAnswered(draft, id));
  const skipImpacts = draft.skipped.map((id) => IMPACT[id]);
  return {
    draft,
    current: currentId ? progressiveFactQuestion(currentId) : null,
    answeredIds,
    readyToConfirm,
    skipImpacts,
  };
}

export function answerProgressiveFact(
  draft: ProgressiveFactDraft,
  id: ProgressiveFactId,
  value: string
): ProgressiveFactDraft {
  const next: ProgressiveFactDraft = {
    ...draft,
    skipped: draft.skipped.filter((item) => item !== id),
    [id]: value,
  };
  return next;
}

export function skipProgressiveFact(
  draft: ProgressiveFactDraft,
  id: ProgressiveFactId
): ProgressiveFactDraft | null {
  if (BLOCKING.has(id)) return null;
  const fallback =
    FALLBACKS[id as 'district' | 'address' | 'booking' | 'brandVoice'];
  if (!fallback) return null;
  return {
    ...draft,
    [id]: fallback,
    skipped: draft.skipped.includes(id)
      ? draft.skipped
      : [...draft.skipped, id],
  };
}

export function buildConfirmStoreCommand(
  draft: ProgressiveFactDraft
): ProductCommand | null {
  const view = projectProgressiveFactView(draft);
  if (!view.readyToConfirm) return null;

  const price = Number(draft.projectPrice);
  if (!Number.isFinite(price) || price < 0) return null;

  const store: Omit<StoreProfile, 'confirmedAt'> = {
    name: draft.name.trim(),
    city: draft.city.trim(),
    district: (draft.district.trim() || FALLBACKS.district).trim(),
    address: (draft.address.trim() || FALLBACKS.address).trim(),
    booking: (draft.booking.trim() || FALLBACKS.booking).trim(),
    brandVoice: (draft.brandVoice.trim() || FALLBACKS.brandVoice).trim(),
    prohibitions: ['不虚构价格'],
    accounts: [],
    projects: [
      {
        id: 'progressive-project-1',
        name: draft.projectName.trim(),
        price,
        durationMinutes: 60,
        confirmed: true,
      },
    ],
    regulated: false,
  };

  return { type: 'confirm_store', store };
}

/** Next single missing grounding fact from product readiness. */
export function nextGroundingFactFocus(input: {
  storeConfirmed: boolean;
  projectConfirmed: boolean;
}): ProgressiveFactId | null {
  if (!input.storeConfirmed) return 'name';
  if (!input.projectConfirmed) return 'projectName';
  return null;
}
