/**
 * Progressive customer-asset rights single-question flow (P1-A2 / #149).
 *
 * First pass covers subject → purpose → platforms → term only, each with
 * why + impact. Advanced evidence / detailed scope / exceptions expand on
 * demand and keep the draft when collapsed. Unconfirmed public marketing
 * stays internal_only.
 */

import type { Platform } from '@meiye/contracts';

export type RightsQuestionId =
  | 'subject'
  | 'purpose'
  | 'platforms'
  | 'term'
  | 'advanced';

export type RightsPurpose = 'internal_only' | 'public_marketing';

export type ProgressiveRightsDraft = {
  subject: string;
  purpose: RightsPurpose | undefined;
  platforms: Platform[];
  noFixedExpiry: boolean;
  validUntil: string;
  evidence: string;
  /** Advanced panel open state — closing keeps draft values. */
  advancedOpen: boolean;
  /** Optional exceptions / notes kept only in advanced. */
  exceptions: string;
};

export type RightsQuestionMeta = {
  id: RightsQuestionId;
  why: string;
  impact: string;
};

export type ProgressiveRightsView = {
  draft: ProgressiveRightsDraft;
  currentQuestionId: RightsQuestionId | null;
  answeredQuestionIds: RightsQuestionId[];
  readyForAuthorize: boolean;
  /** true when purpose is public_marketing and core fields complete. */
  publicMarketingReady: boolean;
  /** Unconfirmed public path must remain internal-only. */
  effectiveConsentScope: RightsPurpose;
};

const CORE_QUESTIONS: RightsQuestionId[] = [
  'subject',
  'purpose',
  'platforms',
  'term',
];

const WHY: Record<RightsQuestionId, string> = {
  subject: '需要明确权利主体，才能把授权归属写进审计，而不是匿名默认门店。',
  purpose:
    '用途决定素材能否进入公开营销 snapshot；未确认时只允许内部草稿使用。',
  platforms: '公开营销必须限定平台范围，避免一次授权被扩大到未同意的渠道。',
  term: '期限约束授权有效期；过期后阻止新生成与新交付，并进入待替换。',
  advanced: '高级证据与例外仅在有正式授权文件或特殊范围时需要。',
};

const IMPACT: Record<RightsQuestionId, string> = {
  subject: '主体会写入素材权利 revision，并随撤权审计保留。',
  purpose: '选择内部使用不会进入公开营销；选择公开宣传后才继续问平台与期限。',
  platforms: '仅勾选的平台可进入 required-source 图文任务的公开交付。',
  term: '过期或撤回会阻断新生成/新交付，并产生受影响内容的待替换投影。',
  advanced: '证据与例外按需展开；关闭面板后草稿保留，不会清空已填内容。',
};

export function createProgressiveRightsDraft(
  partial?: Partial<ProgressiveRightsDraft>
): ProgressiveRightsDraft {
  return {
    subject: partial?.subject ?? '',
    purpose: partial?.purpose,
    platforms: partial?.platforms ? [...partial.platforms] : [],
    noFixedExpiry: partial?.noFixedExpiry ?? false,
    validUntil: partial?.validUntil ?? '',
    evidence: partial?.evidence ?? '',
    advancedOpen: partial?.advancedOpen ?? false,
    exceptions: partial?.exceptions ?? '',
  };
}

export function rightsQuestionMeta(id: RightsQuestionId): RightsQuestionMeta {
  return { id, why: WHY[id], impact: IMPACT[id] };
}

function subjectAnswered(draft: ProgressiveRightsDraft) {
  return draft.subject.trim().length >= 2;
}

function purposeAnswered(draft: ProgressiveRightsDraft) {
  return (
    draft.purpose === 'internal_only' || draft.purpose === 'public_marketing'
  );
}

function platformsAnswered(draft: ProgressiveRightsDraft) {
  if (draft.purpose !== 'public_marketing') return true;
  return draft.platforms.length > 0;
}

function termAnswered(draft: ProgressiveRightsDraft) {
  if (draft.purpose !== 'public_marketing') return true;
  if (draft.noFixedExpiry) return draft.validUntil.trim().length === 0;
  return /^\d{4}-\d{2}-\d{2}$/u.test(draft.validUntil.trim());
}

function isAnswered(draft: ProgressiveRightsDraft, id: RightsQuestionId) {
  switch (id) {
    case 'subject':
      return subjectAnswered(draft);
    case 'purpose':
      return purposeAnswered(draft);
    case 'platforms':
      return platformsAnswered(draft);
    case 'term':
      return termAnswered(draft);
    case 'advanced':
      // Advanced is optional — never blocks readiness.
      return true;
    default:
      return false;
  }
}

/**
 * Next core question. Internal-only purpose short-circuits platforms/term.
 */
export function nextRightsQuestion(
  draft: ProgressiveRightsDraft
): RightsQuestionId | null {
  if (!subjectAnswered(draft)) return 'subject';
  if (!purposeAnswered(draft)) return 'purpose';
  if (draft.purpose === 'internal_only') return null;
  if (!platformsAnswered(draft)) return 'platforms';
  if (!termAnswered(draft)) return 'term';
  return null;
}

export function projectProgressiveRightsView(
  draft: ProgressiveRightsDraft
): ProgressiveRightsView {
  const answeredQuestionIds = CORE_QUESTIONS.filter((id) =>
    isAnswered(draft, id)
  );
  const currentQuestionId = nextRightsQuestion(draft);
  const publicMarketingReady =
    draft.purpose === 'public_marketing' &&
    subjectAnswered(draft) &&
    platformsAnswered(draft) &&
    termAnswered(draft);
  const readyForAuthorize =
    subjectAnswered(draft) &&
    purposeAnswered(draft) &&
    (draft.purpose === 'internal_only' || publicMarketingReady);

  return {
    draft,
    currentQuestionId,
    answeredQuestionIds,
    readyForAuthorize,
    publicMarketingReady,
    // Fail closed: anything not fully confirmed for public stays internal.
    effectiveConsentScope:
      publicMarketingReady && draft.purpose === 'public_marketing'
        ? 'public_marketing'
        : 'internal_only',
  };
}

export function answerRightsSubject(
  draft: ProgressiveRightsDraft,
  subject: string
): ProgressiveRightsDraft {
  return { ...draft, subject };
}

export function answerRightsPurpose(
  draft: ProgressiveRightsDraft,
  purpose: RightsPurpose
): ProgressiveRightsDraft {
  if (purpose === 'internal_only') {
    return {
      ...draft,
      purpose,
      platforms: [],
      noFixedExpiry: false,
      validUntil: '',
    };
  }
  return { ...draft, purpose };
}

export function toggleRightsPlatform(
  draft: ProgressiveRightsDraft,
  platform: Platform
): ProgressiveRightsDraft {
  const selected = draft.platforms.includes(platform);
  return {
    ...draft,
    platforms: selected
      ? draft.platforms.filter((item) => item !== platform)
      : [...draft.platforms, platform],
  };
}

export function answerRightsTerm(
  draft: ProgressiveRightsDraft,
  input: { noFixedExpiry?: boolean; validUntil?: string }
): ProgressiveRightsDraft {
  if (input.noFixedExpiry === true) {
    return { ...draft, noFixedExpiry: true, validUntil: '' };
  }
  if (input.noFixedExpiry === false) {
    return {
      ...draft,
      noFixedExpiry: false,
      validUntil: input.validUntil ?? draft.validUntil,
    };
  }
  return {
    ...draft,
    validUntil: input.validUntil ?? draft.validUntil,
    noFixedExpiry: false,
  };
}

export function setRightsAdvancedOpen(
  draft: ProgressiveRightsDraft,
  open: boolean
): ProgressiveRightsDraft {
  // Closing keeps evidence + exceptions drafts intact.
  return { ...draft, advancedOpen: open };
}

export function updateRightsAdvancedDraft(
  draft: ProgressiveRightsDraft,
  input: { evidence?: string; exceptions?: string }
): ProgressiveRightsDraft {
  return {
    ...draft,
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    ...(input.exceptions !== undefined ? { exceptions: input.exceptions } : {}),
  };
}

/**
 * Map progressive draft into ConfirmedAssetFacts-compatible rights fields.
 * Returns null when not ready — caller must keep internal_only upload path.
 */
export function progressiveRightsToFacts(input: {
  draft: ProgressiveRightsDraft;
  category: 'customer_case' | 'before_after' | 'store' | 'price_list' | 'other';
  containsPerson: boolean;
  containsSensitiveData: boolean;
  minorStatus: 'none' | 'minor';
}): {
  category: typeof input.category;
  consentScope: RightsPurpose;
  containsPerson: boolean;
  containsSensitiveData: boolean;
  minorStatus: 'none' | 'minor';
  rightsOwner: string;
  rightsEvidence?: string;
  rightsNoFixedExpiry?: boolean;
  rightsPlatforms?: Platform[];
  rightsValidUntil?: string;
} | null {
  const view = projectProgressiveRightsView(input.draft);
  if (!view.readyForAuthorize) return null;
  if (
    input.minorStatus === 'minor' &&
    view.draft.purpose === 'public_marketing'
  ) {
    return null;
  }

  const base = {
    category: input.category,
    consentScope: view.effectiveConsentScope,
    containsPerson: input.containsPerson,
    containsSensitiveData: input.containsSensitiveData,
    minorStatus: input.minorStatus,
    rightsOwner: view.draft.subject.trim(),
  };

  if (view.effectiveConsentScope === 'internal_only') {
    return base;
  }

  const evidence = view.draft.evidence.trim();
  return {
    ...base,
    ...(evidence ? { rightsEvidence: evidence } : {}),
    rightsNoFixedExpiry: view.draft.noFixedExpiry,
    rightsPlatforms: [...view.draft.platforms],
    rightsValidUntil: view.draft.noFixedExpiry
      ? undefined
      : new Date(`${view.draft.validUntil}T23:59:59.999Z`).toISOString(),
  };
}
